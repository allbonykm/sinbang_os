const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const dateStr = '2026-04-29';
    const dateObj = new Date(dateStr);
    
    console.log(`Searching for date: ${dateStr}`);
    console.log(`Date object: ${dateObj.toISOString()}`);

    const receipts = await prisma.receipt.findMany({
        where: {
            date: dateObj
        }
    });

    console.log(`Found ${receipts.length} receipts.`);
    receipts.forEach(r => {
        console.log(`ID: ${r.id}, Name: ${r.patientName}, Date: ${r.date.toISOString()}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
