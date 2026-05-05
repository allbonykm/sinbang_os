const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const visits = await prisma.today_visits.findMany();
    console.log('--- Today Visits with Dates ---');
    visits.forEach(v => {
        console.log(`ID: ${v.id}, Name: ${v.patientName}, VisitedAt: ${v.visitedAt ? v.visitedAt.toISOString() : 'N/A'}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
