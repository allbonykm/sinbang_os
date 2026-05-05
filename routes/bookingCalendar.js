const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { getKSTDate } = require('../utils/dateUtils');

/**
 * GET /api/booking-calendar
 * 월간 예약 환자 요약 데이터 조회
 */
router.get('/booking-calendar', async (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'Year and month are required' });
        }

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        // 1. 해당 월 예약된 모든 환자 목록 조회
        const [bookings] = await pool.query(`
            SELECT 
                id,
                patientId, 
                name as patientName, 
                chartNo, 
                DATE_FORMAT(date, '%Y-%m-%d') as bookingDate,
                time as bookingTime,
                platform,
                status,
                naverStatus
            FROM bookings
            WHERE 
                date BETWEEN ? AND ?
            ORDER BY date ASC, time ASC
        `, [startDate, endDate]);

        // 2. 데이터를 날짜별로 그룹화
        const bookingsByDate = {};
        let naverCount = 0;
        let manualCount = 0;

        bookings.forEach(b => {
            if (!bookingsByDate[b.bookingDate]) {
                bookingsByDate[b.bookingDate] = [];
            }
            
            const isNaver = b.platform === 'naver' || (b.bookingId && b.bookingId.length > 5);
            if (isNaver) naverCount++;
            else manualCount++;

            bookingsByDate[b.bookingDate].push({
                id: b.id,
                patientId: b.patientId,
                name: b.patientName,
                chartNo: b.chartNo,
                time: b.bookingTime,
                platform: isNaver ? 'naver' : 'manual',
                status: b.status,
                naverStatus: b.naverStatus
            });
        });

        res.json({
            success: true,
            summary: {
                total: bookings.length,
                naver: naverCount,
                manual: manualCount
            },
            bookings: bookingsByDate
        });

    } catch (error) {
        console.error('[BookingCalendar] API Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
