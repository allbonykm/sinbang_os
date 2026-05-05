const pool = require('../config/db');

async function migrate() {
    try {
        console.log('Checking for rejectSms column...');
        const [rows] = await pool.query("SHOW COLUMNS FROM patients LIKE 'rejectSms'");
        if (rows.length === 0) {
            console.log('Adding rejectSms column...');
            await pool.query("ALTER TABLE patients ADD COLUMN rejectSms TINYINT(1) DEFAULT 0");
            console.log('Column added successfully.');
        } else {
            console.log('Column already exists.');
        }
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        process.exit();
    }
}

migrate();
