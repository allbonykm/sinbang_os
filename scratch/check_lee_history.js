const pool = require('../config/db');

async function checkHistory() {
    try {
        const [rows] = await pool.query("SELECT * FROM message_history WHERE patientName LIKE '%이진숙%' ORDER BY sentAt DESC LIMIT 10");
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkHistory();
