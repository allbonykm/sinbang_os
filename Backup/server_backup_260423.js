require('dotenv').config();

// Sinbang Clinic OS Server - Updated at 2026-04-22
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const naverSens = require('./api/naver-sens');
const cron = require('node-cron');
const backupHelper = require('./utils/backupHelper');
// Prisma Client check
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDatabaseConnection() {
    try {
        await prisma.$connect();
        console.log('✅ MariaDB (Prisma) 연결 성공');
    } catch (error) {
        console.error('❌ MariaDB (Prisma) 연결 실패:', error.message);
    }
}
checkDatabaseConnection();

const PORT = process.env.PORT || 3009;

// Socket.io 인스턴스를 app에 저장 (라우터에서 접근용)
app.set('io', io);

// 1. Run Backup on Server Start
(async () => {
    await backupHelper.createBackup('auto-startup');
})();

// 2. Schedule Daily Backup at 02:00 AM & Server Backup at 21:00
cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Running daily backup (JSON + MariaDB)...');
    await backupHelper.createBackup('daily');
    backupHelper.cleanOldBackups(7);
});

// Server File Backup (Daily 21:00)
cron.schedule('0 21 * * *', () => {
    console.log('[Cron] Running daily server.js backup...');
    backupHelper.backupServerFile();
});

// Run initial cleanup (Retain for 7 days)
backupHelper.cleanOldBackups(7);



// 5. 서버 가동 상태 로깅 (매 1시간)
cron.schedule('0 * * * *', () => {
    console.log(`[Cron] Server heartbeat: ${new Date().toLocaleString()}`);
});


// 기본 설정
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 로깅 미들웨어 추가 (접속 디버깅용)
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] Request: ${req.method} ${req.url} from ${req.ip}`);
    next();
});

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/data', express.static('data'));
app.use('/guide', express.static(path.join(__dirname, 'guide')));
app.use('/guarantee-images', express.static(path.join(__dirname, 'shared/guarantee')));

// 데이터 파일 유틸리티 로드
const {
    DATA_DIR, readData, writeData, initializeData,
    PATIENTS_FILE, NON_REIMBURSEMENTS_FILE, BOOKINGS_FILE, HERBS_FILE, HERB_ORIGINS_FILE,
    HERB_INBOUND_LOG_FILE, PRESCRIPTIONS_FILE, PURCHASES_FILE, PRESET_PRESCRIPTIONS_FILE,
    AUTO_INSURANCE_FILE, EMPLOYEES_FILE, SALARIES_FILE, PAYSLIP_HISTORY_FILE,
    ROUTINES_FILE, MONTHLY_ROUTINES_FILE, COMPUTER_ACCESS_FILE, ALLTALK_TEMPLATES_FILE,
    MESSAGE_HISTORY_FILE, RENT_MANAGEMENT_FILE, TREATMENT_HISTORY_FILE,
    MEDICAL_WASTE_FILE, INBOUND_HISTORY_FILE, OUTBOUND_HISTORY_FILE, CONSULTATIONS_FILE,
    TEST_RESULTS_FILE, D3TALK_RESPONSES_FILE
} = require('./utils/fileStore');

// 데이터 초기화 실행
initializeData();

// [백업] 주요 데이터 파일 백업 (서버 시작 시 실행)
// Refactored to use utils/backupHelper.js
backupHelper.backupSpecificFiles([
    'test-results.json',
    'patients.json',
    'bookings.json',
    'yakchim-inventory.json'
]);

// Naver SENS API 연결 완료 여부 확인 (환경 변수 존재 여부 기반)
if (process.env.NCP_ACCESS_KEY && process.env.ALIMTALK_SERVICE_ID) {
    console.log('✅ Naver SENS API 모듈 로드 완료');
} else {
    console.warn('⚠️ Naver SENS API 설정 불완전 - .env 파일을 확인하세요');
}
// All-Talk Engine
const allTalkEngine = require('./api/alltalk-engine');
// Cron Agent & Scheduler
require('./utils/cron-agent');
const Scheduler = require('./services/scheduler');
Scheduler.init(io);

// 데이터 파일 경로 객체 (엔진 전달용)
const FILE_PATHS = {
    PATIENTS_FILE,
    PRESCRIPTIONS_FILE,
    ALLTALK_TEMPLATES_FILE,
    MESSAGE_HISTORY_FILE,
    patients: PATIENTS_FILE,
    prescriptions: PRESCRIPTIONS_FILE,
    messageHistory: MESSAGE_HISTORY_FILE
};

// 엔진 초기화
allTalkEngine.init(DATA_DIR, FILE_PATHS);
console.log('✅ 데이터 파일 초기화 완료');

// 데이터 폴더 정적 서비스 (가용 JSON 등)
app.use('/data', express.static(path.join(__dirname, 'data')));


// ===========================================
// 핵심 리소스 관리 API
// ===========================================
app.use('/api/naver-sync', require('./routes/naverSync'));
app.use('/api', require('./routes/patients'));
app.use('/api', require('./routes/bookings'));
app.use('/api', require('./routes/treatments'));
app.use('/api', require('./routes/alimtalk')); // Unified AlimTalk & Messages
app.use('/api', require('./routes/consultations'));

app.use('/api', require('./routes/visitAnalysis'));
app.use('/api', require('./routes/visitCalendar'));


// ===========================================
// 설정 및 템플릿 관리 API (Settings)
// ===========================================
app.use('/api/settings', require('./routes/settings'));

// ===========================================
// 오늘 내원 환자 관리 API (Today Visits)
// ===========================================
app.use('/api', require('./routes/todayVisits'));

// ===========================================
// Public/Analytics API (라우터 분리됨)
// ===========================================
app.use('/api', require('./routes/public'));

// ===========================================
// 대시보드 API (public stats 포함)
// ===========================================
app.use('/api', require('./routes/dashboard'));

// ===========================================
// 컴퓨터 접근 제어 API
// ===========================================
app.use('/api', require('./routes/computerAccess'));

// ===========================================
// 메신저 연동 (Naver Talk, Kakao)
// ===========================================
app.use('/api/agent/alimtalk', require('./routes/agentAlimtalk')); // [New] Template Sync & Post-Treatment Agent


// ===========================================
// 주소 검색 API (vWorld)
// ===========================================
app.use('/api', require('./routes/address'));

// ===========================================
// 시스템 설정 API (API 키, 템플릿 등)
// ===========================================
// app.use('/api/settings', require('./routes/settings')); // 중복 제거됨

// ===========================================
// 환자 메모 API (라우터 분리됨)
// ===========================================
app.use('/api', require('./routes/nonReimbursement'));
app.use('/api', require('./routes/patientMemos'));

// API 404 Handler (JSON 응답 보장)
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, message: `API 경로를 찾을 수 없습니다: ${req.originalUrl}` });
});


// Socket.io 이벤트 핸들러 (Communicator)
// ===========================================
io.on('connection', (socket) => {
    console.log(`[Socket.io] 클라이언트 연결: ${socket.id}`);

    // 커뮤니케이터 룸 참여
    socket.on('join:communicator', (deviceId) => {
        socket.join('communicator');
        socket.join(`device:${deviceId}`); // 개별 기기 룸 참여 (프라이빗 알림용)
        socket.deviceId = deviceId;
        console.log(`[Socket.io] ${deviceId}가 communicator 및 device:${deviceId} 룸에 참여`);
    });

    // 1:1 채팅방 참여
    socket.on('join:room', (roomId) => {
        socket.join(roomId);
        console.log(`[Socket.io] ${socket.deviceId}가 ${roomId} 룸에 참여`);
    });

    // 타이핑 중 표시
    socket.on('typing', (data) => {
        socket.to(data.room || 'communicator').emit('user:typing', {
            deviceId: socket.deviceId,
            isTyping: data.isTyping
        });
    });

    // 연결 해제
    socket.on('disconnect', () => {
        console.log(`[Socket.io] 클라이언트 연결 해제: ${socket.id}`);
    });
});


http.listen(PORT, '0.0.0.0', () => {
    console.log('\n' +
        '╔═══════════════════════════════════════════╗\n' +
        '║   🏥 신방한의원 OS 서버 시작           ║\n' +
        '║                                           ║\n' +
        '║   URL: http://localhost:' + PORT + '             ║\n' +
        '║   상태: 실행 중 (MariaDB 기반)           ║\n' +
        '╚═══════════════════════════════════════════╝\n');
});
// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await prisma.$disconnect();
    http.close(() => {
        console.log('HTTP server closed');
    });
});
