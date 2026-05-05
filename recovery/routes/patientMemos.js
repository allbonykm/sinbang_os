const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
// DATA_DIR is needed for path.join(DATA_DIR, 'patient-memos.json');
// We can define it relative to this file as well: ../data
const DATA_DIR = path.join(__dirname, '../data');
const PATIENT_MEMOS_FILE = path.join(DATA_DIR, 'patient-memos.json');

function readPatientMemosData() {
    try {
        if (!fs.existsSync(PATIENT_MEMOS_FILE)) {
            // If data dir doesn't exist, create it? server.js usually ensures DATA_DIR exists.
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(PATIENT_MEMOS_FILE, JSON.stringify({ memos: [] }, null, 2));
        }
        return JSON.parse(fs.readFileSync(PATIENT_MEMOS_FILE, 'utf8'));
    } catch (error) {
        return { memos: [] };
    }
}

function writePatientMemosData(data) {
    fs.writeFileSync(PATIENT_MEMOS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ===========================================
// 환자 메모 API
// ===========================================

// 환자별 메모 목록 조회
router.get('/patient-memos/:patientId', (req, res) => {
    const { patientId } = req.params;
    try {
        const data = readPatientMemosData();
        const memos = data.memos
            .filter(m => m.patientId === parseInt(patientId))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, data: memos });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 메모 추가
router.post('/patient-memos', (req, res) => {
    const { patientId, patientName, content } = req.body;

    if (!patientId || !content) {
        return res.json({ success: false, message: 'patientId and content are required' });
    }

    try {
        const data = readPatientMemosData();
        const newMemo = {
            id: Date.now(),
            patientId: parseInt(patientId),
            patientName: patientName || '',
            content,
            createdAt: new Date().toISOString(),
            updatedAt: null
        };
        data.memos.push(newMemo);
        writePatientMemosData(data);
        res.json({ success: true, data: newMemo });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 메모 수정
router.put('/patient-memos/:id', (req, res) => {
    const { id } = req.params;
    const { content } = req.body;

    try {
        const data = readPatientMemosData();
        const index = data.memos.findIndex(m => m.id === parseInt(id));

        if (index === -1) {
            return res.json({ success: false, message: 'Memo not found' });
        }

        data.memos[index].content = content;
        data.memos[index].updatedAt = new Date().toISOString();
        writePatientMemosData(data);
        res.json({ success: true, data: data.memos[index] });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// 메모 삭제
router.delete('/patient-memos/:id', (req, res) => {
    const { id } = req.params;

    try {
        const data = readPatientMemosData();
        const index = data.memos.findIndex(m => m.id === parseInt(id));

        if (index === -1) {
            return res.json({ success: false, message: 'Memo not found' });
        }

        data.memos.splice(index, 1);
        writePatientMemosData(data);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
