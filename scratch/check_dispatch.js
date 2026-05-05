const pool = require('../config/db');

async function check() {
    try {
        const [rows] = await pool.query("SELECT id, name, chartNo, phone, date, time, updatedAt FROM bookings ORDER BY updatedAt DESC LIMIT 5");
        console.log('--- Recent Bookings ---');
        console.table(rows);

        const [history] = await pool.query("SELECT id, patientName, templateCode, status, message, sentAt FROM message_history ORDER BY sentAt DESC LIMIT 10");
        console.log('--- Recent Message History ---');
        console.table(history);
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
