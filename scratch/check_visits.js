const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const visits = await prisma.today_visits.findMany({
        take: 5
    });
    console.log('--- Today Visits ---');
    visits.forEach(v => {
        console.log(`ID: ${v.id}, Name: ${v.patientName}, Type: ${typeof v.id}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
