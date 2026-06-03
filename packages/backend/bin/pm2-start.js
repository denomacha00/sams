#!/usr/bin/env node
/**
 * PM2 entry resolver — loads dist/index.js or legacy dist/backend/src/index.js.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const candidates = [
  path.join(root, 'dist/index.js'),
  path.join(root, 'dist/backend/src/index.js'),
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
