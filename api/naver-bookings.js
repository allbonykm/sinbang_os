const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const NaverSession = require('./naver-session');

// This business ID is derived from the review URL seen in api/naver-reviews.js
// bookingBusinessId=535748
const BUSINESS_ID = '337551';
const BOOKING_LIST_URL = `https://partner.booking.naver.com/bizes/${BUSINESS_ID}/booking-list-view`;
const SELECTORS_FILE = path.join(__dirname, '../data/scraper-selectors.json');

// 외부 설정 파일에서 CSS 셀렉터 로드 (네이버 UI 변경 시 JSON만 수정)
function loadSelectors() {
    const defaults = {
        container: '[class*="BookingListView__list-contents"]',
        phone: '[class*="BookingListView__phone"]',
        nameArea: '[class*="BookingListView__name-area"]',
        bookNumber: '[class*="BookingListView__book-number"]',
        state: '[class*="BookingListView__state"]',
        bookDate: '[class*="BookingListView__book-date"], [class*="BookingListView__order-date"]',
        rowContentClass: 'BookingListView__content',
        rowInnerClass: 'BookingListView__contents-inner'
    };
    try {
        if (fs.existsSync(SELECTORS_FILE)) {
            return { ...defaults, ...JSON.parse(fs.readFileSync(SELECTORS_FILE, 'utf8')) };
        }
    } catch (e) {
        console.error('[NaverBookings] 셀렉터 설정 로드 실패, 기본값 사용:', e.message);
    }
    return defaults;
}

const NaverBookings = {
    fetchBookings: async () => {
        console.log("[NaverBookings] Fetching bookings...");
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: 'new', // Use new headless mode
                userDataDir: NaverSession.USER_DATA_DIR,
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


            // 5. Scrape Data (외부 설정 파일 기반 셀렉터)
            const SEL = loadSelectors();
            try {
                // 컨테이너 대기
                await page.waitForSelector(SEL.container, { timeout: 10000 });
                console.log("[NaverBookings] List container found.");

                // 전화번호 요소 대기 (데이터 로드 확인)
                try {
                    await page.waitForSelector(SEL.phone, { timeout: 5000 });
                    console.log("[NaverBookings] Data elements appeared.");
                } catch (e) {
                    console.log("[NaverBookings] Data elements not found (Empty list?).");
                }
            } catch (e) {
                // 셀렉터 매칭 실패 시 HTML 스냅샷 저장 (디버깅용)
                console.error("[NaverBookings] List container not found. HTML 스냅샷을 저장합니다.");
                try {
                    const html = await page.content();
                    const snapshotPath = path.join(__dirname, '../data/scraper-debug.html');
                    fs.writeFileSync(snapshotPath, html, 'utf8');
                    console.log(`[NaverBookings] 디버그 HTML 저장 완료: ${snapshotPath}`);
                } catch (snapErr) {
                    console.error('[NaverBookings] HTML 스냅샷 저장 실패:', snapErr.message);
                }
            }

            const bookings = await page.evaluate((selectors) => {
                const results = [];
                const container = document.querySelector(selectors.container);
                if (!container) return [];

                const phoneEls = container.querySelectorAll(selectors.phone);
                console.log(`[NaverBookings] Found ${phoneEls.length} items.`);

                phoneEls.forEach(phoneEl => {
                    try {
                        // 행(Row) 탐색: 전화번호 요소에서 부모를 올라가며 행 컨테이너 찾기
                        let row = phoneEl.parentElement;
                        while (row && row !== container && !row.className.includes(selectors.rowContentClass) && !row.className.includes(selectors.rowInnerClass)) {
                            row = row.parentElement;
                            if (!row) break;
                        }
                        if (!row || row === container) {
                            row = phoneEl.parentElement.parentElement.parentElement;
                        }

                        // 셀렉터 기반 데이터 추출
                        const nameEl = row.querySelector(selectors.nameArea);
                        const name = nameEl ? nameEl.innerText.split('\n')[0].trim() : 'Unknown';

                        const bookIdEl = row.querySelector(selectors.bookNumber);
                        let bookingId = bookIdEl ? bookIdEl.innerText.trim() : '';

                        // href에서 ID 추출 시도
                        if (!bookingId || bookingId.length < 5) {
                            const link = row.querySelector('a[href*="/booking/"]');
                            if (link) {
                                const match = link.href.match(/booking\/([0-9]+)/);
                                if (match) bookingId = match[1];
                            }
                        }

                        // ID 정리 (숫자만)
                        if (bookingId) {
                            bookingId = bookingId.replace(/[^0-9]/g, '');
                        }

                        if (!bookingId) {
                            // 결정적 ID 생성: 동일 예약은 항상 동일 ID → 중복 INSERT 방지
                            const phoneLast4 = (phoneEl.innerText || '').replace(/[^0-9]/g, '').slice(-4);
                            bookingId = `NAVER_${name}_${date}_${phoneLast4}`;
                        }

                        const statusEl = row.querySelector(selectors.state);
                        const status = statusEl ? statusEl.innerText.trim() : '';

                        const dateEl = row.querySelector(selectors.bookDate);
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
            }, SEL);

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
