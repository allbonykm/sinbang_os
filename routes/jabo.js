const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// 자보 환자 목록 조회 (관리중인 환자만)
router.get('/jabo-patients', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM TA_patient 
            WHERE status = 'active' 
            ORDER BY createdAt DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 자보 환자 개별 조회 (상세 정보)
router.get('/jabo-patients/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query('SELECT * FROM TA_patient WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.json({ success: false, message: '해당 환자를 찾을 수 없습니다.' });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 자보 환자 등록
router.post('/jabo-patients', async (req, res) => {
    const { patientId, chartNo, patientName, accidentDate, initialVisitDate } = req.body;
    try {
        // 이미 등록된 환자인지 확인 (active 상태인 경우만)
        const [existing] = await pool.query(
            'SELECT id FROM TA_patient WHERE patientId = ? AND status = "active"', 
            [patientId]
        );
        
        if (existing.length > 0) {
            return res.json({ success: false, message: '이미 자보 환자로 등록되어 관리 중인 환자입니다.' });
        }

        const [result] = await pool.query(
            'INSERT INTO TA_patient (patientId, chartNo, patientName, accidentDate, initialVisitDate, status) VALUES (?, ?, ?, ?, ?, "active")',
            [patientId, chartNo, patientName, accidentDate, initialVisitDate]
        );

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 자보 환자 정보 수정 (사고일, 초진일)
router.put('/jabo-patients/:id', async (req, res) => {
    const { id } = req.params;
    const { accidentDate, initialVisitDate } = req.body;
    try {
        const [result] = await pool.query(
            'UPDATE TA_patient SET accidentDate = ?, initialVisitDate = ? WHERE id = ?',
            [accidentDate, initialVisitDate, id]
        );

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: '해당 환자 정보를 찾을 수 없습니다.' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 자보 합의 처리 (목록에서 제외)
router.delete('/jabo-patients/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 실제 삭제 대신 상태 변경 (settled) 또는 요청대로 제외(삭제) 처리
        // 사용자가 "자보 환자 DB에서 제외"라고 했으므로 삭제 처리함
        const [result] = await pool.query('DELETE FROM TA_patient WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: '해당 환자 정보를 찾을 수 없습니다.' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
