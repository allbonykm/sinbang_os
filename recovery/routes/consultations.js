const express = require('express');
const router = express.Router();
const { CONSULTATIONS_FILE } = require('../utils/fileStore');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// AI 상담 내역 저장 및 분석 API
router.post('/public/consultation', async (req, res) => {
    try {
        const { isAnalysisRequest, ...consultationData } = req.body;

        // 1. AI 분석 요청인 경우
        if (isAnalysisRequest) {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return res.json({ success: false, message: 'API 키가 설정되지 않았습니다.' });
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const prompt = "당신은 '신방한의원'의 친절하고 전문적인 한의사 AI 어시스턴트입니다. 환자의 증상을 바탕으로 예상되는 원인과 도움이 될 만한 한방 치료법을 3줄 이내로 간결하고 희망차게 설명해주세요. 의학적 확진이 아님을 명시하고, 정확한 진단을 위해 내원을 권유하는 문구로 마무리하세요. \n\n" + "환자 정보:\n    - 이름: " + consultationData.name + "\n    - 성별 / 나이: " + consultationData.gender + ", " + consultationData.age + " 세\n    - 주요 증상: " + consultationData.symptoms + "\n    - 증상 상세: " + (consultationData.details || '없음') + "\n    - 기간: " + consultationData.duration + "\n    - 통증 정도(1 - 10): " + consultationData.painLevel + "\n\n" + "답변 형식:\n    1.[공감 및 예상 원인]\n    2.[한방 치료 제안]\n    3.[내원 권유 및 희망 메시지]";

            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();
                return res.json({ success: true, analysis: text });
            } catch (aiError) {
                console.error('Gemini API Error:', aiError);
                return res.json({ success: false, message: 'AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
            }
        }

        // 2. 일반 저장 요청인 경우
        if (!fs.existsSync(CONSULTATIONS_FILE)) {
            fs.writeFileSync(CONSULTATIONS_FILE, JSON.stringify([], null, 2));
        }

        const consultations = JSON.parse(fs.readFileSync(CONSULTATIONS_FILE, 'utf8'));

        const newEntry = {
            id: Date.now().toString(),
            createdAt: new Date().toISOString(),
            ...consultationData
        };

        consultations.push(newEntry);
        fs.writeFileSync(CONSULTATIONS_FILE, JSON.stringify(consultations, null, 2));

        res.json({ success: true, message: '상담 내역이 저장되었습니다.', id: newEntry.id });
    } catch (error) {
        console.error('상담 내역 처리 중 오류:', error);
        res.status(500).json({ success: false, message: '처리 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
