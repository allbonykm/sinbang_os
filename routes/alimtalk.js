/**
 * Integrated Message & AlimTalk Router
 * Replaces legacy routes/messages.js and legacy routes/alimtalk.js.
 * Handles: All-Talk (AlimTalk), SMS/LMS, Message History, Template Sync.
 */

const express = require('express');
const router = express.Router();
const sens = require('../utils/naver-sens');
const { 
    readData, writeData, 
    ALLTALK_TEMPLATES_FILE 
} = require('../utils/fileStore');
const pool = require('../config/db');
const { sanitizeChartNo } = require('../utils/patientUtils');
const { logSystemEvent } = require('./communicator');

// ==========================================
// 1. 올톡 템플릿 관리 (All-Talk Templates)
// ==========================================

// 로컬 템플릿 조회
router.get('/alltalk/templates', (req, res) => {
    try {
        const data = readData(ALLTALK_TEMPLATES_FILE);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// NCP SENS 동기화
router.post('/alltalk/import-sens-templates', async (req, res) => {
    try {
        const channelId = process.env.ALIMTALK_PLUS_ID || '@신방한의원';
        const result = await sens.getAlimtalkTemplates(channelId);

        if (!result.success) {
            return res.status(500).json({ success: false, message: 'Naver SENS API Error: ' + result.error });
        }

        const sensTemplates = result.templates;
        let localTemplates = readData(ALLTALK_TEMPLATES_FILE);
        const syncedCodes = new Set();
        let updatedCount = 0;
        let newCount = 0;

        for (const stShort of sensTemplates) {
            const detailResult = await sens.getAlimtalkTemplates(channelId, stShort.templateCode);
            if (!detailResult.success || !detailResult.templates || detailResult.templates.length === 0) continue;

            const st = detailResult.templates[0];
            syncedCodes.add(st.templateCode);
            const existingIndex = localTemplates.findIndex(lt => lt.sensTemplateCode === st.templateCode && (!lt.type || lt.type !== 'bmm'));
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
                emphasizeType: st.emphasizeType || 'NONE',
                emphasizeTitle: st.title || null,
                sensHeaderContent: st.additionalTitle || st.headerContent || st.header || null,
                useHeaderContent: st.useHeaderContent || false,
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
        }

        // 동기화 목록에 없는 기존 알림톡 삭제
        const beforeCount = localTemplates.length;
        localTemplates = localTemplates.filter(lt => {
            // 브랜드 메시지가 아닌 것(알림톡)만 체크하여 삭제
            if (!lt.type || lt.type !== 'bmm') {
                return syncedCodes.has(lt.sensTemplateCode);
            }
            return true;
        });
        const deletedCount = beforeCount - localTemplates.length;

        writeData(ALLTALK_TEMPLATES_FILE, localTemplates);
        res.json({ 
            success: true, 
            message: `동기화 완료: ${newCount}건 추가, ${updatedCount}건 업데이트, ${deletedCount}건 삭제됨.`, 
            sensTemplates 
        });
    } catch (error) {
        console.error('Sync Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 2. 메시지 발송 (Sending)
// ==========================================

// 알림톡 발송 (All-Talk 전용)
router.post('/alltalk/send-alimtalk', async (req, res) => {
    try {
        const { patients: rawPatients, templateCode, content, buttons, variables } = req.body;
        const patients = rawPatients.map(p => ({ ...p, chartNo: sanitizeChartNo(p.chartNo) }));
        const results = [];

        for (const p of patients) {
            try {
                const cleanPhone = (p.phone || '').replace(/[^0-9]/g, '');
                const result = await sens.sendAlimTalk(p.name, p.chartNo, cleanPhone, null, templateCode, content, buttons, variables);
                
                const formattedPhone = cleanPhone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
                const requestId = (result.data && result.data.requestId) || null;
                const statusName = result.success ? 'success' : 'failed';
                const errorDesc = result.success ? '' : (result.error || '');

                await pool.query(
                    `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message, requestId)
                    VALUES (?, ?, ?, ?, NOW(), '알림톡', ?, ?, ?, ?)`,
                    [`${Date.now()}-${p.chartNo}-${Math.floor(Math.random() * 10000)}`, p.name, p.chartNo || '', formattedPhone, statusName, templateCode, errorDesc, requestId]
                );

                const io = req.app.get('io');
                logSystemEvent(io, 'msg:alimtalk', `알림톡 발송 완료: ${p.name}`, { patientName: p.name, chartNo: p.chartNo, status: statusName });

                results.push({ name: p.name, success: result.success, error: result.error });
            } catch (e) {
                results.push({ name: p.name, success: false, error: e.message });
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 브랜드 메시지 동기화
router.post('/alltalk/import-bmm-templates', async (req, res) => {
    try {
        const result = await sens.getBrandMessageTemplates();

        if (!result.success) {
            return res.json({ success: false, message: result.error || '브랜드 메시지 동기화 실패' });
        }

        const rawTemplates = result.templates || [];
        const bmmTemplates = Array.isArray(rawTemplates) ? rawTemplates : (rawTemplates.items || rawTemplates.templates || []);
        let localTemplates = readData(ALLTALK_TEMPLATES_FILE);
        const syncedCodes = new Set();

        let updatedCount = 0;
        let newCount = 0;

        for (const st of bmmTemplates) {
            syncedCodes.add(st.templateCode);
            const existingIndex = localTemplates.findIndex(lt => lt.sensTemplateCode === st.templateCode && lt.type === 'bmm');
            
            const newEntry = {
                id: `bmm_${st.templateCode}`, 
                title: st.templateName,
                type: 'bmm', // 브랜드 메시지 구분
                messageType: st.messageType || 'TEXT',
                status: 'approved',
                createdAt: st.createTime ? st.createTime.split('T')[0] : new Date().toISOString().split('T')[0],
                sensTemplateCode: st.templateCode,
                sensContent: st.content || '',
                sensStatus: st.templateInspectionStatus,
                sensTemplateStatus: st.templateStatus,
                sensTemplateName: st.templateName,
                steps: [{
                    id: `step_bmm_${st.templateCode}`,
                    content: st.content || '',
                    buttons: (st.buttons || []).map(b => ({
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
        }

        // 동기화 목록에 없는 기존 브랜드 메시지 삭제
        const beforeCount = localTemplates.length;
        localTemplates = localTemplates.filter(lt => {
            if (lt.type === 'bmm') {
                return syncedCodes.has(lt.sensTemplateCode);
            }
            return true;
        });
        const deletedCount = beforeCount - localTemplates.length;

        writeData(ALLTALK_TEMPLATES_FILE, localTemplates);
        res.json({ 
            success: true, 
            message: `브랜드 메시지 동기화 완료: ${newCount}건 추가, ${updatedCount}건 업데이트, ${deletedCount}건 삭제됨.`
        });
    } catch (error) {
        console.error('BMM Sync Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 브랜드 메시지 발송
router.post('/alltalk/send-brandmessage', async (req, res) => {
    try {
        const { patients: rawPatients, templateCode, messageType, content, buttons, variables } = req.body;
        const patients = rawPatients.map(p => ({ ...p, chartNo: sanitizeChartNo(p.chartNo) }));
        const results = [];

        for (const p of patients) {
            try {
                const cleanPhone = (p.phone || '').replace(/[^0-9]/g, '');
                const result = await sens.sendBrandMessage(p.name, p.chartNo, cleanPhone, templateCode, messageType, content, buttons, variables);
                
                const formattedPhone = cleanPhone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
                const requestId = (result.data && result.data.requestId) || null;
                const statusName = result.success ? 'success' : 'failed';
                const errorDesc = result.success ? '' : (result.error || '');

                await pool.query(
                    `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message, requestId)
                    VALUES (?, ?, ?, ?, NOW(), '브랜드메시지', ?, ?, ?, ?)`,
                    [`${Date.now()}-${p.chartNo}-${Math.floor(Math.random() * 10000)}`, p.name, p.chartNo || '', formattedPhone, statusName, templateCode, errorDesc, requestId]
                );

                const io = req.app.get('io');
                logSystemEvent(io, 'msg:bmm', `브랜드 메시지 발송 완료: ${p.name}`, { patientName: p.name, status: statusName });

                results.push({ name: p.name, success: result.success, error: result.error });
            } catch (e) {
                results.push({ name: p.name, success: false, error: e.message });
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// SMS/LMS 단건 및 일괄 발송
router.post('/send-sms', async (req, res) => {
    const { patients: rawPatients, content } = req.body;
    if (!rawPatients || !content) return res.status(400).json({ success: false, message: '보낼 환자와 내용을 입력하세요.' });
    const patients = rawPatients.map(p => ({ ...p, chartNo: sanitizeChartNo(p.chartNo) }));

    try {
        const results = [];
        for (const p of patients) {
            const cleanPhone = (p.phone || '').replace(/[^0-9]/g, '');
            const result = await sens.sendSMSWithRetry(cleanPhone, content);

            const formattedPhone = cleanPhone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
            const sentAt = new Date();
            const sentType = result.msgType || (sens.getByteLength(content) > 90 ? 'LMS' : 'SMS');

            await pool.query(
                `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, message)
                VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
                [`${Date.now()}-${p.chartNo}-${Math.floor(Math.random() * 10000)}`, p.name || '', p.chartNo || '', formattedPhone, sentType, result.success ? 'success' : 'failed', content]
            );

            if (result.success) {
                const io = req.app.get('io');
                logSystemEvent(io, 'msg:sms', `${sentType} 발송 완료: ${p.name}`, { patientName: p.name, type: sentType });
            }
            results.push({ name: p.name, success: result.success, error: result.error });
        }
        res.json({ success: true, results });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// = ==========================================
// 3. 메시지 이력 (History)
// = ==========================================

// 전체 발송 내역 조회
router.get('/message-history', async (req, res) => {
    const { q, limit = 50 } = req.query;
    try {
        let sql = 'SELECT * FROM message_history WHERE 1=1';
        const params = [];

        if (q) {
            sql += ' AND (patientName LIKE ? OR chartNo LIKE ? OR phone LIKE ?)';
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        sql += ' ORDER BY sentAt DESC LIMIT ?';
        params.push(parseInt(limit));

        const [rows] = await pool.query(sql, params);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 특정 환자 발송 내역 조회
router.get('/message-history/:chartNo', async (req, res) => {
    const { chartNo: rawChartNo } = req.params;
    const chartNo = sanitizeChartNo(rawChartNo);
    try {
        const [rows] = await pool.query('SELECT * FROM message_history WHERE chartNo = ? ORDER BY sentAt DESC', [chartNo]);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 메시지 로그 직접 추가 (시스템 자동 연동용)
router.post('/log-message', async (req, res) => {
    try {
        const { patientName, chartNo: rawChartNo, phone, type, status, message } = req.body;
        const chartNo = sanitizeChartNo(rawChartNo);
        const newId = Date.now();
        await pool.query(
            `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, message)
            VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
            [newId, patientName || '', chartNo || '', phone || '', type || 'SMS', status || 'success', message || '']
        );
        res.json({ success: true, id: newId });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// = ==========================================
// 4. 유틸리티 (Utility)
// = ==========================================

// 환자의 최신 예약 조회 (All-Talk 휴진 안내 등에서 사용)
router.get('/alltalk/recent-booking/:chartNo', async (req, res) => {
    const { chartNo: rawChartNo } = req.params;
    const chartNo = sanitizeChartNo(rawChartNo);
    try {
        const [rows] = await pool.query(
            "SELECT id, chartNo, name, date, time FROM bookings WHERE chartNo = ? AND date >= CURDATE() ORDER BY date ASC, time DESC LIMIT 1",
            [chartNo]
        );
        res.json({ success: true, data: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
