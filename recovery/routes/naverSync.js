const express = require('express');
const router = express.Router();
const NaverSession = require('../api/naver-session');
const NaverBookings = require('../api/naver-bookings');
const bookingSync = require('../utils/bookingSync');

// 동기화 상태 확인
router.get('/status', async (req, res) => {
    try {
        const hasCookies = NaverSession.hasCookies();
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
    try {
        console.log('[API] Manual Naver Booking sync triggered...');
        
        // 1. 데이터 가져오기
        const fetchResult = await NaverBookings.fetchBookings();
        
        if (fetchResult.status === 'success') {
            // 2. DB 동기화
            const syncStats = await bookingSync.syncBookings(fetchResult.data);
            
            // 3. 소켓 알림 (실시간 UI 업데이트용)
            const io = req.app.get('io');
            if (io) {
                io.emit('bookings:update');
            }
            
            res.json({ 
                success: true, 
                message: `동기화 성공: 신규 ${syncStats.added}건, 갱신 ${syncStats.updated}건`,
                stats: syncStats
            });
        } else {
            res.json({ 
                success: false, 
                message: fetchResult.message || '데이터를 가져오는데 실패했습니다.' 
            });
        }
    } catch (error) {
        console.error('[API] Naver Sync Error:', error);
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
