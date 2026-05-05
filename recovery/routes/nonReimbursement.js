
const express = require('express');
const router = express.Router();
const { readData, writeData, NON_REIMBURSEMENTS_FILE } = require('../utils/fileStore');
const fs = require('fs');
const path = require('path');

// 1. 비급여 항목 목록 조회 (택배 발송용 상품 목록)
router.get('/non-reimbursement-items', (req, res) => {
    try {
        // 기본 상품 목록 (데이터 파일이 없으면 기본값 반환)
        const defaultItems = [
            { id: 1, name: '한약 (1제)' },
            { id: 2, name: '한약 (0.5제)' },
            { id: 3, name: '경옥고' },
            { id: 4, name: '공진단' },
            { id: 5, name: '다이어트 환' },
            { id: 6, name: '파우치' }
        ];

        // 실제 운영 중인 항목이 있다면 불러오기 (옵션)
        // 여기서는 간단하게 하드코딩된 목록을 반환하거나, 별도 설정을 따를 수 있음
        res.json({ success: true, data: defaultItems });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
