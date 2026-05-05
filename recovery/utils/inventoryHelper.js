const pool = require('../config/db');

const communicator = require('../routes/communicator');

// 이름으로 약재 ID 찾기 (Fallback 로직) - DB 버전
async function findHerbIdByName(name) {
    const [rows] = await pool.query('SELECT id FROM herbs WHERE name = ?', [name]);
    return rows.length > 0 ? rows[0].id : null;
}

// 한약재 재고 알림 체크 (2~3회 분량 남았을 때)
async function checkHerbStockAlert(herbId, connection = null) {
    const conn = connection || pool;
    try {
        // 1. 현재 재고 조회
        const [herbRows] = await conn.query('SELECT name, stock FROM herbs WHERE id = ?', [herbId]);
        if (herbRows.length === 0) return;
        const { name, stock } = herbRows[0];

        // 2. 가장 최근 처방에서의 사용량 조회
        const [usageRows] = await conn.query(
            'SELECT totalAmount FROM inventory_outbound WHERE herbId = ? ORDER BY createdAt DESC LIMIT 1',
            [herbId]
        );

        if (usageRows.length === 0) return;
        const lastUsage = parseFloat(usageRows[0].totalAmount);

        if (lastUsage <= 0) return;

        // 3. 임계값 계산 (2회 ~ 3회 분량)
        const thresholdLow = lastUsage * 2;
        const thresholdHigh = lastUsage * 3;

        // 4. 조건 확인: 재고가 2회분 초과 3회분 이하일 때 알림
        if (stock > thresholdLow && stock <= thresholdHigh) {
            console.log(`[Alert] ${name} 재고 부족 알림 대상: 현재 ${stock}g (최근 사용량 ${lastUsage}g)`);

            // 시스템 이벤트 기록 (자동 알림 탭)
            const io = require('../server').io; // server.js에서 io를 가져올 수 있는지 확인 필요
            // 만약 server.js에서 exports 안하면 app.get('io') 사용해야 함.
            // 여기서는 통상적인 communicator.logSystemEvent 사용

            await communicator.logSystemEvent(null, 'inventory:alert', `${name} 재고 확인 : ${parseFloat(stock).toFixed(1)}`, {
                herbId,
                herbName: name,
                currentStock: stock,
                lastUsage,
                thresholdLow,
                thresholdHigh
            });
        }
    } catch (error) {
        console.error(`[Alert] ${herbId} 재고 체크 중 오류:`, error);
    }
}

// 재고 차감 및 출고 기록 처리
// Note: prescription 객체는 DB Insert 후의 데이터(ID 포함)여야 함.
async function processStockDeduction(prescription) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const decoctionDate = prescription.decoctionDate;
        const items = prescription.items || [];
        // JSON parsing handled in route usually, but ensure items is array
        // prescription.items might be a JSON string from DB or object from body.
        // The caller should ensure it's an object/array.

        const doseInfo = prescription.doseInfo || {};
        const doses = parseInt(doseInfo.doses) || 0;

        // 날짜 체크: 과거 처방 차감 건너뛰기 로직 보존
        const targetDate = new Date(decoctionDate || new Date());
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        targetDate.setHours(0, 0, 0, 0);

        if (targetDate < today) {
            console.log(`⚠️ [재고] 과거 날짜 처방이므로 차감 건너뜀 (처방ID: ${prescription.id})`);
            await connection.rollback();
            return false;
        }

        // 중복 차감 방지
        const [existing] = await connection.query('SELECT id FROM inventory_outbound WHERE prescriptionId = ?', [prescription.id]);
        if (existing.length > 0) {
            console.log(`⚠️ [재고] 이미 차감된 처방이므로 중복 차감 건너뜀 (처방ID: ${prescription.id})`);
            await connection.rollback();
            return true; // Already deducted
        }

        let stockUpdated = false;
        const updatedHerbIds = new Set();

        for (const item of items) {
            let herbId = item.herbId;
            let herbName = item.herbName;

            // 1. ID로 재고 확인
            let herbRows = [];
            if (herbId) {
                [herbRows] = await connection.query('SELECT id, name, stock FROM herbs WHERE id = ?', [herbId]);
            }

            // 2. 이름으로 재고 확인 (Fallback)
            if (herbRows.length === 0 && herbName) {
                [herbRows] = await connection.query('SELECT id, name, stock FROM herbs WHERE name = ?', [herbName]);
            }

            if (herbRows.length > 0) {
                const herb = herbRows[0];
                const amountPerDose = parseFloat(item.amountPerDose || item.gramsPerDose || item.amount) || 0;
                const totalAmount = amountPerDose * doses;

                if (totalAmount > 0) {
                    // Update Stock
                    await connection.query('UPDATE herbs SET stock = stock - ? WHERE id = ?', [totalAmount, herb.id]);
                    stockUpdated = true;
                    updatedHerbIds.add(herb.id);

                    // Insert Outbound Record
                    await connection.query(
                        `INSERT INTO inventory_outbound 
                        (prescriptionId, herbId, herbName, totalAmount, patientName, decoctionDate, createdAt)
                        VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                        [
                            prescription.id,
                            herb.id,
                            herb.name,
                            totalAmount,
                            prescription.patientName || '',
                            decoctionDate || new Date()
                        ]
                    );
                }
            } else {
                console.warn(`⚠️ [재고] 약재를 찾을 수 없음: ${herbName} (ID: ${herbId})`);
            }
        }

        await connection.commit();

        if (stockUpdated) {
            console.log(`✅ [재고] 처방ID ${prescription.id}: 차감 완료`);

            // 알림 체크 (트랜잭션 바깥에서 수행)
            for (const hId of updatedHerbIds) {
                checkHerbStockAlert(hId).catch(err => console.error('Alert check failed:', err));
            }

            return true;
        }
        return false;

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ [재고] 차감 처리 중 오류:', error);
        return false;
    } finally {
        if (connection) connection.release();
    }
}

// 재고 복구 (수정/삭제 시)
async function restoreStock(prescription) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. outbound 기록 조회하여 정확한 차감량 복구
        const [outboundRecords] = await connection.query('SELECT * FROM inventory_outbound WHERE prescriptionId = ?', [prescription.id]);

        if (outboundRecords.length === 0) {
            console.log(`ℹ️ [재고] 복구할 출고 기록이 없음 (처방ID: ${prescription.id})`);
            await connection.rollback();
            return false;
        }

        let restored = false;
        const restoredHerbIds = new Set();
        for (const record of outboundRecords) {
            // 재고 증가
            await connection.query('UPDATE herbs SET stock = stock + ? WHERE id = ?', [record.totalAmount, record.herbId]);
            restored = true;
            restoredHerbIds.add(record.herbId);
        }

        // 2. outbound 기록 삭제
        await connection.query('DELETE FROM inventory_outbound WHERE prescriptionId = ?', [prescription.id]);

        await connection.commit();
        console.log(`✅ [재고] 처방ID ${prescription.id}: 재고 복구 및 기록 삭제 완료`);

        if (restored) {
            // 알림 체크
            for (const hId of restoredHerbIds) {
                checkHerbStockAlert(hId).catch(err => console.error('Alert check failed:', err));
            }
        }

        return true;

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ [재고] 복구 처리 중 오류:', error);
        return false;
    } finally {
        if (connection) connection.release();
    }
}

module.exports = {
    processStockDeduction,
    restoreStock,
    findHerbIdByName,
    checkHerbStockAlert
};

