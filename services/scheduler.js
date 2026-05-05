const bookingSync = require('../utils/bookingSync');
const NaverBookings = require('../api/naver-bookings');

const Scheduler = {
    init: (io) => {
        const cron = require('node-cron');
        console.log('[Scheduler] Initialized. Naver Booking Sync scheduled for every 30 minutes.');

        // Run every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            console.log('[Cron] Starting scheduled Naver Booking sync...');
            try {
                // 1. Fetch
                const result = await NaverBookings.fetchBookings();

                if (result.status === 'success') {
                    // 2. Sync
                    const syncStats = await bookingSync.syncBookings(result.data);
                    console.log(`[Cron] Naver Booking Sync Success. Added: ${syncStats.added}, Updated: ${syncStats.updated}`);
                    
                    // 3. Broadcast to all clients
                    if (io) {
                        io.emit('sync:complete');
                    }
                } else {
                    console.error('[Cron] Naver Booking Fetch failed:', result.message);
                }
            } catch (error) {
                console.error('[Cron] Naver Booking Sync Critical Error:', error);
            }
        });
    }
};

module.exports = Scheduler;
