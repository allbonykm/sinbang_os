const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// 데이터 디렉토리 생성
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const FILE_PATHS = {
    PATIENTS_FILE: path.join(DATA_DIR, 'patients.json'),
    BOOKINGS_FILE: path.join(DATA_DIR, 'bookings.json'),
    HERBS_FILE: path.join(DATA_DIR, 'herbs.json'),
    HERB_SUPPLIERS_FILE: path.join(DATA_DIR, 'herb-suppliers.json'),
    HERB_ORIGINS_FILE: path.join(DATA_DIR, 'herb-origins.json'),
    HERB_INBOUND_LOG_FILE: path.join(DATA_DIR, 'herb-inbound-log.json'),
    PRESCRIPTIONS_FILE: path.join(DATA_DIR, 'prescriptions.json'),
    PURCHASES_FILE: path.join(DATA_DIR, 'purchases.json'),
    PRESET_PRESCRIPTIONS_FILE: path.join(DATA_DIR, 'preset-prescriptions.json'),
    AUTO_INSURANCE_FILE: path.join(DATA_DIR, 'auto-insurance-patients.json'),
    EMPLOYEES_FILE: path.join(DATA_DIR, 'employees.json'),
    SALARIES_FILE: path.join(DATA_DIR, 'salaries.json'),
    PAYSLIP_HISTORY_FILE: path.join(DATA_DIR, 'payslip-history.json'),
    ROUTINES_FILE: path.join(DATA_DIR, 'routines.json'),
    MONTHLY_ROUTINES_FILE: path.join(DATA_DIR, 'monthly-routines.json'),
    COMPUTER_ACCESS_FILE: path.join(DATA_DIR, 'computer-access.json'),
    ALLTALK_TEMPLATES_FILE: path.join(DATA_DIR, 'alltalk-templates.json'),
    BOOKING_CONFIG_FILE: path.join(DATA_DIR, 'booking-config.json'),
    MESSAGE_HISTORY_FILE: path.join(DATA_DIR, 'message_history.json'),
    RENT_MANAGEMENT_FILE: path.join(DATA_DIR, 'rent-management.json'),
    TREATMENT_HISTORY_FILE: path.join(DATA_DIR, 'treatment-history.json'),
    MEDICAL_WASTE_FILE: path.join(DATA_DIR, 'medical-waste.json'),
    INBOUND_HISTORY_FILE: path.join(DATA_DIR, 'inventory-inbound.json'),
    OUTBOUND_HISTORY_FILE: path.join(DATA_DIR, 'inventory-outbound.json'),
    CONSULTATIONS_FILE: path.join(DATA_DIR, 'consultations.json'),
    ANALYTICS_FILE: path.join(DATA_DIR, 'analytics.json'),
    YAKCHIM_INVENTORY_FILE: path.join(DATA_DIR, 'yakchim-inventory.json'),
    TEST_RESULTS_FILE: path.join(DATA_DIR, 'test-results.json'),
    REVIEWS_FILE: path.join(DATA_DIR, 'naver-reviews.json'),
    TODAY_VISITS_FILE: path.join(DATA_DIR, 'today-visits.json'),
    INSURANCE_FILE: path.join(DATA_DIR, 'insurance.json'),
    DIRECTOR_MONTHLY_ROUTINES_FILE: path.join(DATA_DIR, 'director-monthly-routines.json'),
    INCOME_FILE: path.join(DATA_DIR, 'income.json'),
    CARD_SALES_FILE: path.join(DATA_DIR, 'card-sales.json'),
    D3TALK_RESPONSES_FILE: path.join(DATA_DIR, 'd3talk-responses.json'),
    CONFIG_FILE: path.join(DATA_DIR, 'config.json')
};

function readData(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return [];
    }
}

function writeData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function initializeData() {
    const filesToCheck = [
        FILE_PATHS.PATIENTS_FILE,
        FILE_PATHS.CONSULTATIONS_FILE,
        FILE_PATHS.BOOKINGS_FILE,
        FILE_PATHS.HERBS_FILE,
        FILE_PATHS.PRESCRIPTIONS_FILE,
        FILE_PATHS.PURCHASES_FILE,
        FILE_PATHS.PRESET_PRESCRIPTIONS_FILE,
        FILE_PATHS.AUTO_INSURANCE_FILE,
        FILE_PATHS.EMPLOYEES_FILE,
        FILE_PATHS.SALARIES_FILE,
        FILE_PATHS.PAYSLIP_HISTORY_FILE,
        FILE_PATHS.ALLTALK_TEMPLATES_FILE,
        FILE_PATHS.BOOKING_CONFIG_FILE,
        FILE_PATHS.RENT_MANAGEMENT_FILE,
        FILE_PATHS.MEDICAL_WASTE_FILE,
        FILE_PATHS.INBOUND_HISTORY_FILE,
        FILE_PATHS.OUTBOUND_HISTORY_FILE,
        FILE_PATHS.D3TALK_RESPONSES_FILE
    ];

    filesToCheck.forEach(file => {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify([], null, 2));
        }
    });

    if (!fs.existsSync(FILE_PATHS.MONTHLY_ROUTINES_FILE)) {
        fs.writeFileSync(FILE_PATHS.MONTHLY_ROUTINES_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(FILE_PATHS.CONFIG_FILE)) {
        fs.writeFileSync(FILE_PATHS.CONFIG_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(FILE_PATHS.ROUTINES_FILE)) {
        // 기본 루틴 업무 초기화
        const defaultRoutines = [
            { id: 1, name: "의료폐기물", color: "#ef4444" },
            { id: 2, name: "접수실 쿠션세탁", color: "#f97316" },
            { id: 3, name: "침구청소기", color: "#f59e0b" },
            { id: 4, name: "대청소", color: "#10b981" },
            { id: 5, name: "전침선 청소", color: "#06b6d4" },
            { id: 6, name: "베개 소독", color: "#3b82f6" },
            { id: 7, name: "베드 커버 교체", color: "#6366f1" },
            { id: 8, name: "받침대 세탁", color: "#8b5cf6" },
            { id: 9, name: "슬리퍼 세탁", color: "#d946ef" }
        ];
        fs.writeFileSync(FILE_PATHS.ROUTINES_FILE, JSON.stringify(defaultRoutines, null, 2));
    }
}

module.exports = {
    DATA_DIR,
    readData,
    writeData,
    initializeData,
    ...FILE_PATHS
};
