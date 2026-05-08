const pool = require('../config/db');
const sens = require('./naver-sens');
const { ALIMTALK_EVENTS } = require('./alimtalk-manager');
const { formatKoreanDate, formatKoreanTime } = require('./dateUtils');

/**
 * bookingSync - MariaDB Version
 * Synchronizes Naver bookings with the database.
 * Handles reschedules by matching existing records on the same day.
 */

// 동시 실행 방지 (Mutex Lock)
let isSyncing = false;

const bookingSync = {
    // 동기화 진행 상태 조회 (외부에서 확인용)
    isBusy: () => isSyncing,

    syncBookings: async (fetchedBookings) => {
        // 동시 실행 방지: 이미 동기화 중이면 건너뜀
        if (isSyncing) {
            console.log('[Sync] 이미 동기화가 진행 중입니다. 건너뜁니다.');
            return { added: 0, updated: 0, skipped: 0, blocked: true };
        }
        isSyncing = true;

        try {
        console.log(`[Sync] Processing ${fetchedBookings.length} bookings from Naver...`);

        let added = 0;
        let updated = 0;
        let skipped = 0;

        for (const newBooking of fetchedBookings) {
            try {
                // 1. Check if patient already visited today (to avoid overwriting fulfilled bookings)
                // Actually, today_visits is for patients who are CURRENTLY in the clinic or finished.
                const [visitRows] = await pool.query(
                    'SELECT id FROM today_visits WHERE bookingId = ? OR (patientName = ? AND DATE(visitedAt) = ?)',
                    [newBooking.bookingId, newBooking.name, newBooking.date]
                );

                if (visitRows.length > 0) {
                    skipped++;
                    continue;
                }

                // 2. Normalize Phone
                const rawPhone = newBooking.phone.replace(/[^0-9]/g, '');
                let formattedPhone = newBooking.phone;
                if (rawPhone.length === 11) {
                    formattedPhone = `${rawPhone.substr(0, 3)}-${rawPhone.substr(3, 4)}-${rawPhone.substr(7, 4)}`;
                }
                const phoneLast4 = rawPhone.slice(-4);

                // 3. Find existing booking to check for Reschedule
                // Match by bookingId OR (Name + Date + PhoneLast4)
                const [existingRows] = await pool.query(
                    `SELECT id, time, naverStatus, bookingId, chartNo FROM bookings 
                     WHERE bookingId = ? OR (name = ? AND date = ? AND phone LIKE ?)`,
                    [newBooking.bookingId, newBooking.name, newBooking.date, `%${phoneLast4}`]
                );

                if (existingRows.length > 0) {
                    const existing = existingRows[0];

                    // Check for changes (Time or Status)
                    if (existing.naverStatus !== newBooking.naverStatus || existing.time !== newBooking.time || !existing.bookingId) {
                        const isTimeChanged = existing.time !== newBooking.time;
                        const isConfirmedNow = (existing.naverStatus !== '확정' && existing.naverStatus !== 'CONFIRM') && 
                                             (newBooking.naverStatus === '확정' || newBooking.naverStatus === 'CONFIRM');
                        
                        await pool.query(
                            `UPDATE bookings SET 
                                time = ?, 
                                naverStatus = ?, 
                                status = ?, 
                                bookingId = ?, 
                                platform = 'naver',
                                updatedAt = NOW()
                             WHERE id = ?`,
                            [
                                newBooking.time,
                                newBooking.naverStatus,
                                mapNaverStatus(newBooking.naverStatus),
                                newBooking.bookingId,
                                existing.id
                            ]
                        );
                        updated++;

                        // [추가] 시간 변경 또는 확정 시 알림톡 발송
                        if (isTimeChanged || isConfirmedNow) {
                            try {
                                const [pRows] = await pool.query('SELECT hasKakao, rejectSms FROM patients WHERE name = ? AND phone LIKE ?', [newBooking.name, `%${phoneLast4}`]);
                                const isReject = pRows.length > 0 && (pRows[0].hasKakao === 0 || pRows[0].rejectSms === 1);
                                
                                if (!isReject && formattedPhone && formattedPhone.length >= 10) {
                                    const resDate = formatKoreanDate(newBooking.date);
                                    const resTime = formatKoreanTime(newBooking.time);
                                    const cleanPhone = formattedPhone.replace(/[^0-9]/g, '');
                                    const currentChartNo = existing.chartNo || '';

                                    const result = await sens.sendAlimTalk(
                                        newBooking.name, 
                                        currentChartNo, 
                                        cleanPhone, 
                                        null, 
                                        ALIMTALK_EVENTS.RESCHEDULE, 
                                        null, 
                                        null, 
                                        { 
                                            "이름": newBooking.name,
                                            "예약날짜": resDate,
                                            "예약시간": resTime
                                        }
                                    );

                                    // 발송 이력 기록
                                    const statusName = result.success ? 'success' : 'failed';
                                    const errorDesc = result.success ? '' : (result.error || '');
                                    
                                    await pool.query(
                                        `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message)
                                        VALUES (?, ?, ?, ?, NOW(), '알림톡', ?, ?, ?)`,
                                        [Date.now() + Math.round(Math.random() * 1000), newBooking.name, currentChartNo, cleanPhone, statusName, ALIMTALK_EVENTS.RESCHEDULE, errorDesc]
                                    );

                                    console.log(`[Sync-Reschedule] Sent notification (${ALIMTALK_EVENTS.RESCHEDULE}) to ${newBooking.name} for ${resDate} ${resTime}`);
                                }
                            } catch (alimError) {
                                console.error('[Sync-Reschedule] 발송 실패:', alimError.message);
                            }
                        }
                    } else {
                        skipped++;
                    }
                } else {
                    // 4. INSERT (New Booking)
                    // Try to find patientId/chartNo from patients table
                    const [patientRows] = await pool.query(
                        'SELECT id, chartNo FROM patients WHERE name = ? AND phone LIKE ?',
                        [newBooking.name, `%${phoneLast4}`]
                    );

                    const patientId = patientRows.length > 0 ? patientRows[0].id : null;
                    const chartNo = patientRows.length > 0 ? patientRows[0].chartNo : '';

                    await pool.query(
                        `INSERT INTO bookings 
                        (patientId, chartNo, name, patientName, phone, date, time, status, naverStatus, bookingId, platform, notes, updatedAt)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'naver', '네이버 예약', NOW())`,
                        [
                            patientId,
                            chartNo,
                            newBooking.name,
                            newBooking.name,
                            formattedPhone,
                            newBooking.date,
                            newBooking.time,
                            mapNaverStatus(newBooking.naverStatus),
                            newBooking.naverStatus,
                            newBooking.bookingId
                        ]
                    );
                    added++;

                    // [추가] 네이버 예약 동기화 시에도 알림톡 발송 (FirstBooking)
                    try {
                        // 수신 거부 및 카카오톡 사용 여부 확인
                        const [pRows] = await pool.query(
                            'SELECT hasKakao, rejectSms FROM patients WHERE name = ? AND (phone = ? OR phone = ? OR phone LIKE ?)', 
                            [newBooking.name, formattedPhone, rawPhone, `%${phoneLast4}`]
                        );
                        const isReject = pRows.length > 0 && (pRows[0].hasKakao === 0 || pRows[0].rejectSms === 1);
                        
                        if (!isReject && formattedPhone && formattedPhone.length >= 10) {
                            const resDate = formatKoreanDate(newBooking.date);
                            const resTime = formatKoreanTime(newBooking.time);
                            const cleanPhone = formattedPhone.replace(/[^0-9]/g, '');

                            const result = await sens.sendAlimTalk(
                                newBooking.name, 
                                chartNo, 
                                cleanPhone, 
                                null, 
                                ALIMTALK_EVENTS.FIRST_BOOKING, 
                                null, 
                                null, 
                                { 
                                    "이름": newBooking.name,
                                    "예약날짜": resDate,
                                    "예약시간": resTime
                                }
                            );

                            // 발송 이력 기록
                            const statusName = result.success ? 'success' : 'failed';
                            const errorDesc = result.success ? '' : (result.error || '');
                            
                            await pool.query(
                                `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message)
                                VALUES (?, ?, ?, ?, NOW(), '알림톡', ?, ?, ?)`,
                                [Date.now() + Math.round(Math.random() * 1000), newBooking.name, chartNo, cleanPhone, statusName, ALIMTALK_EVENTS.FIRST_BOOKING, errorDesc]
                            );

                            console.log(`[Sync-FirstBooking] ${result.success ? 'Success' : 'Failed'}: ${newBooking.name} for ${resDate} ${resTime}`);
                        }
                    } catch (alimError) {
                        console.error('[Sync-FirstBooking] 발송 실패:', alimError.message);
                    }
                }
            } catch (err) {
                console.error(`[Sync] Error processing booking ${newBooking.bookingId}:`, err);
            }
        }

        console.log(`[Sync] MariaDB Sync Complete. Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
        return { added, updated, skipped };

        } finally {
            // Lock 해제: 성공/실패와 관계없이 항상 해제
            isSyncing = false;
        }
    }
};

// Helper: Map Naver raw status to internal status
function mapNaverStatus(naverStatus) {
    if (!naverStatus) return '신청';
    if (naverStatus.includes('취소') || naverStatus.includes('CANCEL')) return '취소';
    if (naverStatus.includes('확정') || naverStatus.includes('CONFIRM')) return '확정';
    if (naverStatus.includes('완료') || naverStatus.includes('COMPLETE')) return '완료';
    if (naverStatus.includes('노쇼') || naverStatus.includes('NOSHOW')) return '노쇼';
    return '신청';
}

module.exports = bookingSync;
