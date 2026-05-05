
const pool = require('../config/db');
async function test() {
    try {
        const [rows] = await pool.query("SELECT * FROM patients WHERE name = '김태호'");
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
test();
