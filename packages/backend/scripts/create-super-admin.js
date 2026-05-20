const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const p = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@smart-managment.com';
  const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin2025';
  const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';

  // Create or find the system school
  let school = await p.school.findUnique({ where: { schoolCode: 'SAMS-SYSTEM' } });
  if (!school) {
    school = await p.school.create({
      data: {
        name: 'SAMS System',
        schoolCode: 'SAMS-SYSTEM',
        planTier: 'ENTERPRISE',
        licenseExpiresAt: new Date('2099-12-31'),
      },
    });
    console.log('[seed] Created system school:', school.id);
  }

  // Create or update the super admin user
  const hash = await bcrypt.hash(password, 12);

  const user = await p.user.upsert({
    where: { username },
    update: { passwordHash: hash, role: 'SUPER_ADMIN', email },
    create: {
      schoolId: school.id,
      role: 'SUPER_ADMIN',
      fullName: 'Super Admin',
      username,
      email,
      passwordHash: hash,
    },
  });

  console.log('[seed] Super Admin ensured:');
  console.log('  ID:', user.id);
  console.log('  Email:', user.email);
  console.log('  Username:', user.username);
  console.log('  Role:', user.role);
  console.log('  URL: https://super.smart-managment.com');
}

main()
  .catch((e) => { console.error('[seed] Error:', e.message); process.exit(1); })
  .finally(() => p.$disconnect());
