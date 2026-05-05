
/**
 * Delivery Modal Logic
 */

let deliveryProducts = [];
let currentSweetTrackerKey = 'P5lRo6keSMdvd00HDanHBQ'; // Default fallback

// Load API Keys from server
async function loadApiKeySettings() {
    try {
        const response = await fetch('/api/settings/api-keys');
        const result = await response.json();
        if (result.success) {
            currentSweetTrackerKey = result.data.sweettracker;
            // Update UI if fields exist
            const vInput = document.getElementById('setting-vworld-key');
            const sInput = document.getElementById('setting-sweet-key');
            if (vInput) vInput.value = result.data.vworld || '';
            if (sInput) sInput.value = result.data.sweettracker || '';
        }
    } catch (e) {
        console.error('API 키 로드 실패:', e);
    }
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    loadDeliveryProducts();
    loadApiKeySettings();
});

async function loadDeliveryProducts() {
    try {
        const res = await fetch('/api/non-reimbursement-items');
        const result = await res.json();
        if (result.success) {
            deliveryProducts = result.data;
        }
    } catch (err) {
        console.error('Failed to load delivery products:', err);
    }
}

function openDeliveryModal() {
    const modal = document.getElementById('delivery-quick-modal');
    if (!modal) return;

    // Reset fields
    document.getElementById('dv-patient-search').value = '';
    document.getElementById('dv-patient-id').value = '';
    document.getElementById('dv-patient-name-raw').value = '';
    document.getElementById('dv-product-search').value = '';
    document.getElementById('dv-tracking-no').value = '';
    document.getElementById('dv-carrier').value = '06'; // 로젠택배 Default

    document.getElementById('dv-patient-dropdown').classList.remove('show');
    document.getElementById('dv-product-dropdown').classList.remove('show');

    modal.style.display = 'flex';
}

function closeDeliveryModal() {
    document.getElementById('delivery-quick-modal').style.display = 'none';
}

// API Key Settings Modal
function openApiKeyModal() {
    loadApiKeySettings().then(() => {
        document.getElementById('api-key-modal').style.display = 'flex';
    });
}

function closeApiKeyModal() {
    document.getElementById('api-key-modal').style.display = 'none';
}

async function saveApiKeySettings() {
    const vworld = document.getElementById('setting-vworld-key').value;
    const sweettracker = document.getElementById('setting-sweet-key').value;

    try {
        const response = await fetch('/api/settings/api-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vworld, sweettracker })
        });
        const result = await response.json();
        if (result.success) {
            alert('✅ API 키가 성공적으로 저장되었습니다.');
            currentSweetTrackerKey = sweettracker;
            closeApiKeyModal();
        } else {
            alert('❌ 저장 실패: ' + result.message);
        }
    } catch (e) {
        alert('❌ 에러 발생: ' + e.message);
    }
}

// Patient Search
function filterDeliveryPatient() {
    const query = document.getElementById('dv-patient-search').value.trim().toLowerCase();
    const dropdown = document.getElementById('dv-patient-dropdown');

    if (query.length < 1) {
        dropdown.classList.remove('show');
        return;
    }

    // Always fetch from API for real-time data sync
    fetch(`/api/patients/search?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(result => {
            if (result.success && result.data.length > 0) {
                // Filter further if needed (optional) but the API already does it
                displayDeliveryPatientResults(result.data.slice(0, 10));
            } else {
                dropdown.innerHTML = '<div style="padding: 12px 15px; color: #999;">검색 결과 없음</div>';
                dropdown.classList.add('show');
            }
        })
        .catch(err => {
            console.error('검색 실패:', err);
            // Fallback to local data if API fails and patients is available
            if (typeof patients !== 'undefined' && patients.length > 0) {
                const filtered = patients.filter(p => 
                    p.name.toLowerCase().includes(query) || 
                    (p.chartNo && p.chartNo.toString().includes(query)) ||
                    (p.phone && p.phone.replace(/[^0-9]/g, '').includes(query.replace(/[^0-9]/g, '')))
                ).slice(0, 10);
                if (filtered.length > 0) displayDeliveryPatientResults(filtered);
            }
        });
}

function displayDeliveryPatientResults(data) {
    const dropdown = document.getElementById('dv-patient-dropdown');
    dropdown.innerHTML = data.map(p => `
        <div class="search-item" onclick="selectDeliveryPatient('${p.id}', '${p.name}', '${p.chartNo}', '${p.phone}')" style="padding: 12px 15px; border-bottom: 1px solid #eee; cursor: pointer;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-weight: 700; color: #333; font-size: 15px;">${p.name}</span>
            </div>
            <div style="font-size: 13px; color: #999;">
                차트: ${p.chartNo} | ${p.phone || '-'}
            </div>
        </div>
    `).join('');
    dropdown.classList.add('show');
}

function selectDeliveryPatient(id, name, chartNo, phone) {
    document.getElementById('dv-patient-id').value = id;
    document.getElementById('dv-patient-phone').value = phone;
    document.getElementById('dv-patient-chart').value = chartNo;
    document.getElementById('dv-patient-name-raw').value = name;
    document.getElementById('dv-patient-dropdown').classList.remove('show');
    document.getElementById('dv-patient-search').value = `${name} (${chartNo})`;
}

// Product Search
function filterDeliveryProduct() {
    const query = document.getElementById('dv-product-search').value;
    const dropdown = document.getElementById('dv-product-dropdown');

    const filtered = deliveryProducts.filter(p => p.name.includes(query));

    if (filtered.length > 0) {
        dropdown.innerHTML = filtered.map(p => `
            <div class="search-item" onclick="selectDeliveryProduct('${p.name}')">
                <span class="name">${p.name}</span>
            </div>
        `).join('');
        dropdown.classList.add('show');
    } else {
        dropdown.classList.remove('show');
    }
}

function selectDeliveryProduct(name) {
    document.getElementById('dv-product-search').value = name;
    document.getElementById('dv-product-dropdown').classList.remove('show');
}

// Generate Tracking Link
function generateDeliveryLink() {
    const product = document.getElementById('dv-product-search').value;
    let trackNo = document.getElementById('dv-tracking-no').value.replace(/-/g, ''); 
    const carrier = document.getElementById('dv-carrier').value;

    if (!product || !trackNo) {
        alert('상품명과 송장번호를 확인해주세요.');
        return null;
    }

    return `https://info.sweettracker.co.kr/tracking/5?t_key=${currentSweetTrackerKey}&t_code=${carrier}&t_invoice=${trackNo}`;
}

// Dispatch Alimtalk
async function copyAndOpenMsg() {
    const patientName = document.getElementById('dv-patient-name-raw').value;
    const chartNo = document.getElementById('dv-patient-chart').value;
    const phone = document.getElementById('dv-patient-phone').value;
    const product = document.getElementById('dv-product-search').value;
    const url = generateDeliveryLink();

    if (!patientName || !product || !url) {
        if (!patientName) alert('환자를 선택해주세요.');
        return;
    }

    if (!confirm(`${patientName}님께 배송 알림톡을 발송하시겠습니까?`)) return;

    try {
        const response = await fetch('/api/agent/alimtalk/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chartNo,
                patientName,
                phone,
                eventType: 'OnlyDelivery',
                variables: {
                    name: patientName,
                    product: product,
                    url: url
                }
            })
        });

        const result = await response.json();
        if (result.success) {
            alert('✅ 알림톡 발송 성공!');
            closeDeliveryModal();
        } else {
            alert('❌ 발송 실패: ' + result.message);
        }
    } catch (error) {
        alert('❌ 에러 발생: ' + error.message);
    }
}

// Close Dropdowns on Click Outside
window.addEventListener('click', function(e) {
    if (!e.target.closest('.search-container')) {
        document.getElementById('dv-patient-dropdown')?.classList.remove('show');
        document.getElementById('dv-product-dropdown')?.classList.remove('show');
    }
});
