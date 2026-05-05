const express = require('express');
const router = express.Router();
const path = require('path');
const { readData, writeData } = require('../utils/fileStore');

const DATA_DIR = path.join(__dirname, '../data');
const BOOKING_CONFIG_FILE = path.join(DATA_DIR, 'booking-config.json');
const API_KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');

// 알림 설정 조회 (발송 시간 등)
router.get('/booking-config', (req, res) => {
    try {
        const config = readData(BOOKING_CONFIG_FILE);
        const defaults = {
            dDayTime: "08:30"
        };
        // 데이터가 배열로 반환되는 경우(readData 기본값) 대응
        const data = Array.isArray(config) ? defaults : { ...defaults, ...config };
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 알림 설정 저장
router.post('/booking-config', (req, res) => {
    const { dDayTime } = req.body;
    try {
        writeData(BOOKING_CONFIG_FILE, { dDayTime });
        res.json({ success: true, message: '설정이 저장되었습니다.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get API Keys
router.get('/api-keys', (req, res) => {
    try {
        const keys = readData(API_KEYS_FILE);
        const defaults = {
            vworld: process.env.VWORLD_API_KEY || '',
            sweettracker: 'P5lRo6keSMdvd00HDanHBQ'
        };
        res.json({ success: true, data: { ...defaults, ...keys } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update API Keys
router.post('/api-keys', (req, res) => {
    const { vworld, sweettracker } = req.body;
    try {
        writeData(API_KEYS_FILE, { vworld, sweettracker });
        res.json({ success: true, message: 'API 키가 저장되었습니다.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
