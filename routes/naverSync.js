const express = require('express');
const router = express.Router();
const NaverSession = require('../api/naver-session');
const NaverBookings = require('../api/naver-bookings');
const bookingSync = require('../utils/bookingSync');

// 동기화 상태 확인
router.get('/status', async (req, res) => {
    try {
        const hasCookies = (typeof NaverSession.hasCookies === 'function') ? NaverSession.hasCookies() : false;
        res.json({ 
            success: true, 
            loggedIn: hasCookies,
            message: hasCookies ? '네이버 세션이 유효합니다.' : '네이버 로그인이 필요합니다.'
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 네이버 로그인 (Puppeteer 창 띄우기)
router.get('/login', async (req, res) => {
    try {
        // NaverSession.login()은 Puppeteer를 headless: false로 띄워 사용자가 로그인하게 함
        const result = await NaverSession.login();
        res.json(result);
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 수동 동기화 트리거
router.post('/trigger', async (req, res) => {
    // 동시 실행 방지 체크
    if (bookingSync.isBusy()) {
        return res.json({
            success: false,
            message: '이미 동기화가 진행 중입니다. 잠시 후 다시 시도해주세요.'
        });
    }

    const io = req.app.get('io');
    
    // 0. 즉시 응답 반환 (Puppeteer가 오래 걸릴 수 있으므로 비동기 처리)
    res.json({ 
        success: true, 
        message: '네이버 동기화를 시작합니다. 잠시만 기다려주세요...' 
    });

    // 백그라운드 작업 시작
    (async () => {
        try {
            console.log('[API] Manual Naver Booking sync started in background...');
            
            // 1. 데이터 가져오기
            const fetchResult = await NaverBookings.fetchBookings();
            
            if (fetchResult.status === 'success') {
                // 2. DB 동기화
                const syncStats = await bookingSync.syncBookings(fetchResult.data);
                
                // 3. 소켓 알림
                if (io) {
                    io.emit('sync:complete', {
                        message: `동기화 성공: 신규 ${syncStats.added}건, 갱신 ${syncStats.updated}건`,
                        stats: syncStats
                    });
                    io.emit('bookings:update'); // 기존 호환성 유지
                }
                console.log('[API] Background Naver Sync completed successfully.');
            } else {
                console.warn('[API] Background Naver Sync failed:', fetchResult.message);
                if (io) {
                    io.emit('sync:error', { 
                        message: fetchResult.message || '데이터를 가져오는데 실패했습니다.',
                        status: fetchResult.status
                    });
                }
            }
        } catch (error) {
            console.error('[API] Background Naver Sync Error:', error);
            if (io) {
                io.emit('sync:error', { message: '서버 내부 오류로 동기화에 실패했습니다.' });
            }
        }
    })();
});

module.exports = router;
