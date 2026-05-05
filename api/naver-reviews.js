const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const NaverSession = require('./naver-session');
const { REVIEWS_FILE, DATA_DIR } = require('../utils/fileStore');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const NaverReviews = {
    // 1. Login Function (Delegated to NaverSession)
    login: async () => {
        return await NaverSession.login();
    },

    // 2. Save Session (Delegated to NaverSession)
    saveSession: async () => {
        return await NaverSession.saveSession();
    },

    // 3. Load Session (Delegated to NaverSession)
    loadSession: async (targetPage) => {
        return await NaverSession.loadSession(targetPage);
    },

    // 4. Fetch Reviews
    fetchReviews: async () => {
        console.log("Fetching reviews...");
        let scraperBrowser = null;
        try {
            scraperBrowser = await puppeteer.launch({
                headless: 'new',
                userDataDir: NaverSession.USER_DATA_DIR,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ]
            });
            const scraperPage = await scraperBrowser.newPage();

            await scraperPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Load cookies using shared session
            const loaded = await NaverSession.loadSession(scraperPage);
            if (!loaded) {
                await scraperBrowser.close();
                return { status: 'no_session', message: '로그인 세션 정보(쿠키)가 없습니다. 먼저 로그인을 진행해주세요.' };
            }

            // Go to Reviews Page
            // Note: The exact URL depends on the business ID. 
            await scraperPage.goto('https://new.smartplace.naver.com/bizes/place/3062450/reviews?bookingBusinessId=535748&menu=visitor', { waitUntil: 'networkidle2' });

            // Check if login is required (redirected to login page)
            if (scraperPage.url().includes('nid.naver.com')) {
                console.warn("[NaverReviews] Session expired (Redirected to login). URL:", scraperPage.url());
                await scraperBrowser.close();
                return { status: 'expired', message: '네이버 로그인 세션이 만료되었습니다. 다시 로그인해주세요.' };
            }


            // Scrape reviews logic here
            // This needs to be adjusted based on actual DOM structure
            // Example selector wait
            try {
                // Wait for the container we identified
                await scraperPage.waitForSelector('.Review_columns_list__QiSQh', { timeout: 10000 });
            } catch (e) {
                console.log("Review list selector not found, might be empty or different structure.");
            }

            // Extract data
            const reviews = await scraperPage.evaluate(() => {
                const results = [];
                // Target the specific list items
                const items = document.querySelectorAll('li.Review_pui_review__6lInP');

                items.forEach(item => {
                    let id = '';

                    // Attempt to find Real ID from list item attributes
                    // Naver often puts the review ID in the dataset or as part of a child element's ID
                    // Example strategy: look for report button or similar interactive elements that carry the ID
                    // Strategy 1: Check 'data-id' on the li itself (if available)
                    if (item.dataset.id) id = item.dataset.id;

                    // Strategy 2: If not, try to find it in the content 'more' button or report button
                    if (!id) {
                        const reportBtn = item.querySelector('button[data-pui-click-code="report"]');
                        if (reportBtn) {
                            // Sometimes parsing attributes helps, but often it's hidden. 
                            // If we can't find a real ID, we might need to rely on a stable hash of the author + date + content
                            // For now, let's look for a unique identifier in the DOM
                        }
                    }

                    // Fallback to stable hash if Real ID is elusive in this context
                    // (Naver Place HTML is tough). 
                    // Let's create a pseudo-ID based on author + date + first 10 chars of content

                    // 1. Author
                    const author = item.querySelector('.pui__NMi-Dp')?.innerText?.trim() || 'Unknown';

                    // 2. Content
                    let content = '';
                    const contentLink = item.querySelector('a[data-pui-click-code="text"]');
                    if (contentLink) {
                        content = contentLink.innerText;
                    } else {
                        const contentDiv = item.querySelector('.pui__vn15t2');
                        if (contentDiv) content = contentDiv.innerText;
                    }
                    content = content.replace(/더보기$/, '').trim();

                    // 3. Date
                    const dates = item.querySelectorAll('.pui__4rEbt5 time');
                    const date = dates.length > 0 ? dates[0].innerText.trim() : '';

                    // Generate Stable ID if real ID not found
                    if (!id) {
                        // Simple hash
                        const key = author + date + content.substring(0, 15);
                        let hash = 0;
                        for (let i = 0; i < key.length; i++) {
                            const char = key.charCodeAt(i);
                            hash = ((hash << 5) - hash) + char;
                            hash = hash & hash; // Convert to 32bit integer
                        }
                        id = 'review_' + Math.abs(hash);
                    }

                    // 4. Rating
                    const rating = '5';

                    // 5. Reply
                    let reply = item.querySelector('.pui__J0tczd')?.innerText || null;
                    if (reply) {
                        reply = reply.replace(/더보기$/, '').trim();
                    }

                    // 6. Reply Button Availability (Check if we can reply)
                    // The reply button usually has text "답글달기"
                    const canReply = !!item.querySelector('.Review_pui_button__S2P40');

                    results.push({ id, author, content, date, rating, reply, canReply });
                });
                return results;
            });

            // Save to file
            fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));

            await scraperBrowser.close();
            return { status: 'success', data: reviews, count: reviews.length };

        } catch (error) {
            console.error("Fetch reviews error:", error);
            if (scraperBrowser) await scraperBrowser.close();
            return { status: 'error', message: error.message };
        }
    },

    // 5. Reply to Review (with Queue)
    replyToReview: async (reviewId, content) => {
        console.log(`Queueing reply for ${reviewId}...`);

        // Add to Queue
        NaverReviews.queue.push({ reviewId, content });

        // Trigger Processor (if not running)
        if (!NaverReviews.isProcessing) {
            NaverReviews.processQueue();
        }

        return { status: 'success', message: '답글 전송 대기열에 등록되었습니다. (백그라운드 처리)' };
    },

    // Queue Helpers
    queue: [],
    isProcessing: false,

    processQueue: async () => {
        if (NaverReviews.queue.length === 0) {
            NaverReviews.isProcessing = false;
            console.log('✅ All replies processed.');
            return;
        }

        NaverReviews.isProcessing = true;
        const task = NaverReviews.queue.shift(); // Get first task
        console.log(`[Queue] Processing reply for reviewID: ${task.reviewId} (${NaverReviews.queue.length} left)`);

        let browser = null;
        try {
            // [FIX] 1. Load target review details first
            const allReviews = NaverReviews.getReviews();
            const targetReview = allReviews.find(r => r.id === task.reviewId);

            if (!targetReview) {
                console.error(`[Queue] Error: Review ${task.reviewId} not found locally.`);
                // Skip this task
                setTimeout(() => NaverReviews.processQueue(), 1000);
                return;
            }

            browser = await puppeteer.launch({
                headless: 'new',
                userDataDir: NaverSession.USER_DATA_DIR,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            // Load session
            const loaded = await NaverSession.loadSession(page);
            if (!loaded) throw new Error('No session');

            // Go to Reviews Page
            await page.goto('https://new.smartplace.naver.com/bizes/place/3062450/reviews?bookingBusinessId=535748&menu=visitor', { waitUntil: 'networkidle2' });
            await page.waitForSelector('.Review_columns_list__QiSQh', { timeout: 15000 }); // Increased timeout

            // Match Element
            const reviewHandle = await page.evaluateHandle(({ author, contentSnippet }) => {
                const items = document.querySelectorAll('li.Review_pui_review__6lInP');
                for (let item of items) {
                    const itemAuthor = item.querySelector('.pui__NMi-Dp')?.innerText?.trim() || 'Unknown';
                    let itemContent = '';
                    const contentLink = item.querySelector('a[data-pui-click-code="text"]');
                    if (contentLink) itemContent = contentLink.innerText;
                    else {
                        const contentDiv = item.querySelector('.pui__vn15t2');
                        if (contentDiv) itemContent = contentDiv.innerText;
                    }
                    itemContent = itemContent.replace(/더보기$/, '').trim();

                    if (itemAuthor === author && itemContent.includes(contentSnippet)) return item;
                }
                return null;
            }, {
                author: targetReview.author,
                contentSnippet: targetReview.content.substring(0, 15)
            });

            if (!reviewHandle.asElement()) throw new Error(`Review element not found (Author: ${targetReview.author})`);

            // Click Reply
            const replyBtnClicked = await page.evaluate((item) => {
                const buttons = item.querySelectorAll('button');
                for (let btn of buttons) {
                    if (btn.innerText.includes('답글달기')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }, reviewHandle);

            if (!replyBtnClicked) throw new Error('Reply button not found (Already replied?)');

            await page.waitForTimeout(1000);

            // Type content
            await page.evaluate((item, text) => {
                const textarea = item.querySelector('textarea');
                if (textarea) {
                    textarea.value = text;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, reviewHandle, task.content);

            // Click Submit
            const submitClicked = await page.evaluate((item) => {
                const buttons = item.querySelectorAll('button');
                for (let btn of buttons) {
                    if (btn.innerText.includes('등록')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }, reviewHandle);

            if (!submitClicked) throw new Error('Submit button click failed');

            await page.waitForTimeout(3000); // Wait 3s for submission completion

            // [Verify] Check if our reply text actually appeared in the DOM
            // The reply usually appears in a div with class 'pui__vn15t2' or inside the item
            const replyVerified = await page.evaluate((item, replyText) => {
                // Find all text content in the item to see if our reply exists
                // Note: The reply might be in a '사장님 답글' section
                return item.innerText.includes(replyText) || document.body.innerText.includes(replyText);
            }, reviewHandle, task.content);

            if (!replyVerified) {
                // Try one more time with a slightly longer wait and broader check
                await new Promise(r => setTimeout(r, 2000));
                const retryVerify = await page.evaluate((replyText) => document.body.innerText.includes(replyText), task.content);

                if (!retryVerify) {
                    throw new Error('Reply submission failed (Text NOT found in DOM after submit).');
                }
            }

            await browser.close();
            browser = null;

            // Update Local Data
            const currentReviews = NaverReviews.getReviews();
            const targetIndex = currentReviews.findIndex(r => r.id === task.reviewId);
            if (targetIndex !== -1) {
                currentReviews[targetIndex].reply = task.content;
                fs.writeFileSync(REVIEWS_FILE, JSON.stringify(currentReviews, null, 2));
            }
            console.log(`[Queue] Successfully replied to review ${task.reviewId}`);

        } catch (error) {
            console.error(`[Queue] Failed to process review ${task.reviewId}:`, error.message);
            if (browser) {
                try { await browser.close(); } catch (e) { }
            }
        }

        // Process next item
        setTimeout(() => NaverReviews.processQueue(), 2000);
    },

    // 6. Get Cached Reviews
    getReviews: () => {
        if (fs.existsSync(REVIEWS_FILE)) {
            return JSON.parse(fs.readFileSync(REVIEWS_FILE));
        }
        return [];
    }
};

module.exports = NaverReviews;
