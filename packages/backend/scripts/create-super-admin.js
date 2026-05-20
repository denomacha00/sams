const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const p = new PrismaClient();

async function main() {
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
    console.log('Created system school:', school.id);
  } else {
    console.log('System school exists:', school.id);
  }

  // Create or update the super admin user
  const password = 'SuperAdmin2025';
  const hash = await bcrypt.hash(password, 12);

  const user = await p.user.upsert({
    where: { username: 'superadmin' },
    update: { passwordHash: hash, role: 'SUPER_ADMIN' },
    create: {
      schoolId: school.id,
      role: 'SUPER_ADMIN',
      fullName: 'Super Admin',
      username: 'superadmin',
      email: 'admin@smart-managment.com',
      passwordHash: hash,
    },
  });

  console.log('Super Admin ready!');
  console.log('  ID:', user.id);
  console.log('  Email:', user.email);
  console.log('  Username:', user.username);
  console.log('  Role:', user.role);
  console.log('  Password: SuperAdmin2025');
  console.log('  URL: https://super.smart-managment.com');
}

main()
  .catch((e) => console.error('Error:', e.message))
  .finally(() => p.$disconnect());
