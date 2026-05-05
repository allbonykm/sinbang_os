const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SESSION_FILE_PATH = path.join(__dirname, '../data/naver-session.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'));
}

let browser = null;
let page = null;

const NaverSession = {
    // 1. Login Function (Manual Intervention)
    login: async () => {
        try {
            console.log("[NaverSession] Login requested. initializing...");

            // Force close existing browser if any
            if (browser) {
                try {
                    console.log("[NaverSession] Closing existing browser...");
                    await browser.close();
                } catch (e) {
                    console.error("[NaverSession] Error closing existing browser:", e);
                }
                browser = null;
                page = null;
            }

            console.log("[NaverSession] Launching new browser instance...");
            browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--window-size=1280,1024',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ]
            });

            browser.on('disconnected', () => {
                console.log("[NaverSession] Browser disconnected.");
                browser = null;
                page = null;
            });

            const pages = await browser.pages();
            page = pages.length > 0 ? pages[0] : await browser.newPage();

            // Set User-Agent for this page as well
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            console.log("[NaverSession] Navigating to Naver login...");
            // Increased timeout for slow loading
            await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 60000 });

            console.log("[NaverSession] Please log in manually in the browser window.");

            // Background Polling for Login Success
            const checkLoginInterval = setInterval(async () => {
                if (!page || !browser) {
                    clearInterval(checkLoginInterval);
                    return;
                }
                try {
                    const url = page.url();
                    // If user navigated away from login page (nid.naver.com) and is on a naver domain, assume login success
                    // Also check for common landing pages after login
                    if (!url.includes('nid.naver.com') && (url.includes('naver.com') || url.includes('smartplace.naver.com'))) {
                        console.log("[NaverSession] Login detected (URL changed to: " + url + "). Saving session...");
                        clearInterval(checkLoginInterval);

                        // Wait a moment for cookies to set completely
                        await new Promise(r => setTimeout(r, 3000));

                        await NaverSession.saveSession();

                        console.log("[NaverSession] Closing browser...");
                        await browser.close();
                        browser = null;
                        page = null;
                    }
                } catch (e) {
                    console.error("[NaverSession] Login check error:", e.message);
                    clearInterval(checkLoginInterval);
                }
            }, 2000);

            return {
                success: true,
                status: 'waiting_for_login',
                message: '브라우저가 서버 PC에서 열렸습니다. 로그인을 완료하면 자동으로 창이 닫힙니다.'
            };

        } catch (error) {
            console.error("[NaverSession] Login critical error:", error);
            if (browser) {
                try { await browser.close(); } catch (e) { }
                browser = null;
            }
            return { status: 'error', message: '브라우저 실행 실패: ' + error.message };
        }
    },

    // 2. Save Session (Cookies)
    saveSession: async () => {
        if (!page) {
            return { status: 'error', message: '진행 중인 브라우저 페이지가 없습니다.' };
        }
        try {
            const cookies = await page.cookies();
            // Basic validation: must have NID_SES or NID_AUT for Naver
            const hasAuthCookies = cookies.some(c => c.name === 'NID_SES' || c.name === 'NID_AUT');

            if (!hasAuthCookies) {
                console.warn("[NaverSession] Authentication cookies not found. User might not have finished login.");
                // We still save it, but maybe log a warning
            }

            fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(cookies, null, 2));
            console.log("[NaverSession] Session saved to", SESSION_FILE_PATH);

            return { status: 'success', message: '세션(쿠키)이 저장되었습니다.' };
        } catch (error) {
            console.error("[NaverSession] Save session error:", error);
            return { status: 'error', message: error.message };
        }
    },

    // 3. Load Session
    loadSession: async (targetPage) => {
        if (fs.existsSync(SESSION_FILE_PATH)) {
            try {
                const cookiesString = fs.readFileSync(SESSION_FILE_PATH);
                const cookies = JSON.parse(cookiesString);
                await targetPage.setCookie(...cookies);
                console.log("[NaverSession] Session loaded successfully.");
                return true;
            } catch (error) {
                console.error("[NaverSession] Failed to load session:", error);
                return false;
            }
        }
        console.log("[NaverSession] No session file found.");
        return false;
    },

    // 4. Get Browser Instance (Optional helper)
    getBrowser: () => browser,
    getPage: () => page,

    // 5. Cleanup
    close: async () => {
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
        }
    }
};

module.exports = NaverSession;
