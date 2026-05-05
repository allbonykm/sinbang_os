const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const receipts = await prisma.receipt.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.log('--- Recent Receipts ---');
    receipts.forEach(r => {
        console.log(`ID: ${r.id}, Name: ${r.patientName}, Cash: ${r.cashAmount}, Card: ${r.cardAmount}, Date: ${r.date.toISOString()}, visitId: ${r.visitId}`);
    });

    const expenses = await prisma.expense.findMany({
        take: 5
    });
    console.log('--- Recent Expenses ---');
    expenses.forEach(e => {
        console.log(`ID: ${e.id}, Desc: ${e.description}, Amount: ${e.amount}, Date: ${e.date.toISOString()}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
