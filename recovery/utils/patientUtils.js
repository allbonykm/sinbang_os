const pool = require('../config/db');

/**
 * 환자 정보를 기반으로 '성함_차트번호' 형식의 폴더명을 생성합니다.
 * @param {number|string} id auto_insurance_patients 테이블의 고유 ID
 * @returns {Promise<string>} 생성된 폴더명
 */
async function getPatientFolderName(id) {
    try {
        const [rows] = await pool.query('SELECT patientName, chartNo FROM auto_insurance_patients WHERE id = ?', [id]);
        if (rows.length > 0) {
            const p = rows[0];
            const name = p.patientName || 'unknown';
            const chart = p.chartNo || id.toString();
            return `${name}_${chart}`.replace(/[\\/:*?"<>|]/g, '');
        }
    } catch (e) {
        console.error('DB Folder Name Error:', e);
    }
    return id.toString(); // Fallback to ID if DB lookup fails
}

module.exports = {
    getPatientFolderName
};
