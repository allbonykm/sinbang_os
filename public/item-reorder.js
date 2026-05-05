// 기존 displayItems 함수 교체
const originalDisplayItems = displayItems;

displayItems = function () {
    const listDiv = document.getElementById('items-list');

    if (!nonReimbursementItems || nonReimbursementItems.length === 0) {
        listDiv.innerHTML = '<p style="color:#999;">등록된 항목이 없습니다</p>';
        return;
    }

    listDiv.innerHTML = nonReimbursementItems.map((item, index) => `
        <div class="item-tag-arrow">
            <span class="item-name">🔹 ${item.name}</span>
            <div class="item-controls">
                <button class="arrow-btn" onclick="moveItemUp(${index})" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="arrow-btn" onclick="moveItemDown(${index})" ${index === nonReimbursementItems.length - 1 ? 'disabled' : ''}>↓</button>
                <span style="font-size: 11px; color: #666; margin-left: 8px;">재고:</span>
                <input type="number" id="stock-${item.id}" value="${item.stock || 0}" 
                       style="width: 50px; padding: 4px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px;">
                <button class="arrow-btn" onclick="saveStock(${item.id})" style="padding: 4px 8px; font-size: 11px; background: #10b981;">저장</button>
                <button class="delete-btn" onclick="deleteItem(${item.id})">삭제</button>
            </div>
        </div>
    `).join('');
};

// 항목 위로 이동
async function moveItemUp(index) {
    if (index === 0) return;
    await moveItemTo(index, index - 1);
}

// 항목 아래로 이동
async function moveItemDown(index) {
    if (index === nonReimbursementItems.length - 1) return;
    await moveItemTo(index, index + 1);
}

// 항목 이동 실행
async function moveItemTo(fromIndex, toIndex) {
    const newItems = [...nonReimbursementItems];
    [newItems[fromIndex], newItems[toIndex]] = [newItems[toIndex], newItems[fromIndex]];

    try {
        const response = await fetch('/api/non-reimbursement-items/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: newItems })
        });

        const result = await response.json();

        if (result.success) {
            await loadItems(); // 목록 다시 로드
        } else {
            alert('❌ 순서 변경 실패: ' + result.message);
        }
    } catch (error) {
        alert('❌ 에러: ' + error.message);
    }
}

console.log('✅ 화살표 순서 변경 기능 로드됨');
