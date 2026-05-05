/**
 * All-Talk Automation Engine
 * - Schedule & Trigger Management
 */
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const naverSens = require('./naver-sens');
const telegram = require('../utils/telegram');
const pool = require('../config/db');

let DATA_DIR = '';
let FILES = {};

// 초기화
function init(dataDir, files) {
    DATA_DIR = dataDir;
    FILES = files;
    console.log('All-Talk Engine Initialized.');

    // D3톡 스케줄러 (매일 오후 2시 실행)
    cron.schedule('0 14 * * *', () => {
        console.log('[D3톡] 오후 2시 D3톡 발송 시작');
        sendD3RemindersV2();
    });
}

// 데이터 읽기 헬퍼
function readData(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`Read error: ${filePath}`, e);
        return [];
    }
}







/**
 * 시간을 한국어 형식으로 변환 (예: "14:30" -> "오후 2:30")
 */
function formatTimeKorean(timeStr) {
    if (!timeStr) return '';

    const [hourStr, minuteStr] = timeStr.split(':');
    let hour = parseInt(hourStr, 10);
    const minute = minuteStr || '00';

    let ampm = '오전';
    if (hour >= 12) {
        ampm = '오후';
        if (hour > 12) hour -= 12;
    }
    if (hour === 0) hour = 12;

    return `${ampm} ${hour}:${minute}`;
}

// ========================================
// D3톡 자동 발송 (탕전일 기준)
// 매일 오후 2시 실행
// ========================================

/**
 * D3톡 발송 대상 조회 및 발송
 * - 배송방법: 직접 → D+3, 택배 → D+4
 * - 프리셋(items 비어있음) 제외
 */
async function sendD3Reminders() {
    console.log('[D3톡] 발송 시작:', new Date().toISOString());

    try {
        // MariaDB에서 데이터 조회
        const [prescriptions] = await pool.query('SELECT * FROM prescriptions');
        const [patients] = await pool.query('SELECT * FROM patients');
        const history = readData(FILES.MESSAGE_HISTORY_FILE);

        if (!prescriptions || prescriptions.length === 0) {
            console.log('[D3톡] 처방 데이터 없음');
            return { success: true, sent: 0 };
        }

        // 한국시간(KST) 기준 오늘 날짜 계산
        const now = new Date();
        const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const todayStr = koreaTime.toISOString().split('T')[0];

        // === 보충 발송 로직: 지난 7일간의 누락 건 확인 ===
        const d3TargetDates = [];
        const d4TargetDates = [];

        for (let i = 0; i < 7; i++) {
            const d3Date = new Date(koreaTime.getTime() - ((3 + i) * 24 * 60 * 60 * 1000));
            d3TargetDates.push(d3Date.toISOString().split('T')[0]);

            const d4Date = new Date(koreaTime.getTime() - ((4 + i) * 24 * 60 * 60 * 1000));
            d4TargetDates.push(d4Date.toISOString().split('T')[0]);
        }

        console.log(`[D3톡] 오늘(KST): ${todayStr}`);

        let sentCount = 0;
        let failCount = 0;

        for (const presc of prescriptions) {
            // DB dates from mysql2 might be Date objects or YYYY-MM-DD strings. 
            // Better to normalize.
            const decoctionDate = presc.decoctionDate instanceof Date
                ? presc.decoctionDate.toISOString().split('T')[0]
                : presc.decoctionDate;
            const deliveryMethod = presc.deliveryMethod || '';

            // D+3 대상: 직접 찾아감, 직접 배송 (지난 7일 범위)
            const isD3Target = d3TargetDates.includes(decoctionDate) &&
                (deliveryMethod.includes('직접') || deliveryMethod.includes('찾아감'));

            // D+4 대상: 택배 (지난 7일 범위)
            const isD4Target = d4TargetDates.includes(decoctionDate) &&
                deliveryMethod.includes('택배');

            if (!isD3Target && !isD4Target) {
                continue;
            }

            // 환자 정보 조회
            const patient = patients.find(p => p.id === presc.patientId);
            if (!patient || !patient.phone) {
                console.log(`[D3톡] 환자 정보 없음: ${presc.patientName}`);
                continue;
            }

            // 이미 발송했는지 확인 (JSON + MariaDB)
            const alreadySentJson = history.some(h =>
                h.type === 'D3톡' &&
                h.chartNo === presc.patientChartNo &&
                (h.prescriptionId === presc.id ||
                    (h.decoctionDate && h.decoctionDate === decoctionDate))
            );

            if (alreadySentJson) continue;

            const [existsDb] = await pool.query(
                `SELECT id FROM message_history 
                 WHERE type = 'D3톡' AND chartNo = ? AND (prescriptionId = ? OR message LIKE ?)`,
                [presc.patientChartNo, presc.id, `%${decoctionDate}%`]
            );

            if (existsDb.length > 0) continue;

            // 발송
            const cleanPhone = patient.phone.replace(/[^0-9]/g, '');
            // items/doseInfo in MariaDB are parsed JSON if driver supports it, or strings.
            const doseInfo = typeof presc.doseInfo === 'string' ? JSON.parse(presc.doseInfo) : presc.doseInfo;
            const packs = doseInfo?.packs || 30;

            try {
                const result = await naverSens.sendD3Alimtalk(
                    presc.patientName,
                    presc.patientChartNo,
                    cleanPhone,
                    packs,
                    deliveryMethod
                );

                // MariaDB 발송 이력 저장
                await pool.query(
                    `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message, prescriptionId)
                    VALUES (?, ?, ?, ?, NOW(), 'D3톡', ?, 'decoction3', ?, ?)`,
                    [
                        Date.now() + Math.floor(Math.random() * 1000),
                        presc.patientName,
                        presc.patientChartNo,
                        patient.phone,
                        result.success ? 'success' : 'failed',
                        `${packs}팩 복용 안내 (${isD3Target ? 'D+3' : 'D+4'})`,
                        presc.id
                    ]
                );

                if (result.success) {
                    sentCount++;

                    // 발송 내역 저장 (JSON 즉시 반영)
                    history.push({
                        id: history.length > 0 ? Math.max(...history.map(h => h.id || 0)) + 1 : 1,
                        patientName: presc.patientName,
                        chartNo: presc.patientChartNo,
                        phone: patient.phone,
                        sentAt: new Date().toISOString(),
                        type: 'D3톡',
                        templateCode: 'decoction3',
                        prescriptionId: presc.id,
                        decoctionDate: decoctionDate,
                        status: 'success',
                        message: `${packs}팩 복용 안내 (${isD3Target ? 'D+3' : 'D+4'})`
                    });
                    fs.writeFileSync(FILES.MESSAGE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
                } else {
                    failCount++;
                }

                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
                failCount++;
                console.error(`[D3톡] 발송 오류: ${presc.patientName}`, error);
            }
        }

        return { success: true, sent: sentCount, failed: failCount };

    } catch (error) {
        console.error('[D3톡] 오류:', error);
        return { success: false, error: error.message };
    }
}

/**
 * [신규] D3톡 V2 발송 (로컬 연동 및 차번호 포함)
 * - 수동 테스트 또는 신규 템플릿 전환용
 */
async function sendD3RemindersV2() {
    console.log('[D3톡 V2] 발송 시작:', new Date().toISOString());

    try {
        const [prescriptions] = await pool.query('SELECT * FROM prescriptions');
        const [patients] = await pool.query('SELECT * FROM patients');
        const history = readData(FILES.MESSAGE_HISTORY_FILE);

        // 한국시간(KST) 기준 오늘 날짜 계산
        const now = new Date();
        const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const todayStr = koreaTime.toISOString().split('T')[0];

        const d3TargetDates = [];
        const d4TargetDates = [];

        for (let i = 0; i < 7; i++) {
            const d3Date = new Date(koreaTime.getTime() - ((3 + i) * 24 * 60 * 60 * 1000));
            d3TargetDates.push(d3Date.toISOString().split('T')[0]);

            const d4Date = new Date(koreaTime.getTime() - ((4 + i) * 24 * 60 * 60 * 1000));
            d4TargetDates.push(d4Date.toISOString().split('T')[0]);
        }

        let sentCount = 0;
        let failCount = 0;

        for (const presc of prescriptions) {
            const decoctionDate = presc.decoctionDate instanceof Date
                ? presc.decoctionDate.toISOString().split('T')[0]
                : presc.decoctionDate;
            const deliveryMethod = presc.deliveryMethod || '';

            // 1. 이미 발송했는지 확인 (JSON + MariaDB)
            const alreadySentJson = history.some(h =>
                h.type === 'D3톡' &&
                h.chartNo === presc.patientChartNo &&
                (h.prescriptionId === presc.id ||
                    (h.decoctionDate && h.decoctionDate === decoctionDate))
            );
            if (alreadySentJson) continue;

            const [existsDb] = await pool.query(
                `SELECT id FROM message_history 
                 WHERE type = 'D3톡' AND chartNo = ? AND (prescriptionId = ? OR message LIKE ?)`,
                [presc.patientChartNo, presc.id, `%${decoctionDate}%`]
            );
            if (existsDb.length > 0) continue;

            // 2. 발송 대상 여부 확인
            const isD3 = d3TargetDates.includes(decoctionDate) &&
                (deliveryMethod.includes('직접') || deliveryMethod.includes('찾아감'));

            const isD4 = d4TargetDates.includes(decoctionDate) &&
                deliveryMethod.includes('택배');

            if (!isD3 && !isD4) continue;

            const patient = patients.find(p => p.id === presc.patientId);
            if (!patient || !patient.phone) continue;

            const cleanPhone = patient.phone.replace(/[^0-9]/g, '');
            const doseInfo = typeof presc.doseInfo === 'string' ? JSON.parse(presc.doseInfo) : presc.doseInfo;

            try {
                const result = await naverSens.sendD3AlimtalkV2(
                    presc.patientName,
                    presc.patientChartNo,
                    cleanPhone,
                    doseInfo?.packs || 30,
                    presc.deliveryMethod
                );

                // MariaDB 발송 이력 저장
                await pool.query(
                    `INSERT INTO message_history (id, patientName, chartNo, phone, sentAt, type, status, templateCode, message, prescriptionId)
                    VALUES (?, ?, ?, ?, NOW(), 'D3톡', ?, 'd3talk', ?, ?)`,
                    [
                        Date.now() + Math.floor(Math.random() * 1000),
                        presc.patientName,
                        presc.patientChartNo,
                        patient.phone,
                        result.success ? 'success' : 'failed',
                        `[V2] ${doseInfo?.packs || 30}팩 복용 안내`,
                        presc.id
                    ]
                );

                if (result.success) {
                    sentCount++;

                    history.push({
                        id: history.length > 0 ? Math.max(...history.map(h => h.id || 0)) + 1 : 1,
                        patientName: presc.patientName,
                        chartNo: presc.patientChartNo,
                        phone: patient.phone,
                        sentAt: new Date().toISOString(),
                        type: 'D3톡',
                        templateCode: 'd3talk',
                        prescriptionId: presc.id,
                        decoctionDate: decoctionDate,
                        status: 'success',
                        message: `[V2] ${doseInfo?.packs || 30}팩 복용 안내`
                    });
                    fs.writeFileSync(FILES.MESSAGE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
                } else {
                    failCount++;
                }

                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (e) {
                failCount++;
            }
        }

        return { success: true, sent: sentCount, failed: failCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    init,
    sendD3Reminders,
    sendD3RemindersV2
};

