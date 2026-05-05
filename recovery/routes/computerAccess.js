const express = require('express');
const router = express.Router();
const fs = require('fs');
const { readData, writeData, COMPUTER_ACCESS_FILE } = require('../utils/fileStore');

// ===========================================
// 컴퓨터 접근 제어 (Computer Access)
// ===========================================

// 마스터 메뉴 리스트 (Source of Truth)
// index.html의 메뉴 구조와 동기화
const MASTER_MENU_LIST = [
    { id: 'dashboard', name: '대시보드', icon: '🏠' },
    { id: 'patients', name: '환자 관리', icon: '👤' },
    { id: 'booking', name: '예약 관리', icon: '📅' },
    { id: 'alltalk', name: '올톡', icon: '📱' },
    { id: 'visit-analysis', name: '내원간격 분석', icon: '📊' },
    { id: 'visit-calendar', name: '내원 캘린더', icon: '📅' }
];

// 메뉴 동기화 함수
function syncMenus(data) {
    let modified = false;

    // 1. 없는 메뉴 추가 및 정보 업데이트
    MASTER_MENU_LIST.forEach(masterMenu => {
        const existingInfo = data.allMenus.find(m => m.id === masterMenu.id);
        if (!existingInfo) {
            data.allMenus.push(masterMenu);
            modified = true;
            console.log(`[System] New menu added: ${masterMenu.name} (${masterMenu.id})`);
        } else {
            if (existingInfo.name !== masterMenu.name || existingInfo.icon !== masterMenu.icon) {
                existingInfo.name = masterMenu.name;
                existingInfo.icon = masterMenu.icon;
                modified = true;
                console.log(`[System] Menu updated: ${masterMenu.name} (${masterMenu.id})`);
            }
        }
    });

    // 2. MASTER_MENU_LIST에 없는 기존 메뉴 삭제 (신방 OS 맞춤 스펙)
    const originalLength = data.allMenus.length;
    data.allMenus = data.allMenus.filter(m => MASTER_MENU_LIST.some(master => master.id === m.id));
    if (data.allMenus.length !== originalLength) {
        modified = true;
        console.log(`[System] Cleaned up unused menus. (Current count: ${data.allMenus.length})`);
    }

    // 3. 권한 배열에서도 삭제된 메뉴 청소
    Object.keys(data.menuPermissions).forEach(compId => {
        const currentPerms = data.menuPermissions[compId];
        const newPerms = currentPerms.filter(permId => MASTER_MENU_LIST.some(m => m.id === permId));
        if (currentPerms.length !== newPerms.length) {
            data.menuPermissions[compId] = newPerms;
            modified = true;
        }
    });

    if (modified) {
        writeData(COMPUTER_ACCESS_FILE, data);
    }
}

// 컴퓨터 접근 데이터 초기화
if (!fs.existsSync(COMPUTER_ACCESS_FILE)) {
    const initialData = {
        computers: [
            {
                id: 'ADMIN',
                name: '대표원장',
                key: 'admin-sinbang-2026',
                isAdmin: true,
                createdAt: new Date().toISOString()
            }
        ],
        menuPermissions: {},
        allMenus: MASTER_MENU_LIST
    };
    try {
        fs.writeFileSync(COMPUTER_ACCESS_FILE, JSON.stringify(initialData, null, 2));
    } catch (err) {
        console.error('Failed to initialize computer access file:', err);
    }
}

// 키로 컴퓨터 인증
router.post('/computer/verify', (req, res) => {
    const { key } = req.body;

    try {
        const data = readData(COMPUTER_ACCESS_FILE);
        const computer = data.computers.find(c => c.key === key);

        if (!computer) {
            return res.json({ success: false, message: '유효하지 않은 코드입니다' });
        }

        // 동기화 실행 (접속 시 최신 메뉴 정보 반영)
        syncMenus(data);

        // 관리자면 모든 메뉴, 아니면 허용된 메뉴만
        const allowedMenus = computer.isAdmin
            ? data.allMenus.map(m => m.id)
            : (data.menuPermissions[computer.id] || []);

        res.json({
            success: true,
            computer: {
                id: computer.id,
                name: computer.name,
                isAdmin: computer.isAdmin
            },
            allowedMenus: allowedMenus,
            // allMenus 제공 시에도 최신 데이터 제공 (이미 syncMenus로 data가 업데이트됨)
            allMenus: data.allMenus
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 컴퓨터 목록 조회 (관리자용)
router.get('/computer/list', (req, res) => {
    try {
        const data = readData(COMPUTER_ACCESS_FILE);

        // 동기화 실행 (관리자 페이지 접속 시 자동 업데이트)
        syncMenus(data);

        res.json({
            success: true,
            computers: data.computers,
            menuPermissions: data.menuPermissions,
            allMenus: data.allMenus
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 새 컴퓨터 등록 (관리자용)
router.post('/computer/register', (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.json({ success: false, message: '컴퓨터 이름을 입력하세요' });
    }

    try {
        const data = readData(COMPUTER_ACCESS_FILE);

        // 고유 ID 및 키 생성
        const id = 'DESK-' + Date.now().toString(36).toUpperCase();
        const key = 'desk-' + Math.random().toString(36).substring(2, 10);

        const newComputer = {
            id: id,
            name: name,
            key: key,
            isAdmin: false,
            createdAt: new Date().toISOString()
        };

        data.computers.push(newComputer);
        data.menuPermissions[id] = ['dashboard']; // 기본: 대시보드만

        writeData(COMPUTER_ACCESS_FILE, data);

        res.json({ success: true, computer: newComputer });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 컴퓨터 권한 수정 (관리자용)
router.put('/computer/:id/permissions', (req, res) => {
    const { id } = req.params;
    const { permissions } = req.body;

    try {
        const data = readData(COMPUTER_ACCESS_FILE);
        const computer = data.computers.find(c => c.id === id);

        if (!computer) {
            return res.json({ success: false, message: '컴퓨터를 찾을 수 없습니다' });
        }

        if (computer.isAdmin) {
            return res.json({ success: false, message: '관리자 권한은 변경할 수 없습니다' });
        }

        data.menuPermissions[id] = permissions;
        writeData(COMPUTER_ACCESS_FILE, data);

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 컴퓨터 삭제 (관리자용)
router.delete('/computer/:id', (req, res) => {
    const { id } = req.params;

    try {
        const data = readData(COMPUTER_ACCESS_FILE);
        const computer = data.computers.find(c => c.id === id);

        if (!computer) {
            return res.json({ success: false, message: '컴퓨터를 찾을 수 없습니다' });
        }

        if (computer.isAdmin) {
            return res.json({ success: false, message: '관리자는 삭제할 수 없습니다' });
        }

        data.computers = data.computers.filter(c => c.id !== id);
        delete data.menuPermissions[id];

        writeData(COMPUTER_ACCESS_FILE, data);

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
