#!/bin/bash
set -e
ROOT=/var/www/sams
cd $ROOT

# Stash any local changes (compiled dist files etc) so git pull succeeds
git stash

git pull origin main
npm ci --production=false

# Build each package from root to avoid cd path issues
npm run build --workspace=packages/backend
npm run build --workspace=packages/frontend
npm run build --workspace=packages/super-admin

ls packages/backend/dist/index.js || { echo "Backend build FAILED"; exit 1; }

cd $ROOT/packages/backend
npx prisma generate
npx prisma migrate deploy
cd $ROOT

pm2 reload ecosystem.config.js --env production
echo "Deploy complete!"
