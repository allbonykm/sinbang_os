const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const NaverSession = require('./naver-session');

// This business ID is derived from the review URL seen in api/naver-reviews.js
// bookingBusinessId=535748
const BUSINESS_ID = '535748';
const BOOKING_LIST_URL = `https://partner.booking.naver.com/bizes/${BUSINESS_ID}/booking-list-view`;

const NaverBookings = {
    fetchBookings: async () => {
        console.log("[NaverBookings] Fetching bookings...");
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: 'new', // Use new headless mode
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--window-size=1280,1024',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ]
            });
            const page = await browser.newPage();

            // Set User-Agent for this page
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 1. Load Session
            const loaded = await NaverSession.loadSession(page);
            if (!loaded) {
                await browser.close();
                return { status: 'no_session', message: '로그인 세션 정보(쿠키)가 없습니다. 먼저 로그인을 진행해주세요.' };
            }

            // 2. Go to Booking Page
            console.log(`[NaverBookings] Navigating to ${BOOKING_LIST_URL}...`);
            await page.goto(BOOKING_LIST_URL, { waitUntil: 'networkidle2', timeout: 60000 });

            // 3. Check for Login Redirect
            if (page.url().includes('nid.naver.com')) {
                console.warn("[NaverBookings] Session expired (Redirected to login). URL:", page.url());
                await browser.close();
                return { status: 'expired', message: '네이버 로그인 세션이 만료되었습니다. 다시 로그인해주세요.' };
            }

            // 4. Debug Screenshot & HTML
            try {
                const debugPath = path.join(__dirname, '../public/debug-bookings.png');
                await page.screenshot({ path: debugPath, fullPage: true });
                console.log(`[NaverBookings] Saved debug screenshot to ${debugPath}`);

                // Save HTML for inspection
                const htmlPath = path.join(__dirname, '../public/debug-bookings.html');
                const html = await page.content();
                fs.writeFileSync(htmlPath, html);
                console.log(`[NaverBookings] Saved debug HTML to ${htmlPath}`);

            } catch (e) {
                console.error("Debug export failed:", e);
            }

            // 5. Scrape Data
            // Revised selectors based on actual class names found in debug HTML
            try {
                // Wait for the container
                await page.waitForSelector('[class*="BookingListView__list-contents"]', { timeout: 10000 });
                console.log("[NaverBookings] List container found.");

                // Wait for at least one phone element to ensure data is loaded
                try {
                    await page.waitForSelector('[class*="BookingListView__phone"]', { timeout: 5000 });
                    console.log("[NaverBookings] Data elements appeared.");
                } catch (e) {
                    console.log("[NaverBookings] Data elements not found (Empty list?).");
                }
            } catch (e) {
                console.log("[NaverBookings] List container not found.");
            }

            const bookings = await page.evaluate(() => {
                const results = [];
                const container = document.querySelector('[class*="BookingListView__list-contents"]');
                if (!container) return [];

                // Assuming direct children or div children are rows
                // We'll iterate through all elements that contain a phone number, effectively treating them as rows
                const phoneEls = container.querySelectorAll('[class*="BookingListView__phone"]');
                console.log(`[NaverBookings] Found ${phoneEls.length} items.`);

                phoneEls.forEach(phoneEl => {
                    try {
                        // Traverse up to find the row container (approximate)
                        // The phone element is likely deep inside the row.
                        // We can just query relative to the phone element's common ancestor for this row.
                        // Let's assume 5-6 levels up is enough to cover the row, or find a common wrapper.
                        // Better yet, just find the closest row-like container if possible, but we don't know the class.
                        // Strategy: Use the phoneEl to find the row context.

                        let row = phoneEl.parentElement;
                        // Walk up until we find the container or a likely row wrapper
                        // The 'BookingListView__content' class might be the row
                        while (row && row !== container && !row.className.includes('BookingListView__content') && !row.className.includes('BookingListView__contents-inner')) {
                            row = row.parentElement;
                            if (!row) break;
                        }
                        if (!row || row === container) {
                            // Fallback: just use phoneEl's parent's parent
                            row = phoneEl.parentElement.parentElement.parentElement;
                        }

                        // Now scope selectors to this row
                        const nameEl = row.querySelector('[class*="BookingListView__name-area"]');
                        // Name might be inside name-area
                        const name = nameEl ? nameEl.innerText.split('\n')[0].trim() : 'Unknown';

                        const bookIdEl = row.querySelector('[class*="BookingListView__book-number"]');
                        let bookingId = bookIdEl ? bookIdEl.innerText.trim() : '';

                        // Try to find ID in href if text is messy
                        if (!bookingId || bookingId.length < 5) {
                            const link = row.querySelector('a[href*="/booking/"]');
                            if (link) {
                                const match = link.href.match(/booking\/([0-9]+)/);
                                if (match) bookingId = match[1];
                            }
                        }

                        // Clean ID (remove '변경' or other badges)
                        if (bookingId) {
                            bookingId = bookingId.replace(/[^0-9]/g, '');
                        }

                        if (!bookingId) {
                            bookingId = 'UNKNOWN_' + Math.random().toString(36).substr(2, 5);
                        }

                        const statusEl = row.querySelector('[class*="BookingListView__state"]');
                        const status = statusEl ? statusEl.innerText.trim() : '';

                        const dateEl = row.querySelector('[class*="BookingListView__book-date"], [class*="BookingListView__order-date"]');
                        let dateText = dateEl ? dateEl.innerText.trim() : '';

                        // Normalizing Date: 26. 1. 27.(화) 오후 6:30
                        let date = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
                        let time = '00:00';

                        if (dateText) {
                            // Regex to capture YY, M, D, AM/PM, H, M
                            const match = dateText.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\..*?(오전|오후)\s*(\d{1,2}):(\d{2})/);
                            if (match) {
                                const yy = match[1];
                                const m = match[2].padStart(2, '0');
                                const d = match[3].padStart(2, '0');
                                const ampm = match[4]; // 오전 or 오후
                                let h = parseInt(match[5]);
                                const min = match[6];

                                // Convert YY to YYYY
                                const yyyy = '20' + yy;

                                // Convert to 24h
                                if (ampm === '오후' && h < 12) h += 12;
                                if (ampm === '오전' && h === 12) h = 0;

                                date = `${yyyy}-${m}-${d}`;
                                time = `${h.toString().padStart(2, '0')}:${min}`;
                            } else {
                                // Fallback simple split if regex fails (e.g. no time)
                                const parts = dateText.replace(/[\.\(\)화수목금토일월]/g, '').trim().split(/\s+/);
                                if (parts.length >= 3) {
                                    date = `20${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                                }
                            }
                        }

                        results.push({
                            platform: 'naver',
                            bookingId: bookingId,
                            name: name,
                            phone: phoneEl.innerText.trim(),
                            naverStatus: status,
                            status: '신청',
                            date: date,
                            time: time,
                            raw: row.innerText.replace(/\n/g, ' | ')
                        });
                    } catch (err) {
                        console.error("Row parse error", err);
                    }
                });

                return results;
            });

            await browser.close();
            console.log(`[NaverBookings] Scraped ${bookings.length} bookings.`);

            return { status: 'success', data: bookings };

        } catch (error) {
            console.error("[NaverBookings] Critical error:", error);
            if (browser) await browser.close();
            return { status: 'error', message: error.message };
        }
    }
};

module.exports = NaverBookings;
