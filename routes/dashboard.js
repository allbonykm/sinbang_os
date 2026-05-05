const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { getKSTDate, getKSTMonth } = require('../utils/dateUtils');
const { sanitizeChartNo } = require('../utils/patientUtils');

// ===========================================
// 공개 통계 API (웹사이트/사이니지용)
// ===========================================

// 누적 처방 건수 조회 (Hero 섹션용)
router.get('/public/stats', async (req, res) => {
    try {
        // 1. 첩약(조제탕약) 처방 건수
        // const [prescRows] = await pool.query('SELECT COUNT(*) as count FROM prescriptions');
        // const herbalCount = prescRows[0].count;
        const herbalCount = 0;

        // 2. 경옥고/공진단/기타 처방 건수 (비급여 내역 기준)
        const [nonBenefitRows] = await pool.query(`
            SELECT SUM(quantity) as count FROM non_reimbursements 
            WHERE itemName LIKE '%공진단%' OR itemName LIKE '%경옥고%' OR
                  itemName LIKE '%소체환%' OR itemName LIKE '%신선불취환%' OR
                  itemName LIKE '%비만%' OR itemName LIKE '%성장%' OR itemName LIKE '%수험생%'
        `);
        const eventCount = parseInt(nonBenefitRows[0].count) || 0;

        // 3. 보정값
        const totalOffset = 1500;
        const eventOffset = 500;

        res.json({ success: true, count: herbalCount + eventCount + totalOffset + eventOffset });
    } catch (error) {
        console.error('Stats Error:', error);
        res.json({ success: false, count: 0, message: error.message });
    }
});

// ===========================================
// 대시보드 API
// ===========================================

// 대시보드 요약 정보 조회
router.get('/dashboard/summary', async (req, res) => {
    console.log(`[Dashboard] Summary requested at ${new Date().toISOString()}`);
    try {
        const today = getKSTDate();
        const thisMonth = getKSTMonth(); // e.g., '2026-04'

        // 오늘 남은 예약
        const [bookingRows] = await pool.query(
            "SELECT COUNT(*) as count FROM bookings WHERE date = ? AND status NOT IN ('노쇼', '취소', '내원완료', '완료')",
            [today]
        );

        // 이번 달 비급여 결제 총액 (LIKE 대신 % 사용)
        const [paymentRows] = await pool.query(
            "SELECT SUM(amount) as total FROM non_reimbursements WHERE date LIKE ?",
            [`${thisMonth}%`]
        );

        const monthlyPrescriptions = 0;

        // 이번 달 메시지 발송 건수 (DATE_FORMAT 사용하여 더 견고하게)
        const [msgRows] = await pool.query(
            "SELECT type, COUNT(*) as count FROM message_history WHERE DATE_FORMAT(sentAt, '%Y-%m') = ? GROUP BY type",
            [thisMonth]
        );

        let smsCount = 0;
        let alimtalkCount = 0;
        let reservedCount = 0;
        let totalMessages = 0;

        if (msgRows && msgRows.length > 0) {
            msgRows.forEach(row => {
                const count = parseInt(row.count) || 0;
                totalMessages += count;
                if (row.type === 'SMS' || row.type === 'LMS') smsCount += count;
                else if (row.type.includes('알림톡') || row.type.includes('톡')) alimtalkCount += count;
                else if (row.type === '예약') reservedCount += count;
            });
        }

        // 자보 환자 통계 (테이블 미존재 시 대비)
        let activeJaboPatients = 0;
        let todayJaboVisits = 0;
        try {
            const [jaboRows] = await pool.query(
                "SELECT COUNT(*) as activeCount FROM ta_patient WHERE status = 'active'"
            );
            activeJaboPatients = jaboRows[0]?.activeCount || 0;

            const [todayJaboRows] = await pool.query(
                "SELECT COUNT(*) as todayCount FROM today_visits v JOIN ta_patient t ON v.patientId = t.patientId WHERE v.date = ? AND t.status = 'active'",
                [today]
            );
            todayJaboVisits = todayJaboRows[0]?.todayCount || 0;
        } catch (e) {
            console.warn('[Dashboard] Jabo stats failed (Table might be missing):', e.message);
        }

        res.json({
            success: true,
            data: {
                todayBookings: bookingRows[0]?.count || 0,
                monthlyNonReimbursement: paymentRows[0]?.total || 0,
                monthlyPrescriptions: monthlyPrescriptions,
                monthlyMessages: totalMessages,
                monthlySmsCount: smsCount,
                monthlyAlimtalkCount: alimtalkCount,
                monthlyReservedCount: reservedCount,
                activeJaboPatients: activeJaboPatients,
                todayJaboVisits: todayJaboVisits,
                reviewCount: 0 // surveys 테이블 확인 필요
            }
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 환자별 통합 정보 조회
router.get('/dashboard/patient/:chartNo', async (req, res) => {
    try {
        const { chartNo: rawChartNo } = req.params;
        const chartNo = sanitizeChartNo(decodeURIComponent(rawChartNo));

        // 1. 환자 정보 (수신 거부 필드 명시적 처리)
        const [patientRows] = await pool.query(
            'SELECT *, COALESCE(hasKakao, 1) as hasKakao, COALESCE(rejectSms, 0) as rejectSms FROM patients WHERE chartNo = ? OR name = ?',
            [chartNo, chartNo]
        );
        if (patientRows.length === 0) {
            return res.status(404).json({ success: false, message: '환자를 찾을 수 없습니다.' });
        }
        const patient = patientRows[0];

        // 2. 예약 이력
        const [bookings] = await pool.query(
            "SELECT id, patientId, chartNo, name, patientName, phone, DATE_FORMAT(date, '%Y-%m-%d') as date, time, status, notes, purpose, platform, updatedAt FROM bookings WHERE patientId = ? OR chartNo = ? ORDER BY date DESC, time DESC LIMIT 20",
            [patient.id, patient.chartNo]
        );

        // 3. 수납 이력
        const [payments] = await pool.query(
            "SELECT id, patientId, itemName, amount, method, quantity, DATE_FORMAT(date, '%Y-%m-%d') as date, updatedAt FROM non_reimbursements WHERE patientId = ? ORDER BY date DESC LIMIT 20",
            [patient.id]
        );

        const prescriptions = [];

        res.json({
            success: true,
            data: {
                patient,
                bookings,
                payments,
                prescriptions,
                jabo: null
            }
        });
    } catch (error) {
        console.error('Patient Dashboard Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
