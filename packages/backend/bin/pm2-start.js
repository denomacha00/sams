#!/usr/bin/env node
/**
 * PM2 entry — loads packages/backend/.env synchronously, then starts the built app.
 */
const fs = require('fs');
const path = require('path');
const { loadEnvFromFile } = require('./load-env-from-file');

const backendRoot = path.join(__dirname, '..');
const envPath = loadEnvFromFile();
if (!envPath) {
  console.error('[SAMS] Missing packages/backend/.env (cwd:', process.cwd(), ')');
}

const candidates = [
  path.join(backendRoot, 'dist/index.js'),
  path.join(backendRoot, 'dist/backend/src/index.js'),
];

const entry = candidates.find((file) => fs.existsSync(file));
if (!entry) {
  console.error('[SAMS] Backend build not found. Run:');
  console.error('  npm run build -w @sams/shared');
  console.error('  rm -rf packages/backend/dist && npm run build -w @sams/backend');
  console.error('[SAMS] Expected one of:', candidates.join(', '));
  process.exit(1);
}

require(entry);
