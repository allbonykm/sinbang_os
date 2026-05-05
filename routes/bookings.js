const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { logSystemEvent } = require('./communicator');
const sens = require('../utils/naver-sens');
const { ALIMTALK_EVENTS } = require('../utils/alimtalk-manager');

// ===========================================
// 예약 관리 API
// ===========================================

// 예약 목록 조회 (날짜 내림차순)
router.get('/bookings', async (req, res) => {
    try {
        // 날짜+시간 기준 내림차순 (최신 -> 과거)
        // 날짜를 YYYY-MM-DD 문자열로 직접 변환하여 타임존 오류 방지
        const [rows] = await pool.query("SELECT id, patientId, chartNo, name, patientName, phone, DATE_FORMAT(date, '%Y-%m-%d') as date, time, status, notes, purpose, bookingId, naverStatus, platform, updatedAt FROM bookings ORDER BY date DESC, time DESC");
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 예약 추가
router.post('/bookings', async (req, res) => {
    const { name, phone, date, time, chartNo } = req.body;

    if (!name || !phone || !date || !time) {
        return res.json({ success: false, message: '필수 정보를 입력하세요' });
    }

    try {
        let patientId = null;
        let chartNoValue = chartNo || '';

        // chartNo 가 있을 경우 patients 테이블에서 id 가져오기
        if (chartNoValue) {
            const [pRows] = await pool.query('SELECT id FROM patients WHERE chartNo = ?', [chartNoValue]);
            if (pRows.length > 0) {
                patientId = pRows[0].id;
            }
        }

        const [result] = await pool.query(
            'INSERT INTO bookings (patientId, chartNo, name, patientName, phone, date, time, status, notes, purpose, platform, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [patientId, chartNoValue, name, name, phone, date, time, '', '', '', 'white'] // Default platform 'white', status empty
        );

        const newId = result.insertId;
        const [newBooking] = await pool.query('SELECT * FROM bookings WHERE id = ?', [newId]);

        // 신방톡 자동알림에 예약 알림 표시
        try {
            const io = req.app.get('io');
            let birthGender = '';
            if (chartNoValue) {
                const [patients] = await pool.query('SELECT birthGender FROM patients WHERE chartNo = ?', [chartNoValue]);
                if (patients.length > 0 && patients[0].birthGender) {
                    birthGender = patients[0].birthGender;
                }
            }
            const displayName = `${name} (${chartNoValue || '-'}, ${birthGender || '-'})`;
            const title = `${displayName}님 ${date} ${time} 예약`;
            logSystemEvent(io, 'booking:created', title, { patientName: name, chartNo: chartNoValue, birthGender, date, time });
        } catch (e) {
            console.error('예약 알림 오류:', e);
        }

        // [추가] 예약 즉시 알림톡 발송 (FirstBooking)
        try {
            // 수신 거부 체크
            const [pRows] = await pool.query('SELECT hasKakao, rejectSms FROM patients WHERE chartNo = ?', [chartNoValue]);
            const isReject = pRows.length > 0 && (pRows[0].hasKakao === 0 || pRows[0].rejectSms === 1);
            
            if (!isReject && phone && phone.length >= 10) {
                const { formatKoreanDate, formatKoreanTime } = require('../utils/dateUtils');
                const resDate = formatKoreanDate(date);
                const resTime = formatKoreanTime(time);
                
                const cleanPhone = phone.replace(/[^0-9]/g, '');
                const variables = { 
                    "이름": name,
                    "예약날짜": resDate,
                    "예약시간": resTime
                };

                const result = await sens.sendAlimTalk(
                    name, 
                    chartNoValue, 
                    cleanPhone, 
                    null, 
                    ALIMTALK_EVENTS.FIRST_BOOKING, 
                    null, 
                    null, 
                    variables
                );

                // 발송 이력 기록
                const statusName = result.success ? 'success' : 'failed';
                const errorDesc = result.success ? '' : (result.error || '');
                
                await pool.query(
                    `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message)
                    VALUES (?, ?, ?, ?, NOW(), '알림톡', ?, ?, ?)`,
                    [Date.now() + Math.round(Math.random() * 1000), name, chartNoValue, cleanPhone, statusName, ALIMTALK_EVENTS.FIRST_BOOKING, errorDesc]
                );
            }
        } catch (alimError) {
            console.error('[FirstBooking] 발송 실패:', alimError.message);
        }

        res.json({ success: true, data: newBooking[0] });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 예약 수정 (PUT)
router.put('/bookings/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        // 1. 기존 예약 확인
        const [rows] = await pool.query('SELECT * FROM bookings WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: '예약을 찾을 수 없습니다' });
        }
        const existing = rows[0];

        // 2. 변경확인 및 상태 초기화 로직
        // 날짜나 시간이 변경되면 발송 상태 초기화 (재발송 위해)
        let shouldResetStatus = false;
        if (updates.date) {
            const existingDateStr = new Date(existing.date).toISOString().split('T')[0]; // Simple formatting
            if (updates.date !== existingDateStr) shouldResetStatus = true;
        }
        if (updates.time && updates.time !== existing.time) {
            shouldResetStatus = true;
        }

        let newStatus = updates.status !== undefined ? updates.status : existing.status;
        if (shouldResetStatus) {
            newStatus = '';
        }

        // 3. 업데이트 Query 구성
        const name = updates.name !== undefined ? updates.name : existing.name;
        // name 이 업데이트되면 patientName 도 동일하게 업데이트 되도록 처리
        const patientName = name;
        const phone = updates.phone !== undefined ? updates.phone : existing.phone;
        const date = updates.date !== undefined ? updates.date : existing.date;
        const time = updates.time !== undefined ? updates.time : existing.time;
        const chartNo = updates.chartNo !== undefined ? updates.chartNo : existing.chartNo;
        const notes = updates.notes !== undefined ? updates.notes : existing.notes;
        const purpose = updates.purpose !== undefined ? updates.purpose : existing.purpose;
        const bookingId = updates.bookingId !== undefined ? updates.bookingId : existing.bookingId;
        const naverStatus = updates.naverStatus !== undefined ? updates.naverStatus : existing.naverStatus;

        let patientId = existing.patientId;
        // chartNo 가 변경되었거나, 기존에 patientId 가 없었는데 chartNo 가 들어왔을 때 -> patientId 갱신
        if ((updates.chartNo !== undefined && updates.chartNo !== existing.chartNo) || (!patientId && chartNo)) {
            if (chartNo) {
                const [pRows] = await pool.query('SELECT id FROM patients WHERE chartNo = ?', [chartNo]);
                if (pRows.length > 0) {
                    patientId = pRows[0].id;
                } else {
                    patientId = null;
                }
            } else {
                patientId = null;
            }
        }

        await pool.query(
            `UPDATE bookings SET 
                patientId=?, patientName=?, name=?, phone=?, date=?, time=?, chartNo=?, status=?, notes=?, purpose=?, 
                bookingId=?, naverStatus=?, updatedAt=NOW() 
            WHERE id=?`,
            [patientId, patientName, name, phone, date, time, chartNo, newStatus, notes, purpose, bookingId, naverStatus, id]
        );

        const [updatedRow] = await pool.query('SELECT * FROM bookings WHERE id = ?', [id]);
        res.json({ success: true, data: updatedRow[0] });

    } catch (error) {
        console.error('Database Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 예약 삭제
router.delete('/bookings/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query('DELETE FROM bookings WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: '예약을 찾을 수 없습니다' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 내일 예약 목록 조회 (시간 오름차순)
router.get('/bookings/tomorrow', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT chartNo, name, phone, DATE_FORMAT(date, '%Y-%m-%d') as date, time FROM bookings WHERE date = CURDATE() + INTERVAL 1 DAY ORDER BY time ASC"
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('내일 예약 조회 오류:', error);
        res.json({ success: false, message: error.message });
    }
});

// 환자의 최근 예약 정보 조회 (오늘 이후 가장 가까운 것 1개)
router.get('/bookings/recent/:chartNo', async (req, res) => {
    const { chartNo } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT id, patientId, chartNo, name, patientName, date, time FROM bookings WHERE chartNo = ? AND date >= CURDATE() ORDER BY date ASC, time ASC LIMIT 1",
            [chartNo]
        );
        res.json({ success: true, data: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
