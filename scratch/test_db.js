const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const patientCount = await prisma.patients.count();
    console.log('Successfully connected to the database.');
    console.log('Total patients:', patientCount);
  } catch (error) {
    console.error('Failed to connect to the database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
