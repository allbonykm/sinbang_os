const pool = require('../config/db');

async function check() {
    try {
        const [rows] = await pool.query("SELECT id, name, chartNo, hasKakao, rejectSms FROM patients WHERE name = '김태호'");
        console.log('Results for 김태호:', JSON.stringify(rows, null, 2));
    } catch (error) {
        console.error('Check failed:', error);
    } finally {
        process.exit();
    }
}

check();
