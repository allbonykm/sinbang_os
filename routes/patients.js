const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const { sanitizeChartNo } = require('../utils/patientUtils');

// Multer 설정 (메모리 스토리지 사용)
const upload = multer({ storage: multer.memoryStorage() });

// 환자 필터링 (내원 기간 기준) - 충돌 방지를 위해 상단에 배치
router.get('/patients/filter', async (req, res) => {
    const { months } = req.query;
    try {
        let sql;
        let params = [];
        
        if (months === 'all') {
            // 전체 환자 조회 시에도 수신 거부(rejectSms)인 환자는 제외 (NULL 허용 처리)
            sql = 'SELECT *, COALESCE(hasKakao, 1) as hasKakao, COALESCE(rejectSms, 0) as rejectSms FROM patients WHERE COALESCE(rejectSms, 0) = 0 ORDER BY name ASC';
        } else {
            const m = parseInt(months);
            // 최근 N개월 내에 내원 이력(treatment_history) 또는 당일 내원(today_visits) 기록이 있는 환자 조회
            sql = `
                SELECT p.*, COALESCE(p.hasKakao, 1) as hasKakao, COALESCE(p.rejectSms, 0) as rejectSms
                FROM patients p
                WHERE (
                    EXISTS (
                        SELECT 1 FROM treatment_history h 
                        WHERE h.patientId = p.id AND h.entryTime >= DATE_SUB(NOW(), INTERVAL ? MONTH)
                    )
                    OR EXISTS (
                        SELECT 1 FROM today_visits v 
                        WHERE v.patientId = p.id AND v.visitedAt >= DATE_SUB(NOW(), INTERVAL ? MONTH)
                    )
                )
                AND COALESCE(p.rejectSms, 0) = 0
                ORDER BY p.name ASC
            `;
            params = [m, m];
        }
        
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Filter Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 환자 목록 조회
router.get('/patients', async (req, res) => {
    try {
        // 대시보드 관리를 위해 모든 환자 반환 (수신 거부자 포함)
        const [rows] = await pool.query('SELECT *, COALESCE(hasKakao, 1) as hasKakao, COALESCE(rejectSms, 0) as rejectSms FROM patients ORDER BY name ASC');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 수신 거부 환자 목록 조회 (hasKakao = 0 또는 rejectSms = 1)
router.get('/patients/reject-list', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, name, chartNo, phone, COALESCE(hasKakao, 1) as hasKakao, COALESCE(rejectSms, 0) as rejectSms 
            FROM patients 
            WHERE hasKakao = 0 OR rejectSms = 1 
            ORDER BY name ASC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 환자 검색
router.get('/patients/search', async (req, res) => {
    const q = req.query.q || req.query.query;
    if (!q) return res.json({ success: true, data: [] });

    try {
        const likeQuery = `%${q}%`;
        const [rows] = await pool.query(
            'SELECT * FROM patients WHERE name LIKE ? OR chartNo LIKE ? OR phone LIKE ?',
            [likeQuery, likeQuery, likeQuery]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

router.post('/patients', async (req, res) => {
    const { chartNo: rawChartNo, name, phone, address, birthGender } = req.body;
    const chartNo = sanitizeChartNo(rawChartNo);
    try {
        // 차트번호 중복 확인
        const [existing] = await pool.query('SELECT id FROM patients WHERE chartNo = ?', [chartNo]);
        if (existing.length > 0) {
            return res.json({ success: false, message: '이미 존재하는 차트번호입니다' });
        }

        const [result] = await pool.query(
            'INSERT INTO patients (chartNo, name, phone, address, birthGender, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
            [chartNo, name, phone, address || '', birthGender || '']
        );

        const newId = result.insertId;
        const [newPatient] = await pool.query('SELECT * FROM patients WHERE id = ?', [newId]);

        // 실시간 동기화 이벤트 발생
        const io = req.app.get('io');
        if (io) io.emit('patients:update', { action: 'create', data: newPatient[0] });

        res.json({ success: true, id: newId, data: newPatient[0] });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 카카오톡 사용 안 함 여부 수정 (hasKakao 필드 반전 사용)
router.put('/patients/:id/kakao-status', async (req, res) => {
    const { id } = req.params;
    const { hasKakao } = req.body; // true면 사용함, false면 사용안함
    try {
        await pool.query('UPDATE patients SET hasKakao = ? WHERE id = ?', [hasKakao ? 1 : 0, id]);
        
        const io = req.app.get('io');
        if (io) io.emit('patients:update', { action: 'update', id });

        res.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 문자 수신 거부 여부 수정
router.put('/patients/:id/sms-reject', async (req, res) => {
    const { id } = req.params;
    const { rejectSms } = req.body;
    try {
        await pool.query('UPDATE patients SET rejectSms = ? WHERE id = ?', [rejectSms ? 1 : 0, id]);
        
        const io = req.app.get('io');
        if (io) io.emit('patients:update', { action: 'update', id });

        res.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 환자 수정
router.put('/patients/:id', async (req, res) => {
    const { id } = req.params;
    const { chartNo: rawChartNo, name, phone, address, birthGender } = req.body;
    const chartNo = sanitizeChartNo(rawChartNo);
    try {
        const [result] = await pool.query(
            'UPDATE patients SET chartNo=?, name=?, phone=?, address=?, birthGender=?, updatedAt=NOW() WHERE id=?',
            [chartNo, name, phone, address || '', birthGender || '', id]
        );

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: '환자를 찾을 수 없습니다' });
        }

        // 실시간 동기화 이벤트 발생
        const io = req.app.get('io');
        if (io) io.emit('patients:update', { action: 'update', id });

        res.json({ success: true });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 환자 삭제
router.delete('/patients/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM patients WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.json({ success: false, message: '환자를 찾을 수 없습니다' });
        }

        // 실시간 동기화 이벤트 발생
        const io = req.app.get('io');
        if (io) io.emit('patients:update', { action: 'delete', id });

        res.json({ success: true, message: '환자가 삭제되었습니다' });
    } catch (error) {
        console.error('Database Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 엑셀 파일 업로드 및 환자 등록
router.post('/patients/upload-excel', upload.single('excel'), async (req, res) => {
    if (!req.file) {
        return res.json({ success: false, message: '파일이 업로드되지 않았습니다.' });
    }

    try {
        // 엑셀 데이터 읽기
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // 2차원 배열로 변환 (헤더 포함)
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        
        // 데이터가 없는 경우
        if (rows.length <= 1) {
            return res.json({ success: false, message: '엑셀 파일에 데이터가 없습니다.' });
        }

        const patients = [];
        const errors = [];
        let totalCount = 0;
        let successCount = 0;
        let duplicateCount = 0;

        // 기존 환자 정보 캐싱 (중복 체크 최적화)
        const [existingRows] = await pool.query('SELECT chartNo, name FROM patients');
        const existingChartNos = new Set(existingRows.map(r => String(r.chartNo)));
        const existingNames = new Set(existingRows.map(r => r.name));

        // 데이터 행 처리 (첫 번째 행은 헤더로 가정하고 스킵할 수 있으나, 데이터 시작 위치에 따라 조절)
        // 사용자가 제공한 서식: A(0):이름, B(1):차트번호, E(4):휴대폰, H(7):주민번호, N(13):주소
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            // 필수 데이터(이름, 차트번호)가 없으면 스킵 (헤더 포함)
            const name = String(row[0] || '').trim();
            const chartNo = sanitizeChartNo(row[1]);
            
            if (!name || !chartNo || name === '환자 이름' || name === '성함') continue;
            
            totalCount++;

            // 중복 체크 (차트번호 또는 이름)
            if (existingChartNos.has(chartNo) || existingNames.has(name)) {
                duplicateCount++;
                continue;
            }

            const phone = String(row[4] || '').trim();
            const residentNo = String(row[7] || '').trim(); // YYMMDD-GXXXXXX
            const address = String(row[13] || '').trim();

            // 주민번호에서 생년월일-성별 추출 (YYMMDD-G)
            let birthGender = '';
            if (residentNo) {
                const match = residentNo.match(/^(\d{6})-?(\d)/);
                if (match) {
                    birthGender = `${match[1]}-${match[2]}`;
                }
            }

            try {
                await pool.query(
                    'INSERT INTO patients (chartNo, name, phone, address, birthGender, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
                    [chartNo, name, phone, address, birthGender]
                );
                successCount++;
                
                // 캐시 업데이트
                existingChartNos.add(chartNo);
                existingNames.add(name);
            } catch (err) {
                console.error(`Row ${i + 1} insert error:`, err);
                errors.push(`행 ${i + 1} (${name}): ${err.message}`);
            }
        }

        res.json({
            success: true,
            totalCount,
            successCount,
            duplicateCount,
            errors
        });

    } catch (error) {
        console.error('Excel Upload Error:', error);
        res.json({ success: false, message: '엑셀 처리 중 오류가 발생했습니다: ' + error.message });
    }
});

module.exports = router;
