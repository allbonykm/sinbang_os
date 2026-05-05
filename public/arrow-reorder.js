// ==========================================
// 비급여 항목 화살표 버튼 순서 변경
// ==========================================

// 기존 displayItems 함수를 화살표 버튼 버전으로 대체
window.displayItemsWithArrows = function () {
    const listDiv = document.getElementById('items-list');

    if (nonReimbursementItems.length === 0) {
        listDiv.innerHTML = '<p style="color:#999;">등록된 항목이 없습니다</p>';
        return;
    }

    listDiv.innerHTML = nonReimbursementItems.map((item, index) => `
        <div class="item-tag-arrow">
            <span class="item-name">🔹 ${item.name}</span>
            <div class="item-controls">
                <button class="arrow-btn" onclick="moveItem(${index}, -1)" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="arrow-btn" onclick="moveItem(${index}, 1)" ${index === nonReimbursementItems.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="delete-btn" onclick="deleteItem(${item.id})">삭제</button>
            </div>
        </div>
    `).join('');
};

// 항목 이동
async function moveItem(index, direction) {
    const newItems = [...nonReimbursementItems];
    const newIndex = index + direction;

    if (newIndex < 0 || newIndex >= newItems.length) return;

    // 배열에서 위치 변경
    [newItems[index], newItems[newIndex]] = [newItems[newIndex], newItems[index]];

    // 서버에 저장
    const response = await fetch('/api/non-reimbursement-items/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: newItems })
    });

    const result = await response.json();

    if (result.success) {
        await loadItems(); // 목록 다시 로드
    } else {
        alert('❌ 순서 변경 실패');
    }
}

// displayItems 함수 교체
if (typeof displayItems !== 'undefined') {
    displayItems = displayItemsWithArrows;
}
