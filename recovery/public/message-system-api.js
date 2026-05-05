// ========================================
// 신방한의원 메시지 시스템 - REST API 버전
// ========================================

// API Base URL
const API_BASE = '';  // 같은 도메인에서 작동

// 전역 변수
let currentTab = 'messaging';
let patientListCache = [];
let allPatients = [];
let selectedPatient = null;
let selectedBookingPatient = null;
let allHistoryCache = [];

// 전화번호 자동 포맷팅 (010-1234-5678)
function formatPhoneNumber(input) {
    let value = input.value.replace(/[^0-9]/g, ''); // 숫자만 추출

    if (value.length > 11) {
        value = value.slice(0, 11);
    }

    if (value.length > 7) {
        input.value = value.slice(0, 3) + '-' + value.slice(3, 7) + '-' + value.slice(7);
    } else if (value.length > 3) {
        input.value = value.slice(0, 3) + '-' + value.slice(3);
    } else {
        input.value = value;
    }
}

// ========================================
// 커스텀 모달
// ========================================
function showModal(message, type = 'success') {
    const existingModal = document.getElementById('custom-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'custom-modal';
    modal.className = 'modal-overlay';

    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    const color = type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3';

    modal.innerHTML = `
    <div class="modal-content" style="border-top: 4px solid ${color};">
      <div class="modal-icon" style="color: ${color};">${icon}</div>
      <div class="modal-message">${message}</div>
      <button class="modal-button" style="background: ${color};" onclick="closeModal()">확인</button>
    </div>
  `;

    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 10);
}

function closeModal() {
    const modal = document.getElementById('custom-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// ESC키로 닫기
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ========================================
// 탭 전환
// ========================================
function switchTab(tabName) {
    currentTab = tabName;

    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');

    loadTabContent(tabName);
}

function loadTabContent(tabName) {
    const content = document.getElementById('content');

    switch (tabName) {
        case 'patients':
            content.innerHTML = getPatientsTabHTML();
            loadPatientList();
            break;
        case 'messaging':
            content.innerHTML = getMessagingTabHTML();
            loadPatientDropdown();
            loadSendingHistory(); // 3분할 레이아웃에서 내역도 함께 로드
            break;
        case 'booking':
            content.innerHTML = getBookingTabHTML();
            loadBookingList();
            break;
        case 'history':
            content.innerHTML = getHistoryTabHTML();
            loadSendingHistory();
            break;
    }
}

// ========================================
// 환자 관리 탭
// ========================================
function getPatientsTabHTML() {
    return `
    <div class="form-section">
      <h2 class="section-title">새 환자 등록</h2>
      <div class="form-group">
        <label>환자명</label>
        <input type="text" id="patient-name" placeholder="홍길동">
      </div>
      <div class="form-group">
        <label>차트번호</label>
        <input type="text" id="patient-chart" placeholder="12345">
      </div>
      <div class="form-group">
        <label>전화번호</label>
        <input type="text" id="patient-phone" placeholder="010-1234-5678" oninput="formatPhoneNumber(this)" maxlength="13">
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="addPatient()">환자 추가</button>
        <button class="btn btn-secondary" onclick="clearPatientForm()">초기화</button>
      </div>
    </div>
    
    <div class="form-section">
      <h2 class="section-title">환자 목록</h2>
      <div class="form-group">
        <input type="text" id="patient-search" placeholder="이름, 차트번호, 전화번호로 검색..." 
               onkeyup="searchPatients()">
      </div>
      <div id="patient-list" class="loading">환자 목록 불러오는 중...</div>
    </div>
  `;
}

async function addPatient() {
    const name = document.getElementById('patient-name').value.trim();
    const chartNo = document.getElementById('patient-chart').value.trim();
    const phone = document.getElementById('patient-phone').value.trim();

    if (!name || !chartNo || !phone) {
        alert('모든 항목을 입력해주세요');
        return;
    }

    document.getElementById('patient-list').innerHTML = '<div class="loading">환자 추가 중...</div>';

    try {
        const response = await fetch(`${API_BASE}/api/patients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, chartNo, phone })
        });

        const result = await response.json();

        if (result.success) {
            showModal('환자가 추가되었습니다', 'success');
            clearPatientForm();
            loadPatientList();
        } else {
            showModal('환자 추가 실패: ' + result.message, 'error');
        }
    } catch (error) {
        showModal('네트워크 오류: ' + error.message, 'error');
    }
}

function clearPatientForm() {
    document.getElementById('patient-name').value = '';
    document.getElementById('patient-chart').value = '';
    document.getElementById('patient-phone').value = '';
}

async function loadPatientList() {
    try {
        const response = await fetch(`${API_BASE}/api/patients`);
        const result = await response.json();

        if (result.success) {
            displayPatientList(result.data);
        }
    } catch (error) {
        document.getElementById('patient-list').innerHTML =
            '<p style="text-align:center;color:#f44336;padding:40px;">환자 목록 로드 실패</p>';
    }
}

function displayPatientList(patients) {
    patientListCache = patients;
    const listDiv = document.getElementById('patient-list');

    if (!listDiv) return;

    if (!patients || patients.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">등록된 환자가 없습니다</p>';
        return;
    }

    let html = '<table><thead><tr><th>이름</th><th>차트번호</th><th>전화번호</th></tr></thead><tbody>';
    patients.forEach(p => {
        html += `<tr>
      <td>${p.name}</td>
      <td>${p.chartNo}</td>
      <td>${p.phone}</td>
    </tr>`;
    });
    html += '</tbody></table>';

    listDiv.innerHTML = html;
}

async function searchPatients() {
    const query = document.getElementById('patient-search').value;

    if (!query.trim()) {
        loadPatientList();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/patients/search?q=${encodeURIComponent(query)}`);
        const result = await response.json();

        if (result.success) {
            displayPatientList(result.data);
        }
    } catch (error) {
        console.error('검색 실패:', error);
    }
}

// ========================================
// 메시지 발송 탭
// ========================================
function getMessagingTabHTML() {
    return `
    <div class="split-layout" style="display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 15px; height: calc(100vh - 50px);">
        <!-- Column 1: SMS 단건 발송 (컴팩트) -->
        <div class="split-col" style="display: flex; flex-direction: column; overflow: hidden;">
            <div class="form-section" style="flex: 1; overflow-y: auto; padding: 15px;">
                <h2 class="section-title" style="margin-bottom: 12px; font-size: 1rem;">📱 SMS 단건 발송</h2>
                
                <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                    <div style="flex: 1; position: relative;">
                        <input type="text" id="patient-search-input" 
                               placeholder="이름, 차트번호로 검색..." 
                               onkeyup="filterPatients()" 
                               onfocus="showPatientDropdown()"
                               style="width: 100%; padding: 8px 10px; font-size: 13px;">
                        <div id="patient-dropdown" class="patient-dropdown" style="display: none;"></div>
                    </div>
                </div>
                
                <div style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
                    <span style="font-size: 12px; color: #666; white-space: nowrap;">전화번호</span>
                    <input type="text" id="sms-phone" placeholder="010-1234-5678" readonly
                           style="flex: 1; padding: 8px 10px; font-size: 13px; background: #f3f4f6;">
                </div>
                
                <div style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
                    <span style="font-size: 12px; color: #666; white-space: nowrap;">템플릿</span>
                    <select id="sms-template" onchange="applyTemplate()"
                            style="flex: 1; padding: 8px 10px; font-size: 13px;">
                        <option value="">직접 입력</option>
                        <option value="survey">진료만족도 설문</option>
                    </select>
                </div>
                
                <div style="margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="font-size: 12px; color: #666;">메시지 내용</span>
                        <span id="byte-counter" style="font-size: 11px; color: #999;">0 / 90 byte</span>
                    </div>
                    <textarea id="sms-message" placeholder="메시지를 입력하세요" oninput="updateByteCounter()" 
                              style="width: 100%; min-height: 100px; padding: 8px 10px; font-size: 13px; resize: vertical;"></textarea>
                </div>
                
                <button class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px;" onclick="sendSMS()">SMS 발송</button>
            </div>
        </div>
        
        <!-- Column 2: 알림톡 일괄 발송 (컴팩트) -->
        <div class="split-col" style="display: flex; flex-direction: column; overflow: hidden;">
            <div class="form-section" style="flex: 1; overflow-y: auto; padding: 15px;">
                <h2 class="section-title" style="margin-bottom: 12px; font-size: 1rem;">💬 알림톡 일괄 발송</h2>
                
                <div style="margin-bottom: 8px;">
                    <input type="text" id="alimtalk-search" placeholder="이름, 차트번호로 검색..." onkeyup="filterAlimtalkList()"
                           style="width: 100%; padding: 8px 10px; font-size: 13px;">
                </div>
                
                <div style="margin-bottom: 8px;">
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">선택된 환자</div>
                    <div id="selected-alimtalk-list" class="selected-patients-area" style="min-height: 40px; max-height: 60px; overflow-y: auto; padding: 6px; font-size: 12px;">
                        <span style="color:#999;">선택된 환자가 없습니다</span>
                    </div>
                </div>

                <div id="alimtalk-patient-list" class="checkbox-list" style="height: calc(100% - 200px); min-height: 150px; font-size: 13px;">
                    <div class="loading">환자 목록 불러오는 중...</div>
                </div>
                
                <button class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px; margin-top: 10px;" onclick="sendBulkAlimTalk()">선택한 환자에게 알림톡 발송</button>
            </div>
        </div>
        
        <!-- Column 3: 발송 내역 (2배 너비) -->
        <div class="split-col" style="display: flex; flex-direction: column; overflow: hidden;">
            <div class="form-section" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; margin-bottom: 0; padding: 15px;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <h2 class="section-title" style="margin: 0; font-size: 1rem;">📋 발송 내역</h2>
                    <button onclick="syncMessageHistory()" style="padding: 4px 12px; font-size: 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;" title="예약 문자 내역 동기화">🔄 동기화</button>
                </div>
                <div style="display: flex; gap: 8px; flex-shrink: 0; margin-bottom: 8px;">
                    <select id="history-type-filter" onchange="filterHistory()" style="width: 80px; padding: 6px; font-size: 13px;">
                        <option value="">전체</option>
                        <option value="SMS">SMS</option>
                        <option value="LMS">LMS</option>
                        <option value="알림톡">알림톡</option>
                        <option value="D3톡">D3톡</option>
                        <option value="예약(D-1)">D-1</option>
                        <option value="예약(당일)">당일</option>
                    </select>
                    <input type="text" id="history-search" placeholder="검색..." onkeyup="filterHistory()" style="flex: 1; padding: 6px 10px; font-size: 13px;">
                </div>
                <div id="history-list" style="flex: 1; overflow-y: auto;">발송 내역 불러오는 중...</div>
            </div>
        </div>
    </div>
  `;
}

async function loadPatientDropdown() {
    try {
        const response = await fetch(`${API_BASE}/api/patients`);
        const result = await response.json();

        if (result.success) {
            allPatients = result.data;
            populateAlimtalkCheckboxes(result.data);
        }
    } catch (error) {
        console.error('환자 목록 로드 실패:', error);
    }
}

function showPatientDropdown() {
    filterPatients();
}

function filterPatients() {
    const searchInput = document.getElementById('patient-search-input');
    const dropdown = document.getElementById('patient-dropdown');

    if (!searchInput || !dropdown) return;

    const query = searchInput.value.toLowerCase().trim();

    if (query === '') {
        dropdown.style.display = 'none';
        return;
    }

    const filtered = allPatients.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.chartNo.toString().includes(query) ||
        p.phone.includes(query)
    );

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 10px; color: #999;">검색 결과가 없습니다</div>';
        dropdown.style.display = 'block';
        return;
    }

    let html = '';
    filtered.forEach(p => {
        html += `<div class="patient-dropdown-item" onclick='selectPatient(${JSON.stringify(p)})'>
              <div style="font-weight: bold;">${p.name} (${p.chartNo})</div>
              <div style="color: #666; font-size: 0.9rem;">${p.phone}</div>
          </div>`;
    });

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}

function selectPatient(patient) {
    selectedPatient = patient;
    document.getElementById('patient-search-input').value = `${patient.name} (${patient.chartNo})`;
    document.getElementById('sms-phone').value = patient.phone;
    document.getElementById('patient-dropdown').style.display = 'none';
}

// 드롭다운 외부 클릭 시 닫기
document.addEventListener('click', function (e) {
    const searchInput = document.getElementById('patient-search-input');
    const dropdown = document.getElementById('patient-dropdown');
    if (searchInput && dropdown && !searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

function populateAlimtalkCheckboxes(patients) {
    const listDiv = document.getElementById('alimtalk-patient-list');

    if (!patients || patients.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">등록된 환자가 없습니다</p>';
        return;
    }

    let html = '';
    patients.forEach(p => {
        const patientData = JSON.stringify({ name: p.name, chartNo: p.chartNo, phone: p.phone }).replace(/"/g, '&quot;');
        html += `
            <div class="checkbox-item" data-name="${p.name}" data-chart="${p.chartNo}" data-phone="${p.phone}" style="padding: 4px 6px; font-size: 11px;">
                <label style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                    <input type="checkbox" data-patient="${patientData}" onchange="updateSelectedAlimtalkList()" style="width: 14px; height: 14px; flex-shrink: 0;">
                    <span style="overflow: hidden; text-overflow: ellipsis;">${p.name} (${p.chartNo}) - ${p.phone}</span>
                </label>
            </div>
        `;
    });

    listDiv.innerHTML = html;
}

function updateSelectedAlimtalkList() {
    const checkboxes = document.querySelectorAll('#alimtalk-patient-list input[type="checkbox"]:checked');
    const selectedContainer = document.getElementById('selected-alimtalk-list');

    if (checkboxes.length === 0) {
        selectedContainer.innerHTML = '<span style="color:#999; font-size:0.9rem; padding: 4px;">선택된 환자가 없습니다</span>';
        return;
    }

    let html = '';
    checkboxes.forEach((cb, index) => {
        const patient = JSON.parse(cb.getAttribute('data-patient').replace(/&quot;/g, '"'));
        html += `
            <div class="patient-tag">
                ${patient.name} (${patient.chartNo})
                <span class="remove-btn" onclick="removeAlimtalkSelection('${patient.chartNo}')">&times;</span>
            </div>
        `;
    });

    selectedContainer.innerHTML = html;
}

function removeAlimtalkSelection(chartNo) {
    const checkboxes = document.querySelectorAll('#alimtalk-patient-list input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const patient = JSON.parse(cb.getAttribute('data-patient').replace(/&quot;/g, '"'));
        if (String(patient.chartNo) === String(chartNo)) {
            cb.checked = false;
        }
    });
    updateSelectedAlimtalkList();
}

function filterAlimtalkList() {
    const searchInput = document.getElementById('alimtalk-search');
    const query = searchInput.value.toLowerCase().trim();
    const checkboxItems = document.querySelectorAll('#alimtalk-patient-list .checkbox-item');

    checkboxItems.forEach(item => {
        const name = item.getAttribute('data-name').toLowerCase();
        const chart = item.getAttribute('data-chart');
        const phone = item.getAttribute('data-phone');

        if (query === '' ||
            name.includes(query) ||
            chart.includes(query) ||
            phone.includes(query)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

// 템플릿 적용
function applyTemplate() {
    const select = document.getElementById('sms-template');
    const textarea = document.getElementById('sms-message');

    if (select.value === 'survey') {
        textarea.value = '신방한의원 진료만족도 설문 참여시 커피쿠폰 드려요! \n\nhttps://forms.gle/YBBTt3MK97cp3x1t6';
    } else {
        textarea.value = '';
    }
    updateByteCounter();
}

// 바이트 카운터 업데이트
function updateByteCounter() {
    const textarea = document.getElementById('sms-message');
    const counter = document.getElementById('byte-counter');
    if (!textarea || !counter) return;

    const text = textarea.value;
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code <= 127) {
            bytes += 1;
        } else {
            bytes += 2;
        }
    }

    counter.textContent = bytes + ' / 90 byte';

    if (bytes > 90) {
        counter.style.color = '#f44336';
        counter.style.fontWeight = 'bold';
    } else {
        counter.style.color = '#666';
        counter.style.fontWeight = 'normal';
    }
}

async function sendSMS() {
    const phone = document.getElementById('sms-phone').value.trim();
    const message = document.getElementById('sms-message').value.trim();

    if (!phone || !message) {
        alert('전화번호와 메시지를 입력하세요');
        return;
    }

    if (!confirm(`${phone}로 SMS를 발송하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch('/api/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: phone,
                message: message,
                patientName: selectedPatient.name,
                chartNo: selectedPatient.chartNo
            })
        });

        const result = await response.json();

        if (result.success) {
            showModal('✅ SMS 발송 완료!', 'success');
            document.getElementById('sms-message').value = '';
            updateByteCounter();
        } else {
            showModal('❌ 발송 실패: ' + (result.error || result.message), 'error');
        }
    } catch (error) {
        showModal('❌ 에러: ' + error.message, 'error');
    }
}

async function sendBulkAlimTalk() {
    const checkboxes = document.querySelectorAll('#alimtalk-patient-list input[type="checkbox"]:checked');

    if (checkboxes.length === 0) {
        alert('발송할 환자를 선택하세요');
        return;
    }

    const patientDataArray = Array.from(checkboxes).map(cb => {
        return JSON.parse(cb.getAttribute('data-patient'));
    });

    if (!confirm(`${patientDataArray.length}명에게 알림톡을 발송하시겠습니까?`)) {
        return;
    }

    const failoverMessage = `[신방한의원]
${'${'}name}님,
오늘 신방한의원을 방문해 주셔서 감사합니다.

오늘 안내드린 내용을 참고하시어
꾸준히 관리하시면 좋은 결과가 있으실 거예요.

빠른 쾌유를 기원합니다.

- 신방한의원 드림`;

    try {
        const response = await fetch('/api/send-alimtalk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                patients: patientDataArray,
                failoverMessage: failoverMessage
            })
        });

        const result = await response.json();

        if (result.success) {
            showModal(`✅ 발송 완료!
${result.summary}`, 'success');

            checkboxes.forEach(cb => cb.checked = false);
        } else {
            showModal('❌ 발송 실패: ' + (result.error || result.message), 'error');
        }
    } catch (error) {
        showModal('❌ 에러: ' + error.message, 'error');
    }
}

// ========================================
// 예약 관리 탭
// ========================================
function getBookingTabHTML() {
    return `
    <div class="form-section">
      <h2 class="section-title">새 예약 등록</h2>
      <div class="form-group">
        <label>환자 검색</label>
        <div style="position: relative;">
          <input type="text" id="booking-patient-search" 
                 placeholder="이름, 차트번호, 전화번호로 검색..." 
                 onkeyup="filterBookingPatients()" 
                 onfocus="showBookingPatientDropdown()">
          <div id="booking-patient-dropdown" class="patient-dropdown" style="display: none;"></div>
        </div>
      </div>
      <div class="form-group">
        <label>예약 날짜</label>
        <input type="date" id="booking-date">
      </div>
      <div class="form-group">
        <label>예약 시간</label>
        <select id="booking-time">
          <option value="">시간을 선택하세요</option>
        </select>
      </div>
      <button class="btn btn-primary" onclick="addBooking()">예약 추가</button>
    </div>
    
    <div class="form-section">
      <h2 class="section-title">예약 목록</h2>
      <div id="booking-list" class="loading">예약 목록 불러오는 중...</div>
    </div>
  `;
}

async function loadBookingList() {
    // 환자 목록 로드
    try {
        const response = await fetch(`${API_BASE}/api/patients`);
        const result = await response.json();
        if (result.success) {
            allPatients = result.data;
        }
    } catch (error) {
        console.error('환자 목록 로드 실패:', error);
    }

    // 시간 선택 박스 초기화
    initializeTimeSelect();

    // 예약 목록 로드
    try {
        const response = await fetch(`${API_BASE}/api/bookings`);
        const result = await response.json();

        if (result.success) {
            displayBookingList(result.data);
        } else {
            document.getElementById('booking-list').innerHTML =
                '<p style="text-align:center;color:#999;padding:40px;">예약 목록 불러오기 실패</p>';
        }
    } catch (error) {
        console.error('예약 목록 로드 실패:', error);
        document.getElementById('booking-list').innerHTML =
            '<p style="text-align:center;color:#999;padding:40px;">예약 목록 불러오기 오류</p>';
    }
}

function displayBookingList(bookings) {
    const listDiv = document.getElementById('booking-list');

    if (!bookings || bookings.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">예약이 없습니다</p>';
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>이름</th>
                    <th>전화번호</th>
                    <th>날짜</th>
                    <th>시간</th>
                    <th>상태</th>
                </tr>
            </thead>
            <tbody>
    `;

    bookings.forEach(b => {
        html += `
            <tr>
                <td>${b.name}</td>
                <td>${b.phone}</td>
                <td>${(b.date || '').slice(0, 10)}</td>
                <td>${b.time}</td>
                <td>${b.status || '-'}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    listDiv.innerHTML = html;
}

function initializeTimeSelect() {
    const timeSelect = document.getElementById('booking-time');
    if (!timeSelect) return;

    // 09:00 ~ 20:00, 10분 단위
    for (let hour = 9; hour <= 20; hour++) {
        for (let minute = 0; minute < 60; minute += 10) {
            const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            const option = document.createElement('option');
            option.value = timeStr;
            option.textContent = timeStr;
            timeSelect.appendChild(option);
        }
    }
}

function showBookingPatientDropdown() {
    filterBookingPatients();
}

function filterBookingPatients() {
    const searchInput = document.getElementById('booking-patient-search');
    const dropdown = document.getElementById('booking-patient-dropdown');
    if (!searchInput || !dropdown) return;

    const query = searchInput.value.toLowerCase().trim();

    if (query === '') {
        dropdown.style.display = 'none';
        return;
    }

    const filtered = allPatients.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.chartNo.toString().includes(query) ||
        p.phone.includes(query)
    );

    if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 10px; color: #999;">검색 결과가 없습니다</div>';
        dropdown.style.display = 'block';
        return;
    }

    let html = '';
    filtered.forEach(p => {
        html += `<div class="patient-dropdown-item" onclick='selectBookingPatient(${JSON.stringify(p)})'>
              <div style="font-weight: bold;">${p.name} (${p.chartNo})</div>
              <div style="color: #666; font-size: 0.9rem;">${p.phone}</div>
          </div>`;
    });

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}

function selectBookingPatient(patient) {
    selectedBookingPatient = patient;
    document.getElementById('booking-patient-search').value = `${patient.name} (${patient.chartNo})`;
    document.getElementById('booking-patient-dropdown').style.display = 'none';
}

function addBooking() {
    const date = document.getElementById('booking-date').value;
    const time = document.getElementById('booking-time').value;

    if (!selectedBookingPatient || !date || !time) {
        alert('모든 항목을 입력하세요');
        return;
    }

    // 예약 추가 기능 (DB에 저장 필요)
    alert(`예약 추가 (DB 연동 필요):\\n환자: ${selectedBookingPatient.name}\\n날짜: ${date}\\n시간: ${time}`);
}

// ========================================
// 발송 내역 탭
// ========================================
function getHistoryTabHTML() {
    return `
    <div class="form-section">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
        <h2 class="section-title" style="margin: 0;">📋 발송 내역</h2>
        <button onclick="syncMessageHistory()" style="padding: 4px 12px; font-size: 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;" title="예약 문자 내역 동기화">🔄 동기화</button>
      </div>
      <div class="form-group">
        <label>유형 필터</label>
        <select id="history-type-filter" onchange="filterHistory()">
          <option value="">전체</option>
          <option value="SMS">SMS</option>
          <option value="LMS">LMS</option>
          <option value="알림톡">알림톡</option>
          <option value="D3톡">D3톡</option>
          <option value="예약(D-1)">D-1</option>
          <option value="예약(당일)">당일</option>
        </select>
      </div>
      <div class="form-group">
        <label>검색</label>
        <input type="text" id="history-search" placeholder="환자명, 차트번호, 전화번호..." onkeyup="filterHistory()">
      </div>
      <div id="history-list" class="loading">발송 내역 불러오는 중...</div>
    </div>
  `;
}

async function loadSendingHistory() {
    try {
        const response = await fetch(`${API_BASE}/api/message-history`);
        const result = await response.json();

        if (result.success) {
            allHistoryCache = result.data;
            displaySendingHistory(result.data);
        }
    } catch (error) {
        document.getElementById('history-list').innerHTML =
            '<p style="text-align:center;color:#f44336;padding:40px;">내역 로드 실패</p>';
    }
}

async function filterHistory() {
    const type = document.getElementById('history-type-filter').value;
    const query = document.getElementById('history-search').value.trim();

    try {
        const params = new URLSearchParams();
        if (type) params.append('type', type);
        if (query) params.append('q', query);

        const response = await fetch(`${API_BASE}/api/message-history/search?${params}`);
        const result = await response.json();

        if (result.success) {
            displaySendingHistory(result.data);
        }
    } catch (error) {
        console.error('검색 실패:', error);
    }
}

function displaySendingHistory(history) {
    const listDiv = document.getElementById('history-list');

    if (!history || history.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">발송 내역이 없습니다</p>';
        return;
    }

    // 최신순 정렬 (날짜 내림차순) - sentAt 또는 timestamp 필드 사용
    const sortedHistory = [...history].sort((a, b) => {
        const dateA = new Date(a.sentAt || a.timestamp);
        const dateB = new Date(b.sentAt || b.timestamp);
        return dateB - dateA;
    });

    let html = `
    <div style="display: flex; flex-direction: column; height: 100%; margin: 0; padding: 0;">
        <table style="font-size: 12px; white-space: nowrap; width: 100%; border-collapse: collapse; margin: 0;">
            <thead>
                <tr style="background: #f5f5f5;">
                    <th style="padding: 6px 8px; text-align: left; border-bottom: 2px solid #667eea; width: 20%;">날짜</th>
                    <th style="padding: 6px 8px; text-align: left; border-bottom: 2px solid #667eea; width: 15%;">환자명</th>
                    <th style="padding: 6px 8px; text-align: left; border-bottom: 2px solid #667eea; width: 10%;">차트</th>
                    <th style="padding: 6px 8px; text-align: left; border-bottom: 2px solid #667eea; width: 25%;">전화번호</th>
                    <th style="padding: 6px 8px; text-align: left; border-bottom: 2px solid #667eea; width: 15%;">유형</th>
                    <th style="padding: 6px 8px; text-align: center; border-bottom: 2px solid #667eea; width: 10%;">상태</th>
                </tr>
            </thead>
        </table>
        <div style="flex: 1; overflow-y: auto; margin-top: 0;">
            <table style="font-size: 12px; white-space: nowrap; width: 100%; border-collapse: collapse; margin-top: 0;">
                <tbody>
    `;

    sortedHistory.forEach(h => {
        const dateStr = h.sentAt || h.timestamp;
        const date = dateStr ? new Date(dateStr).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
        const patientName = h.patientName || h.name || '-';

        // 상태 표시 정의: 'success'만 체크(✓), '예약'이나 'pending'은 대기(⏳), 나머지는 실패(✕)
        const isFinished = h.status === 'success';
        const isWaiting = h.status === 'pending' || h.status === '예약';

        const statusText = isFinished ? '✓' : (isWaiting ? '⏳' : '✕');
        const statusColor = isFinished ? '#4caf50' : (isWaiting ? '#f59e0b' : '#f44336');

        // 유형별 색상 및 라벨 설정
        let typeColor = '#22c55e'; // 기본 SMS/LMS 초록
        let typeLabel = h.type;

        if (h.type === 'SMS') {
            typeLabel = 'SMS';
            typeColor = '#22c55e';
        } else if (h.type === 'LMS') {
            typeLabel = 'LMS';
            typeColor = '#22c55e';
        } else if (h.type === '알림톡' || h.type === 'alimtalk') {
            typeLabel = '알림톡';
            typeColor = '#f59e0b';
        } else if (h.type === 'D-1' || h.type === '예약(D-1)') {
            typeLabel = 'D-1';
            typeColor = '#ea580c';
        } else if (h.type === '당일' || h.type === '예약(당일)') {
            typeLabel = '당일';
            typeColor = '#06b6d4';
        } else if (h.type === 'D3톡') {
            typeLabel = 'D3톡';
            typeColor = '#a855f7';
        } else if (h.type === '예약') {
            // 사용자의 정의: 수동으로 예약 문자를 보낸 경우
            typeLabel = '예약(수동)';
            typeColor = '#22c55e';
        }

        html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px; width: 20%;">${date}</td>
                    <td style="padding: 8px; width: 15%;">${patientName}</td>
                    <td style="padding: 8px; width: 10%;">${h.chartNo || '-'}</td>
                    <td style="padding: 8px; width: 25%;">${h.phone}</td>
                    <td style="padding: 8px; width: 15%; color: ${typeColor}; font-weight: 600;">${typeLabel}</td>
                    <td style="padding: 8px; width: 10%; text-align: center; color: ${statusColor}; font-weight: bold;">${statusText}</td>
                </tr>
        `;
    });

    html += '</tbody></table></div></div>';
    listDiv.innerHTML = html;
}

// ========================================
// 예약 문자 내역 동기화
// ========================================
async function syncMessageHistory() {
    const syncBtn = document.querySelector('button[onclick="syncMessageHistory()"]');
    if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.innerHTML = '⏳ 동기화 중...';
    }

    try {
        const response = await fetch('/api/sync-message-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const result = await response.json();

        if (result.success) {
            showModal(`✅ ${result.message}`, 'success');
            loadSendingHistory(); // 내역 새로고침
        } else {
            showModal('❌ 동기화 실패: ' + (result.message || '알 수 없는 오류'), 'error');
        }
    } catch (error) {
        showModal('❌ 동기화 오류: ' + error.message, 'error');
    } finally {
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.innerHTML = '🔄 동기화';
        }
    }
}

// ========================================
// 초기화
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    loadTabContent('messaging');
});
