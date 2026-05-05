const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const pool = require('../config/db'); // MariaDB Pool

const {
    readData, writeData,
    TREATMENT_BOARD_FILE,
    // TREATMENT_HISTORY_FILE, // Removed: Use DB
    PATIENTS_FILE, // Keep for fallback or simple lookups if needed, but pref DB
    AUTO_INSURANCE_FILE, INSURANCE_FILE, DATA_DIR, CONFIG_FILE
} = require('../utils/fileStore');

const { logSystemEvent } = require('./communicator');

const { getKSTDate } = require('../utils/dateUtils');

// ===========================================
// 보드 설정 API (알림 기기 등록 등)
// ===========================================

// 클라이언트 IP 조회
router.get('/config/my-ip', (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    res.json({ success: true, ip });
});

// 알림 설정 조회
router.get('/config/audio-settings', (req, res) => {
    try {
        let config = readData(CONFIG_FILE);
        if (Array.isArray(config)) config = {};
        res.json({ success: true, data: config.audioSettings || {} });
    } catch (error) {
        console.error('[Treatments] audio-settings error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 오디오 플레이리스트 조회
router.get('/config/audio-playlist', (req, res) => {
    try {
        const audioDir = path.join(__dirname, '../public/audio');
        let files = [];
        if (fs.existsSync(audioDir)) {
            files = fs.readdirSync(audioDir).filter(file =>
                ['.mp3', '.wav', '.m4a', '.ogg', '.aac'].includes(path.extname(file).toLowerCase())
            );
        }

        let config = readData(CONFIG_FILE);
        if (Array.isArray(config)) config = {};

        res.json({
            success: true,
            files,
            settings: config.audioSettings || {}
        });
    } catch (error) {
        console.error('[Treatments] audio-playlist error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 알림 재생 설정 저장
router.post('/config/audio-settings', (req, res) => {
    try {
        const { playbackMode, lastPlayedIndex } = req.body;
        let config = readData(CONFIG_FILE);
        if (Array.isArray(config)) config = {};

        config.audioSettings = config.audioSettings || {};
        if (playbackMode) config.audioSettings.playbackMode = playbackMode;
        if (lastPlayedIndex !== undefined) config.audioSettings.lastPlayedIndex = lastPlayedIndex;

        writeData(CONFIG_FILE, config);
        res.json({ success: true });
    } catch (error) {
        console.error('[Treatments] save audio-settings error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 알림 재생 기기 등록
router.post('/config/audio-target', (req, res) => {
    try {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        let config = readData(CONFIG_FILE);
        if (Array.isArray(config)) config = {};

        config.audioSettings = config.audioSettings || {};
        config.audioSettings.targetIp = ip;
        config.audioSettings.updatedAt = new Date().toISOString();

        writeData(CONFIG_FILE, config);
        console.log('[Treatments] Target IP registered:', ip);
        res.json({ success: true, targetIp: ip });
    } catch (error) {
        console.error('[Treatments] audio-target error:', error);
        res.json({ success: false, message: error.message });
    }
});

// ===========================================
// 치료실 보드 API
// Note: Board State is ephemeral and kept in JSON for now (High frequency read/write).
// History is moved to DB.
// ===========================================

// 치료실 보드 조회
router.get('/treatment-board', async (req, res) => {
    try {
        const board = readData(TREATMENT_BOARD_FILE);
        const patients = readData(PATIENTS_FILE);
        // Note: Could replace patients readData with DB call, but for joining with Board (memory), 
        // file cache is faster/simpler for now unless huge. Patients < 1000 is fine.

        // Fetch recent history from DB for "Last Visit" logic
        // We only need history for the patients currently on board.
        // But the original logic scanned all history.
        // Let's implement optimized logic:
        // For each board item, query DB for last visit? N+1 problem.
        // Better: Get all relevant history in one go or just simplified.
        // Or since `treatment-history` table is indexed by patientId, fast lookups are possible.

        const enrichedBoard = await Promise.all(board.map(async (item) => {
            // 1. 환자 정보 (생년월일)
            const patientInfo = patients.find(p => String(p.id) === String(item.patientId));
            const birthGender = patientInfo ? patientInfo.birthGender : '';

            // 2. 직전 내원일 (DB 조회)
            // 종료된 기록 중 가장 최근 entryTime
            // "본인 입실 시간"보다 이전이어야 함.
            const [rows] = await pool.query(
                'SELECT entryTime, exitTime FROM treatment_history WHERE patientId = ? ORDER BY entryTime DESC LIMIT 5',
                [item.patientId]
            );

            const currentEntryTime = new Date(item.entryTime);

            // Filter valid history (ended before current entry)
            const validHistory = rows.filter(h => {
                const hTime = h.exitTime ? new Date(h.exitTime) : new Date(h.entryTime);
                return hTime < new Date(currentEntryTime.getTime() - 60000);
            });

            const lastVisitData = validHistory.length > 0 ? validHistory[0] : null;
            const lastVisit = lastVisitData ? lastVisitData.entryTime : null;

            return {
                ...item,
                birthGender,
                lastVisit
            };
        }));

        res.json({ success: true, data: enrichedBoard });
    } catch (error) {
        console.error('Board Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 환자 입실 (Bed 배정)
router.post('/treatment-board', async (req, res) => {
    try {
        const { bedNo, patientId, patientName, chartNo } = req.body;
        const board = readData(TREATMENT_BOARD_FILE);

        // 이미 해당 Bed에 환자가 있는지 확인
        const existingIdx = board.findIndex(b => b.bedNo === bedNo);
        if (existingIdx !== -1) {
            return res.json({ success: false, message: '해당 Bed에 이미 환자가 있습니다.' });
        }

        const newEntry = {
            id: Date.now(),
            bedNo,
            patientId,
            patientName,
            chartNo,
            entryTime: new Date().toISOString(),
            status: {
                '핫팩': false,
                ICT: false,
                SSP: false,
                '침': false,
                '추나': false,
                '충격파': false,
                '추나완료': false,
                '약침': '',
                '약침완료': false,
                '검사': '',
                '검사완료': false,
                '종료': false
            },
            exitTime: null,
            note: ''
        };

        board.push(newEntry);
        writeData(TREATMENT_BOARD_FILE, board);

        // [추가] 오늘 내원 환자 목록(DB: today_visits)에 자동 등록
        try {
            const today = new Date().toISOString().split('T')[0];

            // DB에 이미 있는지 확인
            const [existingVisits] = await pool.query(
                'SELECT id FROM today_visits WHERE patientId = ? AND DATE(visitedAt) = ?',
                [patientId, today]
            );

            if (existingVisits.length === 0) {
                // 환자 정보 (birthGender)
                const allPatients = readData(PATIENTS_FILE);
                const patientInfo = allPatients.find(p => String(p.id) === String(patientId));

                await pool.query(
                    `INSERT INTO today_visits 
                   (patientId, patientName, chartNo, birthGender, visitedAt, date, status, fromBooking, bookingId)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        patientId,
                        patientName,
                        chartNo,
                        patientInfo ? patientInfo.birthGender : '',
                        new Date(),
                        today,
                        '내원',
                        0,
                        null
                    ]
                );

                // [추가] 실시간 동기화 알림
                if (io) io.emit('visits:update');
            }

        } catch (err) {
            console.error('내원 목록 자동 등록 실패:', err);
        }


        // [추가] 커뮤니케이터 시스템 이벤트 기록
        const io = req.app.get('io');
        logSystemEvent(io, 'bed:entry', `${newEntry.bedNo}번 베드 입실: ${patientName}`, {
            bedNo: newEntry.bedNo,
            patientName,
            chartNo
        });

        // [제거] 자동차보험 환자 입실 알림 (Jabo removed)
        /*
        try {
            const [jaboRows] = await pool.query("SELECT * FROM auto_insurance_patients WHERE patientId = ? AND status = 'active'", [patientId]);
            ...
        } catch (jaboErr) {
            console.error('자보 알림 오류:', jaboErr);
        }
        */

        // [추가] 실시간 동기화 알림
        if (io) io.emit('board:update');

        res.json({ success: true, data: newEntry });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 치료 상태 업데이트 (File)
router.put('/treatment-board/:bedNo', (req, res) => {
    try {
        const bedNo = parseInt(req.params.bedNo);
        const { status, note } = req.body;
        const board = readData(TREATMENT_BOARD_FILE);

        const idx = board.findIndex(b => b.bedNo === bedNo);
        if (idx === -1) {
            return res.json({ success: false, message: '해당 Bed를 찾을 수 없습니다.' });
        }

        if (status) {
            board[idx].status = { ...board[idx].status, ...status };
        }
        if (note !== undefined) {
            board[idx].note = note;
        }

        writeData(TREATMENT_BOARD_FILE, board);

        // [추가] 실시간 동기화 알림
        const io = req.app.get('io');
        if (io) io.emit('board:update');

        res.json({ success: true, data: board[idx] });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 환자 퇴실 (종료) -> DB Insert
router.delete('/treatment-board/:bedNo', async (req, res) => {
    try {
        const bedNo = parseInt(req.params.bedNo);
        const board = readData(TREATMENT_BOARD_FILE);

        const idx = board.findIndex(b => b.bedNo === bedNo);
        if (idx === -1) {
            return res.json({ success: false, message: '해당 Bed를 찾을 수 없습니다.' });
        }

        // 1. 퇴실 정보 준비
        const exitedPatient = board[idx];
        exitedPatient.exitTime = new Date().toISOString();
        exitedPatient.status.종료 = true;

        // 2. DB에 히스토리 저장
        await pool.query(
            `INSERT INTO treatment_history (bedNo, patientId, patientName, chartNo, entryTime, exitTime, status, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                exitedPatient.bedNo,
                exitedPatient.patientId,
                exitedPatient.patientName,
                exitedPatient.chartNo,
                new Date(exitedPatient.entryTime),
                new Date(exitedPatient.exitTime),
                JSON.stringify(exitedPatient.status),
                exitedPatient.note
            ]
        );

        // 3. 보험약 재고 차감 로직 (보험 파일 유지)
        if (exitedPatient.status && exitedPatient.status.보험 && exitedPatient.status.보험.selected) {
            try {
                const { name, days } = exitedPatient.status.보험;
                const daysNum = parseInt(days);

                if (name && daysNum > 0) {
                    const medicines = readData(INSURANCE_FILE);
                    let isUpdated = false;

                    // 작감정 등 복합 처방 로직 유지...
                    // (작감정: 작약2 + 감초2)
                    const updateMedicineStock = (targetName, count) => {
                        const targetIdx = medicines.findIndex(m => m.name.includes(targetName));
                        if (targetIdx !== -1) {
                            medicines[targetIdx].total_count -= count;
                            medicines[targetIdx].history = medicines[targetIdx].history || [];
                            medicines[targetIdx].history.push({
                                date: new Date().toISOString(),
                                stock: medicines[targetIdx].total_count,
                                computer: `처방차감(${name})`,
                                patient: exitedPatient.patientName
                            });
                            isUpdated = true;
                        }
                    };

                    if (name === '작감정') {
                        updateMedicineStock('작약', daysNum * 2);
                        updateMedicineStock('감초', daysNum * 2);
                    } else {
                        updateMedicineStock(name, daysNum * 3);
                    }

                    if (isUpdated) {
                        writeData(INSURANCE_FILE, medicines);
                        console.log(`[보험약 차감] ${exitedPatient.patientName} - ${name} ${days}일분 차감 완료`);

                        // [제거] 보험약 처방 내역 DB 저장 (insurance_prescriptions 테이블 삭제됨)
                        /*
                        try {
                            ...
                        } catch (dbErr) {
                            console.error('보험약 처방 내역 DB 저장 실패:', dbErr);
                        }
                        */
                    }
                }
            } catch (err) {
                console.error('보험약 차감 중 오류:', err);
            }
        }

        // 4. 보드에서 제거
        board.splice(idx, 1);
        writeData(TREATMENT_BOARD_FILE, board);

        // [추가] 커뮤니케이터 시스템 이벤트 기록
        const io = req.app.get('io');
        logSystemEvent(io, 'bed:exit', `${exitedPatient.bedNo}번 베드 퇴실: ${exitedPatient.patientName}`, {
            bedNo: exitedPatient.bedNo,
            patientName: exitedPatient.patientName,
            chartNo: exitedPatient.chartNo
        });

        // [추가] 실시간 동기화 알림
        if (io) io.emit('board:update');

        res.json({ success: true, message: '퇴실 처리 완료' });
    } catch (error) {
        console.error('Exit Error:', error);
        res.json({ success: false, message: error.message });
    }
});

// 치료 히스토리 조회 (DB)
router.get('/treatment-history', async (req, res) => {
    try {
        const { date } = req.query;
        let sql = 'SELECT * FROM treatment_history';
        const params = [];

        if (date) {
            sql += ' WHERE DATE(entryTime) = ?';
            params.push(date);
        } else {
            // Default limit to recent? Or just all (Migration might make it large)
            // Let's limit to 500 desc if no date specified
            sql += ' ORDER BY entryTime DESC LIMIT 500';
        }

        // If sorting needed
        if (date) sql += ' ORDER BY entryTime ASC';

        const [rows] = await pool.query(sql, params);

        // Parse JSON status if mysql2 doesn't auto-parse (it usually does for JSON columns)
        // If 'status' is a TEXT column storing JSON, we need manual parse.
        // In init_schema.js, 'status' is JSON. mysql2 should handle it as object.
        // If row.status is string, parse it.
        const result = rows.map(r => ({
            ...r,
            status: (typeof r.status === 'string') ? JSON.parse(r.status) : r.status
        }));

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('DB History Error:', error);
        res.json({ success: true, data: [] });
    }
});


// ===========================================
// AI 도구 API (Chart & Diagnosis)
// ===========================================

// 차트 정리 (Gemini AI)
router.post('/chart/organize', async (req, res) => {
    try {
        const { main, secondary } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.json({
                success: false,
                message: 'Gemini API Key가 설정되지 않았습니다. .env 파일에 GEMINI_API_KEY를 추가해주세요.'
            });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `당신은 숙련된 의료 서기(Medical Scribe) 입니다. 다음 환자의 증상을 바탕으로 한의원 진료 차트(SOAP 형식 중 Subjective 부분 중심)를 전문적인 의학 용어로 정리해주세요. 환자의 구어체 표현을 전문적인 임상 용어로 변환하고 증상을 체계적으로 나열하세요.\n\n[입력 증상]\n주증상: ${main}\n부증상: ${secondary}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ success: true, data: text });

    } catch (error) {
        console.error('Gemini API Error:', error);
        res.json({ success: false, message: 'AI 오류: ' + error.message });
    }
});

// 진단서 작성 (Gemini AI)
router.post('/chart/diagnosis', async (req, res) => {
    try {
        const { name, age, diagnosis, icd, onset, opinion } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.json({ success: false, message: 'Gemini API Key가 없습니다.' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `당신은 한의사입니다. 다음 정보를 바탕으로 '진단서(Medical Certificate)'에 들어갈 '향후 치료 소견(Clinical Opinion)'을 전문적이고 정중한 문체로 작성해주세요.\n\n[환자 정보]\n- 성명/나이: ${name || '환자'}(${age || '미상'})\n- 진단명: ${diagnosis} (상병코드: ${icd || '-'})\n- 발병일: ${onset || '-'}\n\n[치료진 소견 초안]\n"${opinion}"\n\n[작성 요청]\n위 초안을 바탕으로, 진단서의 '향후 치료 소견'에 들어갈 텍스트를 작성하세요.\n- 환자의 상태에 필요한 치료(침구치료, 약물치료, 안정 등)를 구체적이면서 법적/보험적으로 통용되는 형식적인 문구로 다듬어주세요.\n- 전체 진단서가 아닌, '소견' 텍스트 부분만 명확게 출력하세요.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ success: true, data: text });

    } catch (error) {
        console.error('Diagnosis API Error:', error);
        res.json({ success: false, message: 'AI 오류: ' + error.message });
    }
});

// 의학용어 변환 (Translate to Medical English)
router.post('/tools/medical-translate', async (req, res) => {
    try {
        const { text } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.json({ success: false, message: 'Gemini API Key가 없습니다.' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `당신은 의료 차트 전문가입니다. 사용자가 입력한 한국어 증상을 "의학 전문 영어 약어(Medical English Abbreviation)"로 변환해주세요.\n결과만 간결하게 쉼표(,)로 구분하여 나열해주세요. 설명이나 서술은 제외합니다.\n\n입력: 뒷목 뻣뻣함, 요통, 무릎 통증\n출력: nuchal rigidity, LBP, knee pain\n\n입력: 발목 염좌, 손목 통증\n출력: ankle sprain, wrist pain\n\n입력: ${text}\n출력:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const translatedText = response.text().trim();

        res.json({ success: true, data: translatedText });

    } catch (error) {
        console.error('Translation API Error:', error);
        res.json({ success: false, message: 'AI 오류: ' + error.message });
    }
});

// ===========================================
// 통계 API (환자 리텐션 및 코호트 분석) - DB Version
// ===========================================
// Note: This needs complex queries previously done in JS properly.
// For now, doing JS logic but fetching from DB.
router.get('/stats/retention', async (req, res) => {
    try {
        const { startDate, endDate, insuranceType, periodType } = req.query;

        // 기본값: 최근 3개월
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

        // 1. Fetch Data from DB
        const [patients] = await pool.query('SELECT id, name, chartNo, birthGender FROM patients');
        const [treatmentHistory] = await pool.query('SELECT patientId, entryTime FROM treatment_history');
        const [autoInsurancePatients] = await pool.query('SELECT patientId FROM auto_insurance_patients');

        // Logic remains same but using DB data arrays
        const autoInsurancePatientIds = new Set(
            autoInsurancePatients.map(p => p.patientId).filter(id => id)
        );

        const patientVisitCounts = {};
        const patientFirstVisitDate = {};

        treatmentHistory.forEach(visit => {
            const patientId = visit.patientId;
            if (!patientId) return;

            const visitDate = new Date(visit.entryTime);
            if (isNaN(visitDate.getTime())) return;

            if (!patientVisitCounts[patientId]) {
                patientVisitCounts[patientId] = 0;
                patientFirstVisitDate[patientId] = visitDate;
            }
            patientVisitCounts[patientId]++;

            if (visitDate < patientFirstVisitDate[patientId]) {
                patientFirstVisitDate[patientId] = visitDate;
            }
        });

        // ... Keep pure JS logic for cohorts as it's complex to port to SQL immediately ...
        // (Reusing original logic logic with new data sources)

        const newPatientsInPeriod = Object.entries(patientFirstVisitDate)
            .filter(([id, firstDate]) => {
                return firstDate >= start && firstDate <= end;
            })
            .map(([id, firstDate]) => ({
                id,
                firstVisitDate: firstDate,
                visitCount: patientVisitCounts[id] || 0,
                isAutoInsurance: autoInsurancePatientIds.has(parseInt(id))
            }));

        let filteredPatients = newPatientsInPeriod;
        if (insuranceType === 'health') {
            filteredPatients = newPatientsInPeriod.filter(p => !p.isAutoInsurance);
        } else if (insuranceType === 'auto') {
            filteredPatients = newPatientsInPeriod.filter(p => p.isAutoInsurance);
        }

        const totalNewPatients = filteredPatients.length;
        const visit2Count = filteredPatients.filter(p => p.visitCount >= 2).length;
        const visit3Count = filteredPatients.filter(p => p.visitCount >= 3).length;
        const visit1OnlyCount = filteredPatients.filter(p => p.visitCount === 1).length;
        const visit2OnlyCount = filteredPatients.filter(p => p.visitCount === 2).length;

        const visit2Rate = totalNewPatients > 0 ? Math.round((visit2Count / totalNewPatients) * 100) : 0;
        const visit3Rate = totalNewPatients > 0 ? Math.round((visit3Count / totalNewPatients) * 100) : 0;
        const dropoff1Rate = totalNewPatients > 0 ? Math.round((visit1OnlyCount / totalNewPatients) * 100) : 0;
        const dropoff2Rate = visit2Count > 0 ? Math.round((visit2OnlyCount / visit2Count) * 100) : 0;

        const healthPatients = newPatientsInPeriod.filter(p => !p.isAutoInsurance);
        const autoPatients = newPatientsInPeriod.filter(p => p.isAutoInsurance);

        const comparison = {
            health: {
                total: healthPatients.length,
                visit2Rate: healthPatients.length > 0 ? Math.round((healthPatients.filter(p => p.visitCount >= 2).length / healthPatients.length) * 100) : 0,
                visit3Rate: healthPatients.length > 0 ? Math.round((healthPatients.filter(p => p.visitCount >= 3).length / healthPatients.length) * 100) : 0
            },
            auto: {
                total: autoPatients.length,
                visit2Rate: autoPatients.length > 0 ? Math.round((autoPatients.filter(p => p.visitCount >= 2).length / autoPatients.length) * 100) : 0,
                visit3Rate: autoPatients.length > 0 ? Math.round((autoPatients.filter(p => p.visitCount >= 3).length / autoPatients.length) * 100) : 0
            }
        };

        const cohorts = {};
        const cohortPeriod = periodType === 'monthly' ? 'month' : 'week';

        filteredPatients.forEach(patient => {
            let cohortKey;
            const firstDate = patient.firstVisitDate;

            if (cohortPeriod === 'month') {
                cohortKey = firstDate.getFullYear() + '-' + String(firstDate.getMonth() + 1).padStart(2, '0');
            } else {
                const dayOfMonth = firstDate.getDate();
                const weekOfMonth = Math.ceil(dayOfMonth / 7);
                cohortKey = firstDate.getFullYear() + '-' + String(firstDate.getMonth() + 1).padStart(2, '0') + '-W' + weekOfMonth;
            }

            if (!cohorts[cohortKey]) {
                cohorts[cohortKey] = {
                    label: cohortKey,
                    total: 0,
                    visit1: 0,
                    visit2: 0,
                    visit3: 0,
                    visit4Plus: 0
                };
            }

            cohorts[cohortKey].total++;
            if (patient.visitCount === 1) cohorts[cohortKey].visit1++;
            else if (patient.visitCount === 2) cohorts[cohortKey].visit2++;
            else if (patient.visitCount === 3) cohorts[cohortKey].visit3++;
            else if (patient.visitCount >= 4) cohorts[cohortKey].visit4Plus++;
        });

        const sortedCohorts = Object.values(cohorts).sort((a, b) => a.label.localeCompare(b.label));

        const trends = sortedCohorts.map(c => ({
            label: c.label,
            visit2Rate: c.total > 0 ? Math.round(((c.visit2 + c.visit3 + c.visit4Plus) / c.total) * 100) : 0,
            visit3Rate: c.total > 0 ? Math.round(((c.visit3 + c.visit4Plus) / c.total) * 100) : 0
        }));

        const getPatientDetails = (patientList) => {
            return patientList.map(p => {
                const patientInfo = patients.find(pt => pt.id === parseInt(p.id));
                return {
                    id: p.id,
                    name: patientInfo?.name || '이름없음',
                    chartNo: patientInfo?.chartNo || '-',
                    birthGender: patientInfo?.birthGender || '-',
                    firstVisitDate: p.firstVisitDate.toISOString().split('T')[0],
                    visitCount: p.visitCount,
                    isAutoInsurance: p.isAutoInsurance
                };
            }).sort((a, b) => b.firstVisitDate.localeCompare(a.firstVisitDate));
        };

        const patientDetails = {
            total: getPatientDetails(filteredPatients),
            visit2Plus: getPatientDetails(filteredPatients.filter(p => p.visitCount >= 2)),
            visit3Plus: getPatientDetails(filteredPatients.filter(p => p.visitCount >= 3)),
            dropoff1: getPatientDetails(filteredPatients.filter(p => p.visitCount === 1)),
            dropoff2: getPatientDetails(filteredPatients.filter(p => p.visitCount === 2))
        };

        res.json({
            success: true,
            data: {
                summary: {
                    totalNewPatients,
                    visit2Rate,
                    visit3Rate,
                    dropoff1Rate,
                    dropoff2Rate
                },
                comparison,
                cohorts: sortedCohorts,
                trends,
                patientDetails,
                period: {
                    start: start.toISOString().split('T')[0],
                    end: end.toISOString().split('T')[0],
                    type: cohortPeriod
                }
            }
        });
    } catch (error) {
        console.error('Stats API Error:', error);
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
