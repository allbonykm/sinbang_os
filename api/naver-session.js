const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SESSION_FILE_PATH = path.join(__dirname, '../data/naver-session.json');
const USER_DATA_DIR = path.join(__dirname, '../data/naver-user-data');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'));
}

let browser = null;
let page = null;
let isLaunching = false;

const NaverSession = {
    // 1. Login Function (Manual Intervention)
    login: async () => {
        if (isLaunching) {
            return { success: false, message: '이미 로그인이 진행 중입니다. 잠시만 기다려주세요.' };
        }
        
        try {
            isLaunching = true;
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

            // 이전 세션 탭 복원 방지: 세션 파일 삭제
            const sessionFiles = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
            const defaultProfileDir = path.join(USER_DATA_DIR, 'Default');
            for (const f of sessionFiles) {
                try { fs.unlinkSync(path.join(defaultProfileDir, f)); } catch (e) { /* 없으면 무시 */ }
            }

            console.log("[NaverSession] Launching new browser instance...");
            browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                userDataDir: USER_DATA_DIR,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--window-size=1280,1024',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--disable-session-crashed-bubble',
                    '--disable-infobars',
                    '--no-first-run',
                    '--no-default-browser-check'
                ]
            });

            browser.on('disconnected', () => {
                console.log("[NaverSession] Browser disconnected.");
                browser = null;
                page = null;
                isLaunching = false;
            });

            // 기본 탭을 사용하여 로그인 페이지로 바로 이동
            await new Promise(r => setTimeout(r, 1500));
            const pages = await browser.pages();
            page = pages[0] || await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            console.log("[NaverSession] Navigating to Naver login...");
            await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Attempt to check "Keep me logged in" (로그인 상태 유지) automatically
            try {
                await page.waitForSelector('#keep', { timeout: 5000 });
                const isChecked = await page.evaluate(() => {
                    const cb = document.querySelector('#keep');
                    if (cb && !cb.checked) {
                        cb.click();
                        return true;
                    }
                    return false;
                });
                if (isChecked) console.log("[NaverSession] 'Keep me logged in' automatically checked.");
            } catch (e) {
                console.log("[NaverSession] Could not find 'Keep me logged in' checkbox (might be already on a different page).");
            }

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
                        isLaunching = false;
                    }
                } catch (e) {
                    console.error("[NaverSession] Login check error:", e.message);
                    clearInterval(checkLoginInterval);
                    isLaunching = false;
                }
            }, 2000);

            return {
                success: true,
                status: 'waiting_for_login',
                message: '브라우저가 서버 PC에서 열렸습니다. 로그인을 완료하면 자동으로 창이 닫힙니다.'
            };

        } catch (error) {
            console.error("[NaverSession] Login critical error:", error);
            isLaunching = false;
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
    },

    // 6. Check Session Existence
    hasCookies: () => {
        return fs.existsSync(SESSION_FILE_PATH);
    },

    USER_DATA_DIR: USER_DATA_DIR
};

module.exports = NaverSession;
