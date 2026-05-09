const pool = require('../config/db');
const sens = require('./naver-sens');
const { formatKoreanDate, formatKoreanTime } = require('./dateUtils');
const { ALIMTALK_EVENTS } = require('./alimtalk-manager');

/**
 * bookingSync - MariaDB Version
 * Synchronizes Naver bookings with the database.
 * Handles reschedules by matching existing records on the same day.
 */
let isSyncing = false; // 동기화 중복 실행 방지용 플래그

const bookingSync = {
    isBusy: () => isSyncing,

    syncBookings: async (fetchedBookings) => {
        if (isSyncing) {
            console.log('[Sync] Already syncing... skipping.');
            return { added: 0, updated: 0, skipped: 0 };
        }

        isSyncing = true;
        console.log(`[Sync] Processing ${fetchedBookings.length} bookings from Naver...`);

        let added = 0;
        let updated = 0;
        let skipped = 0;

        try {
            for (const newBooking of fetchedBookings) {
                try {
                    // 1. Check if patient already visited today (to avoid overwriting fulfilled bookings)
                    const [visitRows] = await pool.query(
                        'SELECT id FROM today_visits WHERE bookingId = ? OR (patientName = ? AND date = ?)',
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

                        // 상태값 정규화 (공백 제거 등)
                        const oldStatus = (existing.naverStatus || '').trim();
                        const newStatus = (newBooking.naverStatus || '').trim();
                        const oldTime = (existing.time || '').trim();
                        const newTime = (newBooking.time || '').trim();

                        // 업데이트 조건 확인
                        const isStatusChanged = oldStatus !== newStatus;
                        const isTimeChanged = oldTime !== newTime;
                        const isIdMissing = !existing.bookingId && newBooking.bookingId;

                        if (isStatusChanged || isTimeChanged || isIdMissing) {
                            const isConfirmedNow = (oldStatus !== '확정' && oldStatus !== 'CONFIRM') && 
                                                 (newStatus === '확정' || newStatus === 'CONFIRM');

                            // 디버깅 로그
                            if (isStatusChanged) console.log(`[Sync-Debug] ${newBooking.name} 상태 불일치: DB("${oldStatus}") vs Naver("${newStatus}")`);
                            if (isTimeChanged) console.log(`[Sync-Debug] ${newBooking.name} 시간 불일치: DB("${oldTime}") vs Naver("${newTime}")`);
                            if (isIdMissing) console.log(`[Sync-Debug] ${newBooking.name} 예약ID 누락: Naver(${newBooking.bookingId})`);

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

                            // [중요] 과거 예약 및 중복 발송 차단 로직
                            const now = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
                            const bookingDateTime = new Date(`${newBooking.date}T${newBooking.time}:00`);
                            const isPastBooking = bookingDateTime < now;

                            if ((isTimeChanged || isConfirmedNow) && !isPastBooking) {
                                try {
                                    const [pRows] = await pool.query('SELECT hasKakao, rejectSms FROM patients WHERE name = ? AND phone LIKE ?', [newBooking.name, `%${phoneLast4}`]);
                                    const isReject = pRows.length > 0 && (pRows[0].hasKakao === 0 || pRows[0].rejectSms === 1);
                                    
                                    if (!isReject && formattedPhone && formattedPhone.length >= 10) {
                                        const resDate = formatKoreanDate(newBooking.date);
                                        const resTime = formatKoreanTime(newBooking.time);
                                        const cleanPhone = formattedPhone.replace(/[^0-9]/g, '');
                                        const currentChartNo = existing.chartNo || '';

                                        // [핵심 개선] 이미 동일한 내용으로 알림톡이 나갔는지 이력 확인
                                        const [historyRows] = await pool.query(
                                            `SELECT id FROM message_history 
                                             WHERE patientName = ? AND phone = ? 
                                             AND message LIKE ? AND message LIKE ? 
                                             AND templateCode = ?`,
                                            [newBooking.name, cleanPhone, `%${resDate}%`, `%${resTime}%`, ALIMTALK_EVENTS.RESCHEDULE]
                                        );

                                        if (historyRows.length === 0) {
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
                                            console.log(`[Sync-Reschedule] Sent notification to ${newBooking.name} for ${resDate} ${resTime}`);
                                        } else {
                                            console.log(`[Sync-Reschedule] Already sent to ${newBooking.name} for ${resDate} ${resTime}. Skipping.`);
                                        }
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

                        // [추가] 신규 예약 알림톡 발송
                        try {
                            const [pRows] = await pool.query('SELECT hasKakao, rejectSms FROM patients WHERE name = ? AND (phone = ? OR phone = ? OR phone LIKE ?)', [newBooking.name, formattedPhone, rawPhone, `%${phoneLast4}`]);
                            const isReject = pRows.length > 0 && (pRows[0].hasKakao === 0 || pRows[0].rejectSms === 1);
                            
                            if (!isReject && formattedPhone && formattedPhone.length >= 10) {
                                const resDate = formatKoreanDate(newBooking.date);
                                const resTime = formatKoreanTime(newBooking.time);
                                const cleanPhone = formattedPhone.replace(/[^0-9]/g, '');

                                // [핵심 개선] 이미 동일한 내용으로 알림톡이 나갔는지 이력 확인
                                const [historyRows] = await pool.query(
                                    `SELECT id FROM message_history 
                                     WHERE patientName = ? AND phone = ? 
                                     AND message LIKE ? AND message LIKE ? 
                                     AND templateCode = ?`,
                                    [newBooking.name, cleanPhone, `%${resDate}%`, `%${resTime}%`, ALIMTALK_EVENTS.FIRST_BOOKING]
                                );

                                if (historyRows.length === 0) {
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
                                    console.log(`[Sync-FirstBooking] Sent notification to ${newBooking.name} for ${resDate} ${resTime}`);
                                } else {
                                    console.log(`[Sync-FirstBooking] Already sent to ${newBooking.name} for ${resDate} ${resTime}. Skipping.`);
                                }
                            }
                        } catch (alimError) {
                            console.error('[Sync-FirstBooking] 발송 실패:', alimError.message);
                        }
                    }
                } catch (err) {
                    console.error(`[Sync] Error processing booking ${newBooking.bookingId}:`, err);
                }
            }
        } finally {
            isSyncing = false;
        }

        console.log(`[Sync] MariaDB Sync Complete. Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
        return { added, updated, skipped };
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
