const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const {
    DATA_DIR,
    readData,
    PATIENTS_FILE,
    BOOKINGS_FILE,
    SURVEYS_FILE,
    REVIEWS_FILE
} = require('../utils/fileStore');
const pool = require('../config/db');

// ===========================================
// Public APIs (Web Interface & Telemetry)
// ===========================================

// 1. Telemetry 이벤트 로깅
router.post('/public/analytics/event', (req, res) => {
    const eventData = req.body;
    const analyticsFile = path.join(DATA_DIR, 'analytics.json');

    try {
        let analytics = [];
        if (fs.existsSync(analyticsFile)) {
            analytics = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
        }

        // IP 및 서버 사이드 정보 추가
        const enrichedEvent = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            ...eventData
        };

        analytics.push(enrichedEvent);

        // 파일에 저장 (비동기로 처리하거나 주기적으로 저장하는 것이 좋으나, 트래픽이 적으므로 즉시 저장)
        fs.writeFileSync(analyticsFile, JSON.stringify(analytics, null, 2));

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics Error:', error);
        res.json({ success: false }); // 클라이언트에 에러 노출 방지
    }
});

// 2. 치료 후기 데이터 조회
router.get('/public/reviews', async (req, res) => {
    try {
        let surveys = [];
        if (fs.existsSync(SURVEYS_FILE)) {
            surveys = JSON.parse(fs.readFileSync(SURVEYS_FILE, 'utf8'));
        }

        // 1. Filter: Approved surveys with praise content
        const approvedReviews = surveys.filter(s => s.isApproved === true && s.praise && s.praise.trim() !== "");

        // 2. Fetch patient genders & ages from MariaDB
        const [patients] = await pool.query('SELECT name, birthGender FROM patients');
        const patientMap = {};
        patients.forEach(p => {
            if (p.name && !patientMap[p.name]) {
                patientMap[p.name] = p.birthGender;
            }
        });

        const currentYear = new Date().getFullYear();

        const formattedReviews = approvedReviews.map(s => {
            const rawName = s.name || s.patientName || "";
            let maskedName = "***";
            let gender = "익명";
            let ageGroup = "연령대비공개";

            if (rawName) {
                // 첫 글자만 남기고 '김**' 형태로 마킹
                maskedName = rawName[0] + "**";

                const birthGender = patientMap[rawName];
                if (birthGender && birthGender.length >= 7) {
                    const genderCode = birthGender.charAt(7);
                    const birthYearPrefix = (genderCode === '1' || genderCode === '2' || genderCode === '5' || genderCode === '6') ? 1900 : 2000;
                    const birthYear = birthYearPrefix + parseInt(birthGender.substring(0, 2));
                    const isMale = (genderCode === '1' || genderCode === '3' || genderCode === '5' || genderCode === '7');

                    gender = isMale ? "남" : "여";
                    const age = currentYear - birthYear;
                    ageGroup = Math.floor(age / 10) * 10 + "대";
                }
            }

            return {
                id: `survey_${s.id}`,
                tag: "", // 태그 분류 제거
                content: s.praise,
                author: `${maskedName}님`,
                gender,
                ageGroup,
                rating: 5 // 만족도 별은 모두 5개로 고정
            };
        });

        // 최신순으로 정렬 (id 기준 역순)
        formattedReviews.sort((a, b) => {
            const idA = parseInt(a.id.replace('survey_', ''));
            const idB = parseInt(b.id.replace('survey_', ''));
            return idB - idA;
        });

        res.json({ success: true, data: formattedReviews });
    } catch (error) {
        console.error('리뷰 조회 오류:', error);
        res.status(500).json({ success: false, message: '리뷰 조회 오류' });
    }
});

// 3. 간편 상담 신청
router.post('/public/leads', (req, res) => {
    try {
        const { name, phone, message, privacyAgreed } = req.body;

        if (!phone || !privacyAgreed) {
            return res.status(400).json({ success: false, message: '전화번호와 개인정보 동의는 필수입니다' });
        }

        const leadsFile = path.join(DATA_DIR, 'leads.json');
        let leads = [];

        if (fs.existsSync(leadsFile)) {
            leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
        }

        const newLead = {
            id: Date.now(),
            name: name || '익명',
            phone,
            message: message || '',
            date: new Date().toISOString(),
            status: 'NEW' // NEW, CONTACTED, DONE
        };

        leads.push(newLead);
        fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2), 'utf8');

        console.log("[Leads] 새로운 상담 신청: " + phone);
        res.json({ success: true, message: '상담 신청이 접수되었습니다.' });

    } catch (error) {
        console.error('상담 신청 접수 오류:', error);
        res.status(500).json({ success: false, message: '상담 신청 처리 중 오류가 발생했습니다.' });
    }
});

// 4. 홈페이지용 통계 데이터
router.get('/public/stats', (req, res) => {
    try {
        const patients = readData(PATIENTS_FILE);
        const YAKCHIM_FILE = path.join(DATA_DIR, 'yakchim-inventory.json');

        const yakchimInventory = readData(path.join(__dirname, '../data/yakchim-inventory.json'));

        // 보정치(Offset) 로직 추가
        let offsets = {
            totalPrescriptionsOffset: 0,
            totalPatientsOffset: 0,
            totalYakchimTreatmentsOffset: 0
        };

        try {
            const configPath = path.join(__dirname, '../data/stats-config.json');
            if (fs.existsSync(configPath)) {
                const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                offsets = { ...offsets, ...configData };
            }
        } catch (configErr) {
            console.error('통계 설정 로드 실패:', configErr);
        }

        const yakchimCount = yakchimInventory.reduce((acc, y) => {
            const usageCount = (y.usageHistory?.length || 0) + (y.usages?.length || 0);
            return acc + usageCount;
        }, 0);

        res.json({
            success: true,
            data: {
                totalPrescriptions: 0,
                totalPatients: patients.length + offsets.totalPatientsOffset,
                totalYakchimTreatments: yakchimCount + offsets.totalYakchimTreatmentsOffset
            }
        });
    } catch (error) {
        console.error('공식 홈페이지 통계 API 오류:', error);
        res.json({ success: false, message: error.message });
    }
});

// 5. 실시간 대기 환자 수 조회
router.get('/public/waiting', (req, res) => {
    try {
        if (fs.existsSync(BOOKINGS_FILE)) {
            const today = new Date().toISOString().split('T')[0];
            const bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));

            // 오늘 예약 중 '대기중' 상태인 환자 수 계산
            // (실제 로직: 예약어 "대기" 상태이거나, 아직 완료되지 않은 예약 등)
            // 여기서는 단순화를 위해 오늘 날짜의 예약 중 status가 'completed'나 'cancelled'가 아닌 것
            const waitingCount = bookings.filter(b =>
                b.date === today &&
                b.status !== 'completed' &&
                b.status !== 'cancelled' &&
                b.status !== 'no-show'
            ).length;

            res.json({ success: true, waitingCount });
        } else {
            res.json({ success: true, waitingCount: 0 });
        }
    } catch (error) {
        console.error('대기 인원 조회 중 오류:', error);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

module.exports = router;
