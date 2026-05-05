const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { getKSTDate } = require('../utils/dateUtils');

/**
 * GET /api/visit-calendar
 * 월간 내원 환자 및 신환/구환 요약 데이터 조회
 */
router.get('/visit-calendar', async (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'Year and month are required' });
        }

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

        // 1. 해당 월 내원한 모든 환자 목록 및 상세 (중복 허용)
        const [visits] = await pool.query(`
            SELECT 
                patientId, 
                patientName, 
                chartNo, 
                COALESCE(DATE_FORMAT(entryTime, '%Y-%m-%d'), DATE_FORMAT(date, '%Y-%m-%d')) as visitDate,
                COALESCE(DATE_FORMAT(entryTime, '%H:%i'), '--:--') as visitTime
            FROM treatment_history
            WHERE 
                (entryTime >= ? AND entryTime < DATE_ADD(?, INTERVAL 1 DAY))
                OR (entryTime IS NULL AND date BETWEEN ? AND ?)
            ORDER BY COALESCE(entryTime, CAST(date AS DATETIME)) ASC
        `, [startDate, endDate, startDate, endDate]);

        // 2. 신환/구환 분류를 위한 환자별 최초 내원일 조회
        // 해당 월에 내원한 환자 ID들만 추출
        const uniquePatientIds = [...new Set(visits.map(v => v.patientId))];
        
        let newPatientCount = 0;
        let returningPatientCount = 0;
        const patientTypeMap = {}; // { patientId: 'new' | 'returning' }

        if (uniquePatientIds.length > 0) {
            const [firstVisits] = await pool.query(`
                SELECT patientId, MIN(COALESCE(entryTime, CAST(date AS DATETIME))) as firstVisitTime
                FROM treatment_history
                WHERE patientId IN (?)
                GROUP BY patientId
            `, [uniquePatientIds]);

            firstVisits.forEach(fv => {
                const fvDate = new Date(fv.firstVisitTime);
                const queryMonthStart = new Date(startDate);
                const queryMonthEnd = new Date(endDate);
                queryMonthEnd.setHours(23, 59, 59, 999);

                if (fvDate >= queryMonthStart && fvDate <= queryMonthEnd) {
                    newPatientCount++;
                    patientTypeMap[fv.patientId] = 'new';
                } else {
                    returningPatientCount++;
                    patientTypeMap[fv.patientId] = 'returning';
                }
            });
        }

        // 3. 데이터를 날짜별로 그룹화
        const visitsByDate = {};
        visits.forEach(v => {
            if (!visitsByDate[v.visitDate]) {
                visitsByDate[v.visitDate] = [];
            }
            visitsByDate[v.visitDate].push({
                patientId: v.patientId,
                name: v.patientName,
                chartNo: v.chartNo,
                time: v.visitTime,
                type: patientTypeMap[v.patientId]
            });
        });

        // 4. 오늘 내원 환자 실시간 데이터 병합 (오늘이 해당 월에 포함될 경우)
        const todayKST = getKSTDate();
        if (todayKST >= startDate && todayKST <= endDate) {
            const [todayRows] = await pool.query(`
                SELECT patientId, patientName as name, chartNo, DATE_FORMAT(visitedAt, '%H:%i') as time
                FROM today_visits
                WHERE date = ?
            `, [todayKST]);

            // 오늘 방문 기록이 treatment_history에는 아직 안 들어갔을 수 있으므로 병합
            // (이미 들어가 있는 경우 중복 체크 필요)
            const existingInHistoryNames = new Set(
                (visitsByDate[todayKST] || []).map(v => `${v.name}_${v.chartNo}_${v.time}`)
            );

            if (!visitsByDate[todayKST]) visitsByDate[todayKST] = [];
            
            todayRows.forEach(tr => {
                const uniqueKey = `${tr.name}_${tr.chartNo}_${tr.time}`;
                if (!existingInHistoryNames.has(uniqueKey)) {
                    visitsByDate[todayKST].push({
                        patientId: tr.patientId,
                        name: tr.name,
                        chartNo: tr.chartNo,
                        time: tr.time,
                        type: patientTypeMap[tr.patientId] || 'unknown',
                        isRealtime: true
                    });
                }
            });
            
            // 시간순 정렬
            visitsByDate[todayKST].sort((a, b) => a.time.localeCompare(b.time));
        }

        res.json({
            success: true,
            summary: {
                newPatients: newPatientCount,
                returningPatients: returningPatientCount
            },
            visits: visitsByDate
        });

    } catch (error) {
        console.error('[VisitCalendar] API Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
