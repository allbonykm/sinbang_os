const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { getKSTDate } = require('../utils/dateUtils');

// ===========================================
// 환자 내원간격 분석 API (신방 OS 이식)
// ===========================================

/**
 * GET /api/visit-analysis
 * 환자별 내원간격 데이터 조회
 * Query: search(환자명/차트번호), filter(all/7/15/30/30plus/first-only)
 */
router.get('/visit-analysis', async (req, res) => {
    try {
        const { search, filter } = req.query;
        const today = getKSTDate();

        // 1. 오늘 내원 환자 목록
        const [todayVisits] = await pool.query(
            'SELECT patientId, visitedAt FROM today_visits WHERE date = ?',
            [today]
        );
        const todayVisitMap = {};
        todayVisits.forEach(v => {
            todayVisitMap[String(v.patientId)] = v.visitedAt;
        });
        const todayPatientIds = new Set(Object.keys(todayVisitMap));

        // 2. 전체 치료 이력에서 환자별 내원일 추출 (날짜별 그룹화)
        // entryTime이 없을 경우 대비하여 date 필드 활용 (Coalesce 처리)
        // 환자 마스터와 ID 불일치 시를 대비하여 patientName, chartNo도 함께 추출
        const [historyRows] = await pool.query(`
            SELECT 
                patientId,
                MAX(patientName) as patientName,
                MAX(chartNo) as chartNo,
                COALESCE(DATE_FORMAT(entryTime, '%Y-%m-%d'), DATE_FORMAT(date, '%Y-%m-%d')) as visitDate,
                COALESCE(MAX(entryTime), CAST(MAX(date) AS DATETIME)) as maxEntryTime
            FROM treatment_history
            GROUP BY patientId, COALESCE(DATE(entryTime), date)
            ORDER BY patientId, maxEntryTime DESC
        `);

        // 3. 환자 마스터 정보
        const [patients] = await pool.query(
            'SELECT id, name, chartNo, birthGender FROM patients'
        );
        const patientMap = {};
        patients.forEach(p => {
            patientMap[String(p.id)] = p;
        });

        // 4. 환자별 내원일 그룹핑 및 환자 기본 정보 매핑
        const patientVisits = {};
        const patientMaxTimeMap = {}; 
        const patientInfoInHistory = {}; // 명단에 없을 경우를 대비한 백업 정보

        // 오늘 내원 정보 먼저 반영 (오늘이 항상 최신이 되도록)
        todayVisits.forEach(v => {
            const pid = String(v.patientId);
            if (!patientVisits[pid]) {
                patientVisits[pid] = [];
                patientMaxTimeMap[pid] = v.visitedAt;
            }
            const dateStr = today;
            if (!patientVisits[pid].includes(dateStr)) {
                patientVisits[pid].push(dateStr);
            }
        });

        historyRows.forEach(row => {
            const pid = String(row.patientId);
            if (!patientVisits[pid]) {
                patientVisits[pid] = [];
                patientMaxTimeMap[pid] = row.maxEntryTime;
            }
            if (!patientInfoInHistory[pid]) {
                patientInfoInHistory[pid] = { name: row.patientName, chartNo: row.chartNo };
            }
            if (!patientVisits[pid].includes(row.visitDate)) {
                patientVisits[pid].push(row.visitDate);
            }
            if (!patientMaxTimeMap[pid] || new Date(row.maxEntryTime) > new Date(patientMaxTimeMap[pid])) {
                patientMaxTimeMap[pid] = row.maxEntryTime;
            }
        });

        // 5. 분석 데이터 생성
        const results = [];
        let firstVisitOnlyCount = 0;
        let totalFirstVisitPatients = 0;
        let over30DaysCount = 0;

        Object.entries(patientVisits).forEach(([pid, dates]) => {
            // 환자 명단(patientMap)에 없으면 진료 기록 상의 정보(patientInfoInHistory)를 사용
            const patient = patientMap[pid] || patientInfoInHistory[pid];
            if (!patient) return;

            const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
            const totalVisits = sortedDates.length;
            const recentDates = sortedDates.slice(0, 5);

            const intervals = [];
            for (let i = 0; i < recentDates.length - 1; i++) {
                const diff = Math.floor(
                    (new Date(recentDates[i]) - new Date(recentDates[i + 1])) / (1000 * 60 * 60 * 24)
                );
                intervals.push(diff);
            }

            const lastVisitDate = sortedDates[0];
            const daysSinceLastVisit = Math.floor(
                (new Date(today) - new Date(lastVisitDate)) / (1000 * 60 * 60 * 24)
            );

            const isToday = todayPatientIds.has(pid);
            const isFirstOnly = totalVisits === 1;

            totalFirstVisitPatients++;
            if (isFirstOnly) firstVisitOnlyCount++;
            if (daysSinceLastVisit >= 30 && !isToday) over30DaysCount++;

            if (search) {
                const s = search.toLowerCase();
                if (!patient.name.toLowerCase().includes(s) &&
                    !(patient.chartNo && patient.chartNo.toLowerCase().includes(s))) {
                    return;
                }
            }

            if (filter && filter !== 'all') {
                if (filter === '7' && daysSinceLastVisit > 7) return;
                if (filter === '15' && (daysSinceLastVisit <= 7 || daysSinceLastVisit > 15)) return;
                if (filter === '30' && (daysSinceLastVisit <= 15 || daysSinceLastVisit > 30)) return;
                if (filter === '30plus' && daysSinceLastVisit <= 30) return;
                if (filter === 'first-only' && !isFirstOnly) return;
            }

            const lastVisitFull = isToday ? todayVisitMap[pid] : patientMaxTimeMap[pid];

            results.push({
                patientId: pid,
                name: patient.name,
                chartNo: patient.chartNo,
                birthGender: patient.birthGender || '',
                totalVisits,
                recentDates,
                intervals,
                lastVisitDate,
                lastVisitFull,
                daysSinceLastVisit: isToday ? 0 : daysSinceLastVisit,
                isToday,
                isFirstOnly
            });
        });

        results.sort((a, b) => {
            if (a.isToday && !b.isToday) return -1;
            if (!a.isToday && b.isToday) return 1;
            const timeA = a.lastVisitFull ? new Date(a.lastVisitFull).getTime() : 0;
            const timeB = b.lastVisitFull ? new Date(b.lastVisitFull).getTime() : 0;
            return timeB - timeA;
        });

        res.json({
            success: true,
            data: results,
            summary: {
                firstVisitOnlyCount,
                totalFirstVisitPatients,
                firstVisitOnlyRate: totalFirstVisitPatients > 0
                    ? Math.round((firstVisitOnlyCount / totalFirstVisitPatients) * 100)
                    : 0,
                over30DaysCount
            }
        });

    } catch (error) {
        console.error('[VisitAnalysis] API Error:', error);
        res.json({ success: false, message: error.message, data: [], summary: {} });
    }
});

module.exports = router;
