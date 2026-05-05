/**
 * Smart Booking Agent (Cron Scheduler) - Dynamic Version
 * Handles D-1 and D-Day automated booking notifications based on user settings.
 */

const cron = require('node-cron');
const pool = require('../config/db');
const sens = require('./naver-sens');
const fs = require('fs');
const path = require('path');
const { BOOKING_CONFIG_FILE, ALLTALK_TEMPLATES_FILE } = require('./fileStore');
const { ALIMTALK_EVENTS } = require('./alimtalk-manager');

// 알림 설정 로드
const getBookingConfig = () => {
    try {
        if (fs.existsSync(BOOKING_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(BOOKING_CONFIG_FILE, 'utf8'));
            return {
                dDayTime: data.dDayTime || "08:30"
            };
        }
    } catch (e) {
        console.error('[Smart Booking Agent] Error reading booking-config.json', e);
    }
    return { dDayTime: "08:30" };
};

// 에이전트 활성화 여부
const config = {
    smartBookingAgentEnabled: true
};




const getTodayDateString = () => {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
};

// ==========================================
// 통합 예약 알림 스케줄러: 30분마다 실행 (08:30 등 대응)
// ==========================================
cron.schedule('0,30 * * * *', async () => {
    if (!config.smartBookingAgentEnabled) return;

    const now = new Date();
    const currentHour = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // 알림 설정 로드
    const settings = getBookingConfig();
    const dDayTime = settings.dDayTime;

    console.log(`[Smart Booking Agent] Checking time: ${currentHour} (Target: ${dDayTime})`);

    // 2차 발송 (D-Day) 체크
    if (currentHour === dDayTime) {
        await runDDayAgent();
    }
});


/**
 * 2차 발송 (D-Day) 로직
 */
async function runDDayAgent() {
    console.log('[Smart Booking Agent] Starting D-Day notifications...');
    try {
        const todayStr = getTodayDateString();
        const [bookings] = await pool.query(
            "SELECT * FROM bookings WHERE date = ? AND status NOT IN ('노쇼', '취소', '내원완료')",
            [todayStr]
        );

        if (bookings.length === 0) return;

        let sentCount = 0;
        let failCount = 0;

        for (const b of bookings) {
            if (!b.phone || b.phone.length < 10) continue;

            // 당일 발송 중복 방지 (이미 [당일] 표시가 있는 경우만 스킵)

            if (b.notes && b.notes.includes('[당일]')) continue;

            const [pRows] = await pool.query('SELECT hasKakao, rejectSms FROM patients WHERE chartNo = ?', [b.chartNo]);
            if (pRows.length > 0 && (pRows[0].hasKakao === 0 || pRows[0].rejectSms === 1)) continue;

            try {
                const { formatKoreanDate, formatKoreanTime } = require('./dateUtils');
                const resDate = formatKoreanDate(b.date);
                const resTime = formatKoreanTime(b.time);

                // 알림톡 발송 (D0Booking)
                const result = await sens.sendAlimTalk(
                    b.name,
                    b.chartNo,
                    b.phone,
                    null,
                    ALIMTALK_EVENTS.D0_BOOKING,
                    null,
                    null,
                    {
                        "이름": b.name,
                        "예약날짜": resDate,
                        "예약시간": resTime
                    }
                );

                if (result.success) {
                    const newNotes = `[당일] 예약안내 알림톡 발송완료 (${resTime}). ${b.notes || ''}`;
                    await pool.query('UPDATE bookings SET notes = ? WHERE id = ?', [newNotes, b.id]);
                    sentCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
                console.error(`[D-Day] Error for ${b.name}:`, err.message);
            }
        }
        console.log(`[D-Day] Completed. Sent: ${sentCount}, Failed: ${failCount}`);
    } catch (e) {
        console.error('[D-Day] Agent Error:', e);
    }
}

// 템플릿 동기화 에이전트: 매 시간 30분에 실행 (자동 동기화)
const ALLTALK_FILE = ALLTALK_TEMPLATES_FILE;

cron.schedule('30 * * * *', async () => {
    if (!config.smartBookingAgentEnabled) return;
    console.log('[Template Sync Agent] Triggered automatic template synchronization.');

    try {
        const channelId = process.env.ALIMTALK_PLUS_ID || '@올보니';
        if (typeof sens.getAlimtalkTemplates !== 'function') {
            console.log('[Template Sync Agent] Skipping: util not found.');
            return;
        }

        const result = await sens.getAlimtalkTemplates(channelId);
        if (!result.success || !result.templates) return;

        let local = [];
        try {
            if (fs.existsSync(ALLTALK_FILE)) local = JSON.parse(fs.readFileSync(ALLTALK_FILE, 'utf8'));
        } catch (e) { }

        let updated = 0, added = 0;
        for (const stShort of result.templates) {
            try {
                const detail = await sens.getAlimtalkTemplates(channelId, stShort.templateCode);
                if (!detail.success || !detail.templates || detail.templates.length === 0) continue;

                const st = detail.templates[0];
                const index = local.findIndex(t => t.sensTemplateCode === st.templateCode);

                const newEntry = {
                    id: `sens_${st.templateCode}`,
                    title: st.templateName,
                    category: st.categoryCode || 'general',
                    status: 'approved',
                    createdAt: st.createTime ? st.createTime.split('T')[0] : new Date().toISOString().split('T')[0],
                    sensTemplateCode: st.templateCode,
                    sensContent: st.content,
                    sensStatus: st.templateInspectionStatus,
                    sensTemplateStatus: st.templateStatus,
                    sensTemplateName: st.templateName,
                    steps: [{
                        id: `step_${st.templateCode}`,
                        timing: '즉시',
                        content: st.content,
                        buttons: (st.buttons || []).map(b => ({
                            name: b.name,
                            type: b.type === 'WL' ? 'url' : (b.type === 'AL' ? 'app' : 'text'),
                            linkMobile: b.linkMobile,
                            linkPc: b.linkPc
                        }))
                    }],
                    lastSyncedAt: new Date().toISOString()
                };

                if (index >= 0) {
                    local[index] = { ...local[index], ...newEntry };
                    updated++;
                } else {
                    local.push(newEntry);
                    added++;
                }
            } catch (inner) { }
        }
        fs.writeFileSync(ALLTALK_FILE, JSON.stringify(local, null, 2), 'utf8');
        console.log(`[Template Sync Agent] Completed. Added: ${added}, Updated: ${updated}`);
    } catch (e) {
        console.error('[Template Sync Agent] Sync Error:', e.message);
    }
});

// ==========================================
// 내원 기록 자동 이관 에이전트: 매일 00:05 실행
// today_visits -> treatment_history (치료실 보드 안 거친 경우)
// ==========================================
cron.schedule('5 0 * * *', async () => {
    console.log('[Visit Migration Agent] Starting daily migration...');
    try {
        // 1. 히스토리에 없는 과거 내원 기록 이관
        const [migrated] = await pool.query(`
            INSERT INTO treatment_history (patientId, patientName, chartNo, date, entryTime, exitTime, status, note)
            SELECT 
                tv.patientId, 
                tv.patientName, 
                tv.chartNo, 
                tv.date, 
                tv.visitedAt, 
                tv.visitedAt, 
                CONCAT('{"status":"', tv.status, '", "autoMigrated": true}'), 
                '자동 이관 (내원 목록)'
            FROM today_visits tv
            WHERE tv.date < CURDATE()
              AND NOT EXISTS (
                SELECT 1 FROM treatment_history th 
                WHERE th.patientId = tv.patientId 
                  AND (th.date = tv.date OR DATE(th.entryTime) = tv.date)
              )
        `);

        console.log(`[Visit Migration Agent] Migrated ${migrated.affectedRows} records to treatment_history.`);

        // 2. 과거 내원 기록 삭제
        const [deleted] = await pool.query('DELETE FROM today_visits WHERE date < CURDATE()');
        console.log(`[Visit Migration Agent] Cleaned up ${deleted.affectedRows} old records from today_visits.`);

    } catch (e) {
        console.error('[Visit Migration Agent] Error:', e.message);
    }
});

module.exports = { enabled: config.smartBookingAgentEnabled };
