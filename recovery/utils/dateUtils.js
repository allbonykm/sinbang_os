/**
 * Utility functions for consistent Korea Standard Time (KST) date formatting.
 * This ensures that "today" is correctly identified even if the server system time is UTC.
 */

/**
 * Returns the current date in KST as a YYYY-MM-DD string.
 * @returns {string} e.g., "2026-02-11"
 */
function getKSTDate() {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

/**
 * Returns the current month in KST as a YYYY-MM string.
 * @returns {string} e.g., "2026-02"
 */
function getKSTMonth() {
    return getKSTDate().slice(0, 7);
}

/**
 * Returns the current time in KST as an ISO string (equivalent to new Date().toISOString() but for KST).
 * Note: ISO strings are technically UTC, so this returns a Date object shifted to KST.
 * @returns {Date}
 */
function getKSTNow() {
    const now = new Date();
    // Shift the date by 9 hours for KST
    return new Date(now.getTime() + (9 * 60 * 60 * 1000));
}

/**
 * 예약날짜 포맷팅: "4월 23일(목)"
 */
function formatKoreanDate(dateStr) {
    if (!dateStr) return '';
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const d = new Date(dateStr);
    const m = d.getMonth() + 1;
    const date = d.getDate();
    const day = days[d.getDay()];
    return `${m}월 ${date}일(${day})`;
}

/**
 * 예약시간 포맷팅: "오후 2시" 또는 "오후 2시 30분"
 */
function formatKoreanTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? '오후' : '오전';
    const hour = h % 12 || 12;
    return m === 0 ? `${ampm} ${hour}시` : `${ampm} ${hour}시 ${m}분`;
}

module.exports = {
    getKSTDate,
    getKSTMonth,
    getKSTNow,
    formatKoreanDate,
    formatKoreanTime
};
