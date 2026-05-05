
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ENABLED = process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true';

/**
 * Sends a message to the configured Telegram chat.
 * @param {string} message - The message to send.
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function sendTelegramAlert(message) {
    console.log('[Telegram Debug] Attempting to send message. keys:', {
        ENABLED,
        HAS_TOKEN: !!BOT_TOKEN,
        HAS_CHAT_ID: !!CHAT_ID
    });

    if (!ENABLED || !BOT_TOKEN || !CHAT_ID) {
        if (!ENABLED) return false;
        console.warn('Telegram keys are missing. Notification skipped.');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        console.log('[Telegram Debug] Sending request to:', url);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML' // Allows bold/italic formatting
            })
        });

        const data = await response.json();
        console.log('[Telegram Debug] Response:', data);

        if (!data.ok) {
            console.error('Telegram API Error:', data.description);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
        return false;
    }
}

/**
 * Formats survey data into a readable message and sends it.
 * @param {Object} survey - The survey data object.
 */
async function sendSurveyNotification(survey) {
    const stars = '⭐'.repeat(survey.overallSatisfaction || 0);

    let msg = `<b>[진료만족도 설문 접수]</b>\n\n`;
    msg += `<b>환자명:</b> ${survey.patientName || '익명'}\n`;
    msg += `<b>만족도:</b> ${stars} (${survey.overallSatisfaction}점)\n`;

    if (survey.praise) {
        msg += `\n<b>💚 칭찬/좋았던 점:</b>\n${survey.praise}\n`;
    }

    if (survey.improvement) {
        msg += `\n<b>💡 개선/바라는 점:</b>\n${survey.improvement}\n`;
    }

    // Add major specific feedback if it's negative (optional logic, keeping it simple for now)

    return sendTelegramAlert(msg);
}

module.exports = {
    sendTelegramAlert,
    sendSurveyNotification
};
