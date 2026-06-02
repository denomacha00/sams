#!/usr/bin/env node
/**
 * Reset a user's password (safe bcrypt hash, no shell $ expansion).
 *
 * Usage:
 *   cd /var/www/sams
 *   node scripts/reset-password.js greenwood 'NewPassword123'
 */
'use strict';

const bcrypt = require('bcrypt');
const path = require('path');

const backendRoot = path.join(__dirname, '../packages/backend');
process.chdir(backendRoot);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const identifier = process.argv[2];
const newPassword = process.argv[3];
const ROUNDS = 12;

if (!identifier || !newPassword) {
  console.error('Usage: node scripts/reset-password.js <identifier> <newPassword>');
  process.exit(1);
}

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: identifier, mode: 'insensitive' } },
        { email: { equals: identifier, mode: 'insensitive' } },
        { admissionNumber: identifier },
        { phone: identifier },
      ],
    },
  });

  if (!user) {
    console.error('User not found:', identifier);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      failedLoginCount: 0,
      failedLoginWindowStart: null,
      isLocked: false,
    },
  });

  console.log(`Password reset for ${user.username ?? user.email ?? user.id} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
