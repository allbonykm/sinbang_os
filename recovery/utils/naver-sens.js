/**
 * Naver SENS API Utility Module
 * Handles SMS and AlimTalk transmission via Naver Cloud Platform.
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let apiConfig = null;

// Initialize Configuration
function initConfig(config) {
    apiConfig = { ...(apiConfig || {}), ...config };
}

// 자동 설정 로드 (환경 변수 기반)
function getAutoConfig() {
    return {
        ACCESS_KEY: process.env.NCP_ACCESS_KEY,
        SECRET_KEY: process.env.NCP_SECRET_KEY,
        SMS_SERVICE_ID: process.env.SMS_SERVICE_ID,
        ALIMTALK_SERVICE_ID: process.env.ALIMTALK_SERVICE_ID,
        ALIMTALK_PLUS_ID: process.env.ALIMTALK_PLUS_ID || '@신방한의원',
        ALIMTALK_TEMPLATE_CODE: process.env.ALIMTALK_TEMPLATE_CODE || 'Treatpost03',
        SENDER_PHONE: process.env.SENDER_PHONE || '0313049000',
        LMS_THRESHOLD: parseInt(process.env.LMS_THRESHOLD || '90', 10),
        LMS_SUBJECT: process.env.LMS_SUBJECT || '[신방한의원]'
    };
}

// 명시적으로 설정되지 않은 경우 자동 설정을 기본값으로 사용
function getConfig() {
    if (!apiConfig) {
        apiConfig = getAutoConfig();
    }
    return apiConfig;
}

// HMAC-SHA256 시그니처 생성
function makeSignature(method, url, timestamp) {
    const config = getConfig();
    if (!config || !config.ACCESS_KEY || !config.SECRET_KEY) {
        throw new Error('네이버 SENS API 설정이 누락되었습니다. (.env 확인 필요)');
    }
    const message = `${method} ${url}\n${timestamp}\n${config.ACCESS_KEY}`;
    return crypto.createHmac('sha256', config.SECRET_KEY).update(message).digest('base64');
}

// 바이트 길이 계산 (한글 2바이트 기준)
function getByteLength(str) {
    let byteLength = 0;
    for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i);
        byteLength += (charCode <= 0x7F) ? 1 : 2;
    }
    return byteLength;
}

// JSON 파일에서 템플릿 로드
function loadTemplateFromJson(templateCode) {
    try {
        const templatesPath = path.join(__dirname, '..', 'data', 'alltalk-templates.json');
        if (!fs.existsSync(templatesPath)) return null;

        const templates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
        return templates.find(t => t.sensTemplateCode === templateCode) || null;
    } catch (error) {
        console.error('[naver-sens] 템플릿 로드 실패:', error.message);
        return null;
    }
}

// SMS 발송 (75바이트 초과 시 자동으로 LMS로 업그레이드)
function sendSMS(phone, content) {
    const config = getConfig();
    const timestamp = Date.now().toString();
    const urlPath = `/sms/v2/services/${config.SMS_SERVICE_ID}/messages`;
    const signature = makeSignature('POST', urlPath, timestamp);

    const byteLength = getByteLength(content);
    // 설정된 LMS 임계값 사용 (기본값 90)
    const threshold = config.LMS_THRESHOLD || 90;
    const isLms = byteLength > threshold;
    const msgType = isLms ? 'LMS' : 'SMS';

    const payload = {
        type: msgType,
        contentType: 'COMM',
        countryCode: '82',
        from: config.SENDER_PHONE,
        subject: isLms ? (config.LMS_SUBJECT || '[신방한의원]') : '', // LMS requires subject
        content: content,
        messages: [{ to: phone }]
    };

    return makeRequest(urlPath, 'POST', payload, timestamp, signature)
        .then(res => ({ ...res, msgType, byteLength })); // 바이트 정보 반환
}

// 알림톡 발송
async function sendAlimTalk(name, chartNo, phone, failoverMessage, templateCode = null, customContent = null, customButtons = null, variables = null) {
    const config = getConfig();
    const timestamp = Date.now().toString();
    const urlPath = `/alimtalk/v2/services/${config.ALIMTALK_SERVICE_ID}/messages`;
    const signature = makeSignature('POST', urlPath, timestamp);

    const finalTemplateCode = (templateCode && templateCode.trim() !== '')
        ? templateCode
        : config.ALIMTALK_TEMPLATE_CODE;

    // 템플릿 로직 로드
    let alimtalkContent = '';
    let buttons = customButtons;

    const loadedTemplate = loadTemplateFromJson(finalTemplateCode);

    // 엄격 모드: 로컬에서 템플릿을 찾지 못할 경우 발송 실패 처리
    if (!loadedTemplate) {
        const errorMsg = `[엄격 모드] '${finalTemplateCode}' 템플릿을 로컬에서 찾을 수 없습니다. 관리자 대시보드에서 SENS 동기화를 진행해 주세요.`;
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    // 1. Determine Content
    const vars = variables || (arguments[arguments.length - 1] && typeof arguments[arguments.length - 1] === 'object' ? arguments[arguments.length - 1] : {});

    if (customContent) {
        alimtalkContent = customContent
            .replace(/#\{(이름|name)\}/g, name)
            .replace(/#\{(date|예약날짜|예약일시)\}/g, (vars && (vars.date || vars.예약날짜 || vars.예약일시)) || '#{date}')
            .replace(/\$\{name\}/g, name);

        // Generic substitutions for any other variables passed in
        Object.keys(vars).forEach(key => {
            const regex = new RegExp(`#\\{${key}\\}`, 'g');
            alimtalkContent = alimtalkContent.replace(regex, vars[key] || '');
        });
    } else if (loadedTemplate) {
        const templateContent = loadedTemplate.sensContent ||
            (loadedTemplate.steps && loadedTemplate.steps[0] ? loadedTemplate.steps[0].content : null);

        if (templateContent) {
            alimtalkContent = templateContent
                .replace(/#\{(이름|name)\}/g, name)
                .replace(/#\{(date|예약날짜|예약일시)\}/g, (vars && (vars.date || vars.예약날짜 || vars.예약일시)) || '#{date}')
                .replace(/#\{차트번호\}/g, chartNo || '')
                .replace(/\$\{name\}/g, name);

            // 전달된 추가 변수들에 대한 일반 치환 처리
            Object.keys(vars).forEach(key => {
                const regex = new RegExp(`#\\{${key}\\}`, 'g');
                alimtalkContent = alimtalkContent.replace(regex, vars[key] || '');
            });
        }
    }

    // 대체 콘텐츠 (레거시 지원 - 엄격 모드에서는 제거 예정)
    if (!alimtalkContent) {
        console.log('[naver-sens] 대체 콘텐츠 사용');
        alimtalkContent = `[신방한의원]\n${name}님, 오늘 신방한의원을 방문해 주셔서 감사합니다.\n\n오늘 안내드린 내용을 참고하시어\n꾸준히 관리하시면 좋은 결과가 있으실 거예요.\n\n빠른 쾌유를 기원합니다.\n\n- 신방한의원 드림`;
    }

    // 2. 버튼 구성 결정
    if (customButtons) {
        buttons = customButtons.map(btn => ({
            type: btn.type || 'WL',
            name: btn.name,
            linkMobile: (btn.linkMobile || '')
                .replace(/#\{이름\}/g, encodeURIComponent(name))
                .replace(/#\{name\}/g, encodeURIComponent(name))
                .replace(/#\{차트번호\}/g, encodeURIComponent(chartNo || '')),
            linkPc: (btn.linkPc || '')
                .replace(/#\{이름\}/g, encodeURIComponent(name))
                .replace(/#\{name\}/g, encodeURIComponent(name))
                .replace(/#\{차트번호\}/g, encodeURIComponent(chartNo || ''))
        }));
    } else if (loadedTemplate && loadedTemplate.steps && loadedTemplate.steps[0] && loadedTemplate.steps[0].buttons) {
        buttons = loadedTemplate.steps[0].buttons.map(btn => {
            let linkMobile = (btn.linkMobile || '')
                .replace(/#\{이름\}/g, encodeURIComponent(name))
                .replace(/#\{name\}/g, encodeURIComponent(name))
                .replace(/#\{차트번호\}/g, encodeURIComponent(chartNo || ''));
            
            let linkPc = (btn.linkPc || '')
                .replace(/#\{이름\}/g, encodeURIComponent(name))
                .replace(/#\{name\}/g, encodeURIComponent(name))
                .replace(/#\{차트번호\}/g, encodeURIComponent(chartNo || ''));

            // 추가 변수(vars) 치환
            Object.keys(vars).forEach(key => {
                const regex = new RegExp(`#\\{${key}\\}`, 'g');
                linkMobile = linkMobile.replace(regex, encodeURIComponent(vars[key] || ''));
                linkPc = linkPc.replace(regex, encodeURIComponent(vars[key] || ''));
            });

            // 치환되지 않은 자리 표시자 제거
            linkMobile = linkMobile.replace(/#\{url\}/g, '');
            linkPc = linkPc.replace(/#\{url\}/g, '');

            return {
                type: btn.type === 'url' ? 'WL' : (btn.type || 'WL'),
                name: btn.name,
                linkMobile,
                linkPc
            };
        });
    }

    // Fallback Buttons Removed (Strict Mode)
    if (!buttons && !customButtons) {
        // Did not load buttons from template, and no custom buttons.
        // In Strict Mode, do we fail? Or just send no buttons?
        // Usually templates have buttons. If loadedTemplate exists but has no buttons, it's fine.
        // But if we failed to map, it might be an issue.
        // For now, let's allow no-buttons if the template says so.
    }


    // (대체 발송 로직 제거됨)


    // [올본 OS 로직 이식] 강조 표기 타이틀 설정
    // 템플릿의 emphasizeType이 TEXT일 때만 title 필드를 포함하여 보냅니다.
    let msgTitle = (loadedTemplate && loadedTemplate.emphasizeType === 'TEXT') 
        ? loadedTemplate.emphasizeTitle 
        : undefined;

    // 공백으로 인한 매칭 오류 방지 (3028 에러 대응)
    if (msgTitle) msgTitle = msgTitle.trim();

    const messagePayload = {
        to: phone,
        content: alimtalkContent,
        title: msgTitle, // 강조 표기 타이틀
        buttons: buttons && buttons.length > 0 ? buttons.map(btn => ({
            ...btn,
            linkMobile: btn.linkMobile ? btn.linkMobile.trim() : undefined,
            linkPc: btn.linkPc ? btn.linkPc.trim() : undefined
        })) : undefined,
        useSmsFailover: false // 개별 메시지 레벨에서도 강제 차단
    };

    const payload = {
        plusFriendId: config.ALIMTALK_PLUS_ID,
        templateCode: finalTemplateCode,
        messages: [messagePayload],
        useSmsFailover: false // 전체 레벨 차단
    };

    return makeRequest(urlPath, 'POST', payload, timestamp, signature);
}

// 공통 요청 헬퍼
function makeRequest(path, method, payload, timestamp, signature) {
    const config = getConfig();
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'sens.apigw.ntruss.com',
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-ncp-apigw-timestamp': timestamp,
                'x-ncp-iam-access-key': config.ACCESS_KEY,
                'x-ncp-apigw-signature-v2': signature
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    // statusCode 202 is also success for Alimtalk
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ success: true, data: result, statusCode: res.statusCode });
                    } else {
                        // Extract detailed error messages from NCP
                        let detailedError = result.errorMessage || result.statusName || data;
                        if (result.messages && result.messages.length > 0) {
                            const errs = result.messages.filter(m => m.statusName === 'fail').map(m => m.failoverConfig ? `MsgFail: ${m.failoverConfig.content}` : 'SendFail');
                            if (errs.length > 0) detailedError += ` | Details: ${errs.join(', ')}`;
                        }
                        resolve({ success: false, error: detailedError, statusCode: res.statusCode });
                    }
                } catch (e) {
                    resolve({ success: false, error: `응답 파싱 실패 (HTTP ${res.statusCode}): ${data}` });
                }
            });
        });

        req.on('error', (e) => reject({ success: false, error: e.message }));
        if (payload) req.write(JSON.stringify(payload));
        req.end();
    });
}

// 추가 헬퍼 함수들 (호환성을 위해 내보내기됨)
async function sendSMSWithRetry(phone, content, maxRetries = 3) {
    let lastError = '알 수 없는 오류';
    for (let i = 0; i < maxRetries; i++) {
        try {
            const result = await sendSMS(phone, content);
            if (result.success) return result;
            lastError = result.error || result.statusMessage || JSON.stringify(result);
            console.error(`[SMS Attempt ${i + 1}] Failed:`, lastError);
        } catch (e) {
            lastError = e.message;
            console.error(`[SMS Attempt ${i + 1}] Exception:`, lastError);
        }
        if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 2000));
    }
    return { success: false, error: `최대 재시도 횟수 초과 (${lastError})` };
}

async function getAlimtalkTemplates(channelId, templateCode = null) {
    const config = getConfig();
    const timestamp = Date.now().toString();
    let urlPath = `/alimtalk/v2/services/${config.ALIMTALK_SERVICE_ID}/templates?channelId=${encodeURIComponent(channelId)}`;
    if (templateCode) urlPath += `&templateCode=${encodeURIComponent(templateCode)}`;

    return makeRequest(urlPath, 'GET', null, timestamp, makeSignature('GET', urlPath, timestamp))
        .then(res => ({ success: res.success, templates: res.data, statusCode: res.statusCode }));
}

/**
 * D3톡(복약케어) 전용 알림톡 발송 (기존 버전 - 호환성 유지)
 */
async function sendD3Alimtalk(name, chartNo, phone, packs, deliveryMethod) {
    const templateCode = 'decoction3';
    // 기존 URL은 템플릿 파일에서 로드됨
    return sendAlimTalk(name, chartNo, phone, null, templateCode);
}

/**
 * D3톡(복약케어) 전용 알림톡 발송 (V2 - 신규 로컬 연동 버전)
 */
async function sendD3AlimtalkV2(name, chartNo, phone, packs, deliveryMethod) {
    const templateCode = 'd3talk';
    return sendAlimTalk(name, chartNo, phone, null, templateCode);
}

module.exports = {
    initConfig,
    sendSMS,
    sendAlimTalk,
    sendD3Alimtalk,
    sendD3AlimtalkV2,
    sendSMSWithRetry,
    getByteLength,
    getAlimtalkTemplates,
    makeRequest // Exported for external use if needed (e.g., sync)
};

