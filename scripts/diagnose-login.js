#!/usr/bin/env node
/**
 * Diagnose login for an identifier — DB lookup, bcrypt, authService, and HTTP.
 *
 * Usage (on server):
 *   cd /var/www/sams/packages/backend
 *   node ../../scripts/diagnose-login.js greenwood 'YourPassword'
 */
'use strict';

const bcrypt = require('bcrypt');
const path = require('path');

const backendRoot = path.join(__dirname, '../packages/backend');
process.chdir(backendRoot);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const identifier = process.argv[2];
const password = process.argv[3];
const port = process.env.PORT || 3001;

if (!identifier || !password) {
  console.error('Usage: node scripts/diagnose-login.js <identifier> <password>');
  process.exit(1);
}

async function main() {
  console.log('=== SAMS login diagnostic ===');
  console.log('identifier:', identifier);
  console.log('OTP_LOGIN_ENABLED env:', process.env.OTP_LOGIN_ENABLED ?? '(unset)');
  console.log('NODE_ENV:', process.env.NODE_ENV ?? '(unset)');
  console.log('');

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { equals: identifier, mode: 'insensitive' } },
        { email: { equals: identifier, mode: 'insensitive' } },
        { admissionNumber: identifier },
        { phone: identifier },
      ],
    },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      role: true,
      isLocked: true,
      failedLoginCount: true,
      passwordHash: true,
    },
    take: 5,
  });

  console.log(`DB matches: ${users.length}`);
  for (const u of users) {
    const ok = u.passwordHash ? await bcrypt.compare(password, u.passwordHash) : false;
    console.log(
      `  - id=${u.id} username=${u.username ?? ''} role=${u.role} locked=${u.isLocked} bcrypt=${ok ? 'YES' : 'NO'}`,
    );
  }
  console.log('');

  try {
    const { authService } = require(path.join(backendRoot, 'dist/services/authService'));
    await authService.login('', identifier, password);
    console.log('authService.login: OK');
  } catch (e) {
    console.log('authService.login: FAIL —', e.message);
  }
  console.log('');

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const body = await res.text();
    console.log(`HTTP POST /api/v1/auth/login: ${res.status}`);
    console.log(body.slice(0, 500));
  } catch (e) {
    console.log('HTTP login: FAIL —', e.message);
  }

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const h = await health.json();
    console.log('');
    console.log('Health OTP flags:', h.otp ?? h.checks ?? h);
  } catch {
    // ignore
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
