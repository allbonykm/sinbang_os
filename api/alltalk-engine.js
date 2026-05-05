/**
 * All-Talk Automation Engine
 * - Schedule & Trigger Management
 */
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const naverSens = require('./naver-sens');
const telegram = require('../utils/telegram');
const pool = require('../config/db');

let DATA_DIR = '';
let FILES = {};

// 초기화
function init(dataDir, files) {
    DATA_DIR = dataDir;
    FILES = files;
    console.log('All-Talk Engine Initialized.');

}

// 데이터 읽기 헬퍼
function readData(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`Read error: ${filePath}`, e);
        return [];
    }
}







/**
 * 시간을 한국어 형식으로 변환 (예: "14:30" -> "오후 2:30")
 */
function formatTimeKorean(timeStr) {
    if (!timeStr) return '';

    const [hourStr, minuteStr] = timeStr.split(':');
    let hour = parseInt(hourStr, 10);
    const minute = minuteStr || '00';

    let ampm = '오전';
    if (hour >= 12) {
        ampm = '오후';
        if (hour > 12) hour -= 12;
    }
    if (hour === 0) hour = 12;

    return `${ampm} ${hour}:${minute}`;
}


module.exports = {
    init
};

