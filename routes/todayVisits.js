const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { sanitizeChartNo } = require('../utils/patientUtils');

// File Stores (Used for fallback or auxiliary data like packages)
const {
    readData,
    writeData,
    // TODAY_VISITS_FILE, // Removed
    PATIENTS_FILE,
    BOOKINGS_FILE,
    // TREATMENT_HISTORY_FILE, // Removed
    AUTO_INSURANCE_FILE,
    TEST_RESULTS_FILE,
    DATA_DIR
} = require('../utils/fileStore');
const { getKSTDate, formatKSTDate } = require('../utils/dateUtils');

// 1. 오늘 내원 환자 목록 조회
router.get('/today-visits', async (req, res) => {
    try {
        const queryDate = req.query.date || getKSTDate();
        // Use 'date' generated column if it works, or just DATE(visitedAt)
        // init_schema.sql: date AS (DATE(visitedAt)) VIRTUAL
        const [rows] = await pool.query(`
            SELECT tv.*, p.hasKakao 
            FROM today_visits tv 
            JOIN patients p ON tv.patientId = p.id 
            WHERE tv.date = ? 
            ORDER BY tv.visitedAt ASC
        `, [queryDate]);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('DB Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 2. 내원 등록
router.post('/today-visits', async (req, res) => {
    const { patientId, patientName, chartNo: rawChartNo, birthGender, fromBooking, bookingId } = req.body;
    const chartNo = sanitizeChartNo(rawChartNo);

    if (!patientId || !patientName) {
        return res.json({ success: false, message: 'patientId and patientName are required' });
    }

    try {
        const today = getKSTDate();

        // 이미 등록된 환자인지 확인
        const [existing] = await pool.query(
            'SELECT id FROM today_visits WHERE patientId = ? AND date = ?',
            [patientId, today]
        );

        if (existing.length > 0) {
            return res.json({ success: false, message: '이미 내원 등록된 환자입니다' });
        }

        const visitedAt = new Date();
        const io = req.app.get('io');

        const [result] = await pool.query(
            `INSERT INTO today_visits 
            (patientId, patientName, chartNo, birthGender, visitedAt, date, status, fromBooking, bookingId) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                patientId,
                patientName,
                chartNo || '',
                birthGender || '',
                visitedAt,
                today,
                'waiting',
                fromBooking ? 1 : 0,
                bookingId || null
            ]
        );

        const newId = result.insertId;

        // [Fix] 예약 목록(bookings Table)에서 해당 환자 제거 (예약 -> 내원 전환)
        // Check if DB based or File based. We migrated bookings to DB.
        // So we should update bookings table status or delete it.
        // Original logic splice(deleted) it.
        // Let's delete it or mark as 'Completed'? 
        // Original code: Splice from JSON.
        // New: DELETE or Update Status? -> DELETE to match splicing.
        // Need to find booking for today.

        try {
            await pool.query(
                'DELETE FROM bookings WHERE date = ? AND (name = ? OR chartNo = ?)',
                [today, patientName, chartNo || '']
            );
            // Or better, use bookings.id if fromBooking is true?
            if (fromBooking && bookingId) {
                await pool.query('DELETE FROM bookings WHERE id = ?', [bookingId]);
            }
            if (io) io.emit('bookings:update');
        } catch (err) {
            console.error('예약 삭제 실패:', err);
        }

        if (io) io.emit('visits:update');

        // Return object matches the row
        const newVisit = {
            id: newId,
            patientId,
            patientName,
            chartNo,
            birthGender,
            visitedAt: visitedAt.toISOString(),
            status: 'waiting',
            fromBooking,
            bookingId
        };

        res.json({ success: true, data: newVisit });
    } catch (error) {
        console.error('DB Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 3. 내원 상태 변경
router.put('/today-visits/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        await pool.query('UPDATE today_visits SET status = ? WHERE id = ?', [status, id]);

        // Return updated object
        const [rows] = await pool.query('SELECT * FROM today_visits WHERE id = ?', [id]);
        if (rows.length === 0) return res.json({ success: false, message: 'Visit not found' });

        const io = req.app.get('io');
        if (io) io.emit('visits:update');

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 4. 내원 취소
router.delete('/today-visits/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query('DELETE FROM today_visits WHERE id = ?', [id]);

        const io = req.app.get('io');
        if (io) io.emit('visits:update');

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 5. 환자 추가 정보 조회 (내원 목록용)
// Note: This logic aggregates data from multiple sources (Booking, History, Packages)
// We will move History/Booking queries to DB, but keep Packages/Tests in file for now if they are not migrated.
router.get('/today-visits/patient-info/:patientId', async (req, res) => {
    const { patientId } = req.params;

    try {
        // 1. Patient Info (DB)
        const [patientRows] = await pool.query('SELECT *, COALESCE(hasKakao, 1) as hasKakao FROM patients WHERE id = ?', [patientId]);
        if (patientRows.length === 0) {
            return res.json({ success: false, message: 'Patient not found' });
        }
        const patient = patientRows[0];

        // 2. 추나 정보 조회
        let chunaInfo = null;
        try {
            const [chunaRows] = await pool.query("SELECT entryTime FROM treatment_history WHERE patientId = ? AND status LIKE '%\"추나\":true%'", [patientId]);
            let chunaCount = chunaRows.length;
            let lastChunaDate = null;
            if (chunaRows.length > 0) {
                const lastChuna = chunaRows.sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime))[0];
                lastChunaDate = formatKSTDate(lastChuna.entryTime);
            }
            if (chunaCount > 0 || lastChunaDate) {
                chunaInfo = {
                    count: chunaCount,
                    lastDate: lastChunaDate || '-'
                };
            }
        } catch (e) {
            console.warn('Chuna Info Error:', e);
        }

        // 3. 자보 정보 조회
        let isJabo = false;
        try {
            const [jaboRows] = await pool.query('SELECT id FROM ta_patient WHERE patientId = ? AND status = "active"', [patientId]);
            isJabo = jaboRows.length > 0;
        } catch (e) {
            console.warn('Jabo Info Error:', e);
        }

        const resultInfo = {
            memo: patient.memo || '',
            isJabo: isJabo,
            chunaInfo: chunaInfo,
            hasKakao: patient.hasKakao === 1 || patient.hasKakao === true // Convert to boolean
        };

        res.json({ success: true, data: resultInfo });

    } catch (error) {
        console.error('Info Error:', error);
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
