const bookingSync = require('../utils/bookingSync');
const NaverBookings = require('../api/naver-bookings');

// 연속 실패 카운터 (세션 만료 감지용)
let consecutiveFailures = 0;
const MAX_SILENT_FAILURES = 3; // 이 횟수 초과 시 대시보드 경고

const Scheduler = {
    init: (io) => {
        const cron = require('node-cron');
        console.log('[Scheduler] Initialized. Naver Booking Sync scheduled for every 30 minutes.');

        // 30분마다 자동 동기화
        cron.schedule('*/30 * * * *', async () => {
            // 동시 실행 방지: 이미 동기화 중이면 건너뜀
            if (bookingSync.isBusy()) {
                console.log('[Cron] 이미 동기화가 진행 중입니다. 건너뜁니다.');
                return;
            }

            console.log('[Cron] Starting scheduled Naver Booking sync...');
            try {
                // 1. 데이터 가져오기
                const result = await NaverBookings.fetchBookings();

                if (result.status === 'success') {
                    // 2. DB 동기화
                    const syncStats = await bookingSync.syncBookings(result.data);
                    console.log(`[Cron] Naver Booking Sync Success. Added: ${syncStats.added}, Updated: ${syncStats.updated}`);

                    // 성공 시 실패 카운터 초기화
                    consecutiveFailures = 0;

                    // 3. 클라이언트 알림
                    if (io) {
                        io.emit('sync:complete', {
                            message: `자동 동기화 성공: 신규 ${syncStats.added}건, 갱신 ${syncStats.updated}건`,
                            stats: syncStats,
                            auto: true
                        });
                    }
                } else {
                    consecutiveFailures++;
                    console.error(`[Cron] Naver Booking Fetch failed (${consecutiveFailures}회 연속): ${result.message}`);

                    // 세션 만료 또는 연속 실패 시 대시보드 경고
                    if (io && (result.status === 'expired' || result.status === 'no_session')) {
                        io.emit('sync:session-expired', {
                            message: '네이버 로그인 세션이 만료되었습니다. 다시 로그인해주세요.',
                            failures: consecutiveFailures
                        });
                    } else if (io && consecutiveFailures >= MAX_SILENT_FAILURES) {
                        io.emit('sync:error', {
                            message: `네이버 동기화가 ${consecutiveFailures}회 연속 실패했습니다. 확인이 필요합니다.`,
                            failures: consecutiveFailures
                        });
                    }
                }
            } catch (error) {
                consecutiveFailures++;
                console.error(`[Cron] Naver Booking Sync Critical Error (${consecutiveFailures}회 연속):`, error.message);

                if (io && consecutiveFailures >= MAX_SILENT_FAILURES) {
                    io.emit('sync:error', {
                        message: `네이버 동기화 시스템 오류 (${consecutiveFailures}회 연속): ${error.message}`,
                        failures: consecutiveFailures
                    });
                }
            }
        });
    }
};

module.exports = Scheduler;
