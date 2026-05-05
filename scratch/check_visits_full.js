const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const visits = await prisma.today_visits.findMany();
    console.log('--- Today Visits ---');
    visits.forEach(v => {
        console.log(`ID: ${v.id}, Name: ${v.patientName}, Chart: ${v.chartNo}, Status: ${v.status}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
