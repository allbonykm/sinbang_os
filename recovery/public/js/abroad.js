document.addEventListener('DOMContentLoaded', async () => {
    // 1. Data Binding Elements
    const inputs = {
        contents: document.getElementById('input-contents'),
        diagnosis: document.getElementById('input-diagnosis'),
        prescription: document.getElementById('input-prescription'),
        clinic: document.getElementById('input-clinic'),
        address: document.getElementById('input-address'),
        date: document.getElementById('input-date'),
        doctor: document.getElementById('input-doctor')
    };

    const views = {
        contents: document.getElementById('view-contents'),
        diagnosis: document.getElementById('view-diagnosis'),
        prescription: document.getElementById('view-prescription'),
        clinic: document.getElementById('view-clinic'),
        address: document.getElementById('view-address'),
        date: document.getElementById('view-date'),
        doctor: document.getElementById('view-doctor')
    };

    // 2. Initial Date Setup
    const formatDate = (date) => {
        const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    };

    const today = new Date();
    const formattedToday = formatDate(today);
    if (inputs.date.value === '') {
        inputs.date.value = formattedToday;
    }
    views.date.textContent = inputs.date.value || formattedToday;

    // 3. Real-time Binding Logic
    Object.keys(inputs).forEach(key => {
        if (inputs[key]) {
            inputs[key].addEventListener('input', () => {
                if (views[key]) {
                    views[key].textContent = inputs[key].value;
                }
            });
            // Initial sync
            if (views[key]) {
                views[key].textContent = inputs[key].value;
            }
        }
    });

    // 4. Herb Management
    let herbData = [];
    let selectedHerbs = [];

    // Load Herb Data
    try {
        const response = await fetch('/data/herbs_latin.json');
        herbData = await response.json();
    } catch (e) {
        console.error('Failed to load herb data:', e);
    }

    const searchInput = document.getElementById('herb-search');
    const suggestions = document.getElementById('herb-suggestions');
    const amountInput = document.getElementById('herb-amount');
    const btnAdd = document.getElementById('btn-add-herb');
    const herbListEdit = document.getElementById('herb-list-edit');
    const ingListBody = document.getElementById('ing-list-body');

    // Search Suggestions
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            suggestions.style.display = 'none';
            return;
        }

        const filtered = herbData.filter(h => h.ko.includes(query) || h.latin.toLowerCase().includes(query));

        if (filtered.length > 0) {
            suggestions.innerHTML = filtered.slice(0, 10).map(h => `
                <div class="suggestion-item" data-ko="${h.ko}" data-latin="${h.latin}">
                    <strong>${h.ko}</strong> - <small>${h.latin}</small>
                </div>
            `).join('');
            suggestions.style.display = 'block';
        } else {
            suggestions.style.display = 'none';
        }
    });

    suggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.suggestion-item');
        if (item) {
            searchInput.value = item.dataset.ko;
            searchInput.dataset.selectedLatin = item.dataset.latin;
            suggestions.style.display = 'none';
        }
    });

    // Add Herb
    btnAdd.addEventListener('click', () => {
        const ko = searchInput.value.trim();
        const latin = searchInput.dataset.selectedLatin || ko; // Fallback to raw input if not selected
        const amount = amountInput.value;

        if (!ko) return;

        selectedHerbs.push({ ko, latin, amount });
        updateHerbLists();

        // Reset inputs
        searchInput.value = '';
        delete searchInput.dataset.selectedLatin;
    });

    // Update Lists
    function updateHerbLists() {
        // Update Edit List (Left)
        herbListEdit.innerHTML = selectedHerbs.map((h, index) => `
            <div class="herb-item-edit">
                <span class="herb-name">${h.ko} (${h.latin})</span>
                <input type="number" class="herb-amount" value="${h.amount}" onchange="updateAmount(${index}, this.value)">
                <span class="btn-remove" onclick="removeHerb(${index})">✕</span>
            </div>
        `).join('');

        // Update Preview List (Right)
        ingListBody.innerHTML = selectedHerbs.map((h, index) => `
            <tr>
                <td class="col-no">${index + 1}</td>
                <td>${h.latin}</td>
                <td class="col-amount">${h.amount} g</td>
            </tr>
        `).join('');
    }

    // Global handles for edit/remove
    window.removeHerb = (index) => {
        selectedHerbs.splice(index, 1);
        updateHerbLists();
    };

    window.updateAmount = (index, value) => {
        selectedHerbs[index].amount = value;
        updateHerbLists();
    };

    // Close suggestions on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.herb-search-container')) {
            suggestions.style.display = 'none';
        }
    });

});
