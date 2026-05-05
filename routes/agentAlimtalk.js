/**
 * Agent AlimTalk Router
 * Handles specifically Template Sync and Post-Treatment Dispatch Agents based on SDD specs.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const pool = require('../config/db');
const sens = require('../utils/naver-sens');
const { ALLTALK_TEMPLATES_FILE } = require('../utils/fileStore');
const { sanitizeChartNo } = require('../utils/patientUtils');

// Save templates to file
const saveTemplates = (data) => {
    fs.writeFileSync(ALLTALK_TEMPLATES_FILE, JSON.stringify(data, null, 2), 'utf8');
};

// ==========================================
// 2-1. 템플릿 동기화 에이전트 (Template Sync Agent)
// ==========================================
router.post('/sync-templates', async (req, res) => {
    try {
        const channelId = process.env.ALIMTALK_PLUS_ID || '@신방한의원';
        const result = await sens.getAlimtalkTemplates(channelId);

        if (!result.success) {
            console.error('[Template Sync Agent] SENS API Fetch Failed:', result.error);
            return res.status(500).json({ success: false, message: 'Naver SENS API Error: ' + result.error });
        }

        const sensTemplates = result.templates || [];
        if (sensTemplates.length === 0) {
            return res.json({ success: true, message: 'No templates found in SENS.', data: [] });
        }

        let localTemplates = [];
        if (fs.existsSync(ALLTALK_TEMPLATES_FILE)) {
            localTemplates = JSON.parse(fs.readFileSync(ALLTALK_TEMPLATES_FILE, 'utf8'));
        }

        let updatedCount = 0;
        let newCount = 0;

        for (const stShort of sensTemplates) {
            try {
                const detailResult = await sens.getAlimtalkTemplates(channelId, stShort.templateCode);
                if (!detailResult.success || !detailResult.templates || detailResult.templates.length === 0) {
                    continue;
                }

                const st = detailResult.templates[0];
                const existingIndex = localTemplates.findIndex(lt => lt.sensTemplateCode === st.templateCode);
                const buttons = st.buttons || [];

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
                    sensTitle: st.title || null,
                    sensHeaderContent: st.additionalTitle || st.headerContent || st.header || null,
                    steps: [{
                        id: `step_${st.templateCode}`,
                        timing: '즉시',
                        content: st.content,
                        buttons: buttons.map(b => ({
                            name: b.name,
                            type: b.type === 'WL' ? 'url' : (b.type === 'AL' ? 'app' : 'text'),
                            linkMobile: b.linkMobile,
                            linkPc: b.linkPc
                        }))
                    }],
                    lastSyncedAt: new Date().toISOString()
                };

                if (existingIndex >= 0) {
                    localTemplates[existingIndex] = { ...localTemplates[existingIndex], ...newEntry };
                    updatedCount++;
                } else {
                    localTemplates.push(newEntry);
                    newCount++;
                }
            } catch (innerError) {
                console.error(`[Template Sync Agent] Failed to process template ${stShort.templateCode}:`, innerError.message);
            }
        }

        saveTemplates(localTemplates);

        res.json({
            success: true,
            message: `Template Sync Complete: ${newCount} new, ${updatedCount} updated.`,
            stats: { newCount, updatedCount }
        });

    } catch (error) {
        console.error('[Template Sync Agent] Sync Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 2-3. 진료 후 사후관리 에이전트 (Post-Treatment Agent)
// ==========================================
router.post('/dispatch', async (req, res) => {
    try {
        const { chartNo: rawChartNo, patientName, phone, visitId, eventType, variables } = req.body;
        const chartNo = sanitizeChartNo(rawChartNo);

        if (eventType === 'OnlyDelivery') {
            const { name, product, url } = variables;

            // 전화번호 정제 (숫자만 남기기)
            const cleanPhone = phone.replace(/[^0-9]/g, '');

            const templateCode = 'OnlyDelivery'; // 알림톡 템플릿 코드 (사전 등록된 것)
            
            // 템플릿 내용 치환 (예: [신방한의원] #{name}님, 주문하신 #{product}의 배송이 시작되었습니다...)
            // 센스 API 연동 시 실제 매핑 로직은 sens.sendAlimTalk 내부에서 처리할 수 있도록 전달
            // 여기서는 템플릿 정보를 불러와서 내용 치환 후 발송
            const [localTemplates] = fs.existsSync(ALLTALK_TEMPLATES_FILE) ? [JSON.parse(fs.readFileSync(ALLTALK_TEMPLATES_FILE, 'utf8'))] : [[]];
            let template = localTemplates.find(t => t.sensTemplateCode === templateCode);

            if (!template) {
                console.error(`[Post-Treatment Agent] Template ${templateCode} not found in synced templates.`);
                return res.status(404).json({ 
                    success: false, 
                    message: `템플릿 '${templateCode}'를 찾을 수 없습니다. 대시보드 설정에서 [SENS 동기화]를 먼저 진행해 주세요.` 
                });
            }

            let content = template.sensContent
                .replace(/#\{name\}/g, name)
                .replace(/#\{product\}/g, product)
                .replace(/#\{url\}/g, url);

            // 템플릿의 #{key}, #{code}, #{invoice} 변수 대응을 위해 개별 변수 추가 (URL에서 파싱)
            const { t_key, t_code, t_invoice } = (function() {
                try {
                    const u = new URL(url);
                    return { 
                        t_key: u.searchParams.get('t_key'), 
                        t_code: u.searchParams.get('t_code'), 
                        t_invoice: u.searchParams.get('t_invoice') 
                    };
                } catch(e) { return { t_key: '', t_code: '', t_invoice: '' }; }
            })();

            const deliveryVariables = {
                ...variables,
                key: t_key,
                code: t_code,
                invoice: t_invoice
            };

            const sentResult = await sens.sendAlimTalk(name, chartNo, cleanPhone, null, templateCode, content, null, deliveryVariables);

            if (sentResult.success) {
                // 발송 내역(message_history)에 기록
                const newId = Date.now();
                await pool.query(
                    `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message)
                    VALUES (?, ?, ?, ?, NOW(), '알림톡', 'success', ?, ?)`,
                    [newId, name, chartNo, cleanPhone, templateCode, content]
                );
                return res.json({ success: true, message: '배송 알림톡이 발송되었습니다.' });
            } else {
                return res.json({ success: false, message: '발송 실패: ' + sentResult.error });
            }
        }

        if (!chartNo || !patientName || !phone) {
            return res.status(400).json({ success: false, message: 'Invalid patient data for dispatch.' });
        }

        // 전화번호 정제 (숫자만 남기기 - SENS API 필수 조건)
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        // 1. Validation (hasKakao check via DB)
        const [patients] = await pool.query('SELECT id, COALESCE(hasKakao, 1) as hasKakao FROM patients WHERE chartNo = ?', [chartNo]);
        if (patients.length === 0) {
            return res.status(404).json({ success: false, message: 'Patient not found in DB.' });
        }

        const patient = patients[0];
        if (!patient.hasKakao) {
            return res.json({ success: false, message: '카카오톡 수신 거부 환자입니다.' });
        }

        // 2. Check future bookings to determine logic branch
        const now = new Date();
        const [bookings] = await pool.query("SELECT * FROM bookings WHERE chartNo = ? AND status NOT IN ('노쇼', '취소', '내원완료', '완료')", [chartNo]);

        let nextBooking = null;
        for (const b of bookings) {
            // Fix: Safe extraction for both String and Date formats
            const extractDateStr = (dObj) => typeof dObj === 'string' ? dObj.substring(0, 10) : dObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

            const dateStr = extractDateStr(b.date);
            const bDate = new Date(`${dateStr}T${b.time}`);
            if (bDate > now) {
                let isNext = true;
                if (nextBooking) {
                    const nextDateStr = extractDateStr(nextBooking.date);
                    if (bDate >= new Date(`${nextDateStr}T${nextBooking.time}`)) {
                        isNext = false;
                    }
                }
                if (isNext) nextBooking = b;
            }
        }

        // 3. Fetch Templates
        let localTemplates = [];
        if (fs.existsSync(ALLTALK_TEMPLATES_FILE)) {
            localTemplates = JSON.parse(fs.readFileSync(ALLTALK_TEMPLATES_FILE, 'utf8'));
        }

        let sentResult = null;
        let usedTemplateCode = 'Treatpost01'; // Default

        if (nextBooking) {
            // Branch 1: 예약 잡은 환자 (booking01 or next_visit template)
            let templateCode = 'booking01';
            let template = localTemplates.find(t => t.sensTemplateCode === templateCode);

            // 만약 booking01이 없으면 Treatpost01을 대체재로 시도
            if (!template) {
                console.warn(`[Post-Treatment Agent] Template ${templateCode} not found. Falling back to Treatpost01.`);
                templateCode = 'Treatpost01';
                template = localTemplates.find(t => t.sensTemplateCode === templateCode);
            }

            if (!template) {
                throw new Error(`Template ${templateCode} not found in synced templates. Please perform SENS Sync.`);
            }

            usedTemplateCode = templateCode;

            // 예약일시 포맷팅 (예: 3월 1일 (일) 오후 2:00)
            const extractDateStr = (dObj) => typeof dObj === 'string' ? dObj.substring(0, 10) : dObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
            const nextDateStr = extractDateStr(nextBooking.date);
            const bDate = new Date(`${nextDateStr}T${nextBooking.time}`);
            const days = ['일', '월', '화', '수', '목', '금', '토'];
            const dayName = days[bDate.getDay()];
            let hours = bDate.getHours();
            const ampm = hours >= 12 ? '오후' : '오전';
            hours = hours % 12 || 12;
            const minutes = String(bDate.getMinutes()).padStart(2, '0');
            const formattedDateStr = `${bDate.getMonth() + 1}월 ${bDate.getDate()}일 (${dayName}) ${ampm} ${hours}:${minutes}`;

            // 템플릿 내용 치환 (예약 안내 템플릿일 경우에만 필요할 수 있음)
            let content = template.sensContent.replace(/#\{예약일시\}/g, formattedDateStr);

            sentResult = await sens.sendAlimTalk(patientName, chartNo, cleanPhone, null, templateCode, content, null);

        } else {
            // Branch 2: 예약 잡지 않은 환자
            const templateCode = 'Treatpost01';
            usedTemplateCode = templateCode;
            const template = localTemplates.find(t => t.sensTemplateCode === templateCode);

            if (!template) {
                throw new Error(`Template ${templateCode} not found in synced templates. Please perform SENS Sync.`);
            }

            sentResult = await sens.sendAlimTalk(patientName, chartNo, cleanPhone, null, templateCode, template.sensContent, null);
        }

        if (sentResult.success) {
            // Mark as sent in DB / Memo so UI can show checkmark
            if (visitId) {
                // Here we can save a log in DB to mark Alimtalk sent for this visit. We'll append memo or separate column.
                await pool.query("UPDATE today_visits SET status = CONCAT(status, '_알림톡완료') WHERE id = ?", [visitId]);
            }
            res.json({ success: true, message: 'Alimtalk dispatched successfully.' });
        } else {
            // 실패 시에도 발송 내역(message_history)에 에러 문구를 기록
            const newId = Date.now();
            await pool.query(
                `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message)
                VALUES (?, ?, ?, ?, NOW(), '알림톡', 'failed', ?, ?)`,
                [newId, patientName, chartNo, cleanPhone, usedTemplateCode, sentResult.error]
            );

            res.json({ success: false, message: 'Failed to send Alimtalk: ' + sentResult.error });
        }

    } catch (error) {
        console.error('[Post-Treatment Agent] Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
