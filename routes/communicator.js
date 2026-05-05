/**
 * Communicator 로직: 시스템 이벤트를 모든 클라이언트(Socket.io)에게 실시간으로 브로드캐스트합니다.
 */
const express = require('express');
const router = express.Router();

function logSystemEvent(io, eventType, message, data) {
    console.log(`[Socket.io Broadcast: ${eventType}] ${message}`);
    
    // 연결된 모든 클라이언트에게 이벤트 전송
    if (io) {
        io.emit('system:event', {
            type: eventType,
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = router;
module.exports.logSystemEvent = logSystemEvent;

