import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.updateMany({
    data: {
      isLocked: false,
      failedLoginCount: 0,
      failedLoginWindowStart: null,
    },
  });
  console.log('All accounts unlocked');
}

main().finally(() => process.exit());
