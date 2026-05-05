const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3333'),
    user: process.env.DB_USER || 'SINGBANG',
    password: process.env.DB_PASS || '1754',
    database: process.env.DB_NAME || 'sinbang_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true, // Date 객체 대신 문자열로 반환 (타임존 오류 방지)
    timezone: '+09:00' // 한국 표준시 설정
});

module.exports = pool;
