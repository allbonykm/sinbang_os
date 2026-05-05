/**
 * 알림톡 이벤트 및 템플릿 매핑 관리 모듈
 * 모든 알림톡 템플릿 코드를 중앙에서 관리하여 하드코딩을 방지함.
 */

const ALIMTALK_EVENTS = {
    // 1. 진료후 안내 (대시보드)
    POST_TREATMENT_NORMAL: 'Treatpost04',
    POST_TREATMENT_BOOKING: 'booking02',

    // 2. 장기 미내원 (장기미내원 관리)
    LONG_TERM_CARE: 'care15',

    // 3. 패키지/시술 관리 (시술권 관리)
    PACKAGE_CARE_3: 'PKGcare3',

    // 4. 길안내/지도 (환자 상세)
    MAP_GUIDE: 'map',


    // 6. 탕전 및 배송 (탕전 스케줄)
    BREWING_SELF: 'decoctionSelf4',         // 방문수령
    BREWING_DELIVERY: 'decoctionDeli3',    // 택배
    BREWING_DIRECT: 'decoctionSeDeli',     // 직접배송
    ONLY_DELIVERY: 'OnlyDelivery',          // 비급여 택배 안내

    // 7. 예약 안내
    FIRST_BOOKING: 'FirstBooking',         // 예약 즉시 발송
    D0_BOOKING: 'D0Booking'                // 예약 당일 오전 8:30 발송
};

/**
 * 이벤트 타입에 해당하는 템플릿 코드를 반환
 * @param {string} eventType 
 * @returns {string|null}
 */
function getTemplateCodeByEvent(eventType) {
    return ALIMTALK_EVENTS[eventType] || null;
}

/**
 * 현재 지원되는 모든 이벤트 목록 반환 (디버깅용)
 */
function getAllEvents() {
    return ALIMTALK_EVENTS;
}

module.exports = {
    ALIMTALK_EVENTS,
    getTemplateCodeByEvent,
    getAllEvents
};

