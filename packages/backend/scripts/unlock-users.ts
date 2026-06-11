import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schoolCode = process.env.SCHOOL_CODE?.trim().toUpperCase();

  const schoolFilter = schoolCode
    ? {
        school: {
          schoolCode,
        },
      }
    : {};

  const before = await prisma.user.count({
    where: {
      ...schoolFilter,
      OR: [
        { isLocked: true },
        { failedLoginCount: { gt: 0 } },
        { failedLoginWindowStart: { not: null } },
      ],
    },
  });

  const result = await prisma.user.updateMany({
    where: {
      ...schoolFilter,
      OR: [
        { isLocked: true },
        { failedLoginCount: { gt: 0 } },
        { failedLoginWindowStart: { not: null } },
      ],
    },
    data: {
      isLocked: false,
      failedLoginCount: 0,
      failedLoginWindowStart: null,
    },
  });

  const scope = schoolCode ? `school ${schoolCode}` : 'all schools';
  console.log(`Unlocked ${result.count} account(s) in ${scope}. Previously blocked/cooldown count: ${before}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
