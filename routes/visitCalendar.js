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
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`; // Last day of month (KST 안전)

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

        // 2. 신환/구환 분류를 위한 데이터 준비
        // 해당 월에 내원한 모든 환자 ID (역대 기록 및 오늘 기록 포함)
        const [todayRows] = await pool.query(`
            SELECT patientId, patientName as name, chartNo, DATE_FORMAT(visitedAt, '%H:%i') as time,
                   DATE_FORMAT(date, '%Y-%m-%d') as visitDate
            FROM today_visits
            WHERE date BETWEEN ? AND ?
        `, [startDate, endDate]);

        const allPatientIds = [...new Set([
            ...visits.map(v => v.patientId),
            ...todayRows.map(v => v.patientId)
        ])];

        const firstVisitDateMap = {}; // { patientId: 'YYYY-MM-DD' }
        if (allPatientIds.length > 0) {
            // 각 환자별 역대 최단 내원일 조회 (history + today_visits 중 빠른 쪽)
            // history에 있는 경우 history의 최단일이 무조건 오늘보다 빠르거나 같음
            const [firstVisits] = await pool.query(`
                SELECT patientId, MIN(COALESCE(entryTime, CAST(date AS DATETIME))) as firstVisitTime
                FROM treatment_history
                WHERE patientId IN (?)
                GROUP BY patientId
            `, [allPatientIds]);

            firstVisits.forEach(fv => {
                // fv.firstVisitTime은 'YYYY-MM-DD HH:mm:ss' 형식의 문자열 (dateStrings: true 설정 때문)
                if (fv.firstVisitTime) {
                    firstVisitDateMap[fv.patientId] = fv.firstVisitTime.split(' ')[0];
                }
            });

            // history에 없는 환자는 오늘(today_visits)이 처음임
            allPatientIds.forEach(id => {
                if (!firstVisitDateMap[id]) {
                    // todayRows에서 해당 환자의 가장 빠른 날짜 찾기
                    const ptTodayVisits = todayRows.filter(tr => tr.patientId === id);
                    if (ptTodayVisits.length > 0) {
                        const earliestToday = ptTodayVisits.sort((a, b) => a.visitDate.localeCompare(b.visitDate))[0].visitDate;
                        firstVisitDateMap[id] = earliestToday;
                    }
                }
            });
        }

        // 3. 데이터를 날짜별로 그룹화 및 타입 판별
        const visitsByDate = {};
        let newPatientCount = 0;
        let returningPatientCount = 0;
        const countedAsNewInMonth = new Set();
        const countedAsReturningInMonth = new Set();

        // (1) History 데이터 처리
        visits.forEach(v => {
            if (!visitsByDate[v.visitDate]) visitsByDate[v.visitDate] = [];
            
            const firstDate = firstVisitDateMap[v.patientId];
            const isNewVisit = v.visitDate === firstDate;
            const type = isNewVisit ? 'new' : 'returning';

            visitsByDate[v.visitDate].push({
                patientId: v.patientId,
                name: v.patientName,
                chartNo: v.chartNo,
                time: v.visitTime,
                type: type
            });

            // 통계용: 이 달에 처음 온 환자면 신환 카운트
            if (isNewVisit && !countedAsNewInMonth.has(v.patientId)) {
                newPatientCount++;
                countedAsNewInMonth.add(v.patientId);
            } else if (!isNewVisit && !countedAsReturningInMonth.has(v.patientId) && !countedAsNewInMonth.has(v.patientId)) {
                // 신환으로 이미 카운트 안 된 경우만 구환으로 카운트
                // (엄밀히는 해당 월에 '신환' 방문이 없고 '재진' 방문만 있는 경우)
            }
        });

        // (2) 오늘/미이관 데이터 병합
        todayRows.forEach(tr => {
            const vDate = tr.visitDate;
            if (!visitsByDate[vDate]) visitsByDate[vDate] = [];
            
            const existingInHistoryNames = new Set(
                visitsByDate[vDate].map(v => `${v.name}_${v.chartNo}_${v.time}`)
            );

            const uniqueKey = `${tr.name}_${tr.chartNo}_${tr.time}`;
            if (!existingInHistoryNames.has(uniqueKey)) {
                const firstDate = firstVisitDateMap[tr.patientId];
                const isNewVisit = vDate === firstDate;
                const type = isNewVisit ? 'new' : 'returning';

                visitsByDate[vDate].push({
                    patientId: tr.patientId,
                    name: tr.name,
                    chartNo: tr.chartNo,
                    time: tr.time,
                    type: type
                });

                if (isNewVisit && !countedAsNewInMonth.has(tr.patientId)) {
                    newPatientCount++;
                    countedAsNewInMonth.add(tr.patientId);
                }
            }
        });

        // 월간 통계 보정: 이 달에 온 전체 환자 중 '신환'으로 분류 안 된 환자들은 '구환'임
        allPatientIds.forEach(id => {
            if (!countedAsNewInMonth.has(id)) {
                returningPatientCount++;
            }
        });
        
        // 각 날짜별 정렬
        Object.keys(visitsByDate).forEach(date => {
            visitsByDate[date].sort((a, b) => a.time.localeCompare(b.time));
        });

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
