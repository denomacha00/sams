#!/usr/bin/env node
/**
 * Simulate PM2 injecting an empty JWT_SECRET; verify .env file overrides.
 * Usage: node scripts/test-pm2-env-load.js
 */
'use strict';

const path = require('path');
const { loadEnvFromFile, isWeakEnvValue } = require('../packages/backend/bin/load-env-from-file');

const root = path.join(__dirname, '..');
process.chdir(root);

process.env.JWT_SECRET = '';
process.env.JWT_REFRESH_SECRET = 'short';
process.env.NODE_ENV = 'production';

const envPath = loadEnvFromFile();
if (!envPath) {
  console.error('FAIL: packages/backend/.env not found');
  process.exit(1);
}

const jwt = process.env.JWT_SECRET;
const refresh = process.env.JWT_REFRESH_SECRET;

if (!jwt || jwt === '') {
  console.error('FAIL: JWT_SECRET still empty after load (PM2 empty should be overridden)');
  process.exit(1);
}
if (refresh === 'short') {
  console.error('FAIL: JWT_REFRESH_SECRET still PM2-injected weak value after load');
  process.exit(1);
}

console.log('OK: .env overrides PM2-injected weak/empty secrets');
console.log(`    loaded: ${envPath}`);
console.log(`    JWT_SECRET length: ${jwt.length}`);
console.log(`    JWT_REFRESH_SECRET length: ${refresh?.length ?? 0}`);
if (isWeakEnvValue(jwt)) {
  console.warn('WARN: JWT_SECRET in .env is <64 chars — run set-production-env.sh on VPS');
}
