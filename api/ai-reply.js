const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;
let model = null;

if (apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-1.5-flash (faster, newer)
    model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

const AiReply = {
    generateDraft: async (reviewContent, authorName) => {
        if (!apiKey || !model) {
            return { status: 'error', message: 'Gemini API Key가 설정되지 않았습니다.' };
        }

        try {
            console.log(`[AI] Generating draft for review by ${authorName}...`);
            const prompt = `
당신은 '올본한의원'의 친절하고 전문적인 대표 원장님입니다.
환자분이 남겨주신 네이버 리뷰에 대한 따뜻한 답글을 작성해주세요.

[환자 리뷰 정보]
- 작성자: ${authorName || '환자분'}
- 내용: ${reviewContent}

[답글 작성 가이드]
1. 먼저 방문에 대해 정중히 감사를 표하세요.
2. 리뷰 내용에 언급된 구체적인 증상이나 칭찬 포인트(통증 완화, 시설, 친절 등)를 언급하며 공감해주세요.
3. 앞으로도 정성을 다해 진료하겠다는 약속으로 마무리하세요.
4. 말투는 정중하고 신뢰감 있으면서도 따뜻한 '해요체'를 사용하세요.
5. 길이는 3~5문장 정도로, 가독성 좋게 작성해주세요.
6. 홍보성 멘트는 지양하고 진정성을 담아주세요.

[답글 예시]
소중한 리뷰 남겨주셔서 감사합니다. 허리 통증으로 많이 불편하셨을 텐데, 치료 후 한결 편안해지셨다니 정말 다행입니다. 말씀해주신 것처럼 앞으로도 꼼꼼하고 정성스러운 진료로 보답하겠습니다. 늘 건강하시길 기원합니다. 감사합니다.

위 가이드에 맞춰 답글 내용만 출력해주세요.
            `;

            console.log('[AI] Calling Gemini API...');
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            console.log('[AI] Draft generated successfully.');
            return { status: 'success', data: text.trim() };
        } catch (error) {
            console.error('[AI] Gemini API Error Details:', error);
            // Log full error object properties if available
            if (error.response) console.error('[AI] Response Error:', error.response);

            // Fallback Template
            console.log('[AI] Switching to fallback template due to error.');
            const fallbackText = `
안녕하세요, ${authorName || '환자'}님. 올본한의원 대표원장입니다.
먼저 소중한 리뷰 남겨주셔서 진심으로 감사드립니다.

불편하셨던 부분이 저희 치료로 도움이 되었다니 정말 다행이고 기쁩니다.
환자분께서 편안하게 진료받으실 수 있도록 앞으로도 늘 정성과 최선을 다하겠습니다.

건강 유의하시고, 항상 좋은 일만 가득하시길 바랍니다.
감사합니다.
            `.trim();

            return {
                status: 'success',
                data: fallbackText,
                message: 'AI 연결 실패로 기본 템플릿이 제공되었습니다.'
            };
        }
    }
};

module.exports = AiReply;
