const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- 수납 (Receipts) API ---

// 날짜별 수납 내역 조회
router.get('/receipts', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: '날짜가 필요합니다.' });

        const receipts = await prisma.receipt.findMany({
            where: {
                date: new Date(date)
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        // BigInt serialization
        const serialized = JSON.parse(JSON.stringify(receipts, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));

        res.json({ success: true, data: serialized });
    } catch (error) {
        console.error('수납 조회 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// visitId 기반 수납 내역 조회
router.get('/receipts/visit/:visitId', async (req, res) => {
    try {
        const { visitId } = req.params;
        const receipt = await prisma.receipt.findUnique({
            where: { visitId: BigInt(visitId) }
        });

        // BigInt serialization
        const serialized = receipt ? JSON.parse(JSON.stringify(receipt, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        )) : null;

        res.json({ success: true, data: serialized });
    } catch (error) {
        console.error('내원 기반 수납 조회 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 수납 내역 생성/수정 (Upsert concept)
router.post('/receipts', async (req, res) => {
    try {
        const { id, visitId, patientId, patientName, chartNo, type, procedureDetails, cashAmount, cardAmount, cardName, date } = req.body;

        const data = {
            visitId: visitId ? BigInt(visitId) : null,
            patientId: patientId ? parseInt(patientId) : null,
            patientName,
            chartNo,
            type,
            procedureDetails,
            cashAmount: parseInt(cashAmount) || 0,
            cardAmount: parseInt(cardAmount) || 0,
            cardName,
            date: new Date(date)
        };

        let result;
        if (id) {
            result = await prisma.receipt.update({
                where: { id: parseInt(id) },
                data
            });
        } else {
            result = await prisma.receipt.create({
                data
            });
        }

        // JSON Serialization for BigInt
        const serialized = JSON.parse(JSON.stringify(result, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));

        res.json({ success: true, data: serialized });
    } catch (error) {
        console.error('수납 저장 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 수납 내역 삭제
router.delete('/receipts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.receipt.delete({
            where: { id: parseInt(id) }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('수납 삭제 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// visitId 기반 수납 내역 삭제 (내원 삭제 연동용)
router.delete('/receipts/visit/:visitId', async (req, res) => {
    try {
        const { visitId } = req.params;
        await prisma.receipt.deleteMany({
            where: { visitId: BigInt(visitId) }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('내원 기반 수납 삭제 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// --- 지출 (Expenses) API ---

// 날짜별 지출 내역 조회
router.get('/expenses', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: '날짜가 필요합니다.' });

        const expenses = await prisma.expense.findMany({
            where: {
                date: new Date(date)
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        res.json({ success: true, data: expenses });
    } catch (error) {
        console.error('지출 조회 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 지출 내역 생성/수정
router.post('/expenses', async (req, res) => {
    try {
        const { id, description, amount, date } = req.body;

        const data = {
            description,
            amount: parseInt(amount) || 0,
            date: new Date(date)
        };

        let result;
        if (id) {
            result = await prisma.expense.update({
                where: { id: parseInt(id) },
                data
            });
        } else {
            result = await prisma.expense.create({
                data
            });
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('지출 저장 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 지출 내역 삭제
router.delete('/expenses/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.expense.delete({
            where: { id: parseInt(id) }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('지출 삭제 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// --- 수납 장부 요약 (Summary) API ---
router.get('/receipt-book/summary', async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: '날짜가 필요합니다.' });

        const targetDate = new Date(date);

        // 수납 합계
        const receipts = await prisma.receipt.findMany({
            where: { date: targetDate }
        });

        const totalPatients = receipts.length;
        const cashRecords = receipts.filter(r => r.cashAmount > 0);
        const cardRecords = receipts.filter(r => r.cardAmount > 0);

        const cashCount = cashRecords.length;
        const cashTotal = cashRecords.reduce((sum, r) => sum + (r.cashAmount || 0), 0);
        
        const cardCount = cardRecords.length;
        const cardTotal = cardRecords.reduce((sum, r) => sum + (r.cardAmount || 0), 0);

        const totalRevenue = cashTotal + cardTotal;

        // 지출 합계
        const expenses = await prisma.expense.findMany({
            where: { date: targetDate }
        });
        const expenseTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

        const dailyProfit = totalRevenue - expenseTotal;

        res.json({
            success: true,
            data: {
                date,
                totalPatients,
                cashCount,
                cashTotal,
                cardCount,
                cardTotal,
                totalRevenue,
                expenseTotal,
                dailyProfit
            }
        });
    } catch (error) {
        console.error('요약 조회 오류:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
