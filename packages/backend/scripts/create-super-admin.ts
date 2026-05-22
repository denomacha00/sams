/**
 * Creates or updates the platform Super Admin user.
 *
 * Usage (from packages/backend):
 *   npm run create-super-admin
 *   (runs prisma generate first via package.json script)
 *
 * Reads SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_USERNAME from .env
 * (or uses defaults from .env.example).
 */
import { PrismaClient, PlanTier, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PLATFORM_SCHOOL_CODE = 'SAMS_PLATFORM';

async function main(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL ?? 'admin@smart-managment.com';
  const password = process.env.SUPER_ADMIN_PASSWORD ?? 'SuperAdmin2025';
  const username = process.env.SUPER_ADMIN_USERNAME ?? 'superadmin';

  let school = await prisma.school.findUnique({
    where: { schoolCode: PLATFORM_SCHOOL_CODE },
  });

  if (!school) {
    school = await prisma.school.create({
      data: {
        name: 'SAMS Platform',
        schoolCode: PLATFORM_SCHOOL_CODE,
        planTier: PlanTier.ENTERPRISE,
        licenseExpiresAt: new Date('2099-12-31T00:00:00.000Z'),
      },
    });
    console.log(`Created platform school: ${PLATFORM_SCHOOL_CODE}`);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findFirst({
    where: {
      role: UserRole.SUPER_ADMIN,
      OR: [{ email }, { username }],
    },
  });

  if (existing) {
    const forceReset = process.env.SUPER_ADMIN_FORCE_RESET === 'true';
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(forceReset ? { passwordHash } : {}),
        isLocked: false,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
      },
    });
    console.log(
      forceReset
        ? `Super Admin unlocked and password reset: ${email}`
        : `Super Admin already exists (unlocked): ${email}. Set SUPER_ADMIN_FORCE_RESET=true to reset password.`,
    );
  } else {
    await prisma.user.create({
      data: {
        schoolId: school.id,
        role: UserRole.SUPER_ADMIN,
        fullName: 'Super Admin',
        email,
        username,
        passwordHash,
      },
    });
    console.log(`Super Admin created: ${email} (username: ${username})`);
  }

  console.log('Login at super.smart-managment.com with school code SUPERADMIN (auto-filled by the panel).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
