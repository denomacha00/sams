#!/bin/bash
# SAMS VPS Setup Script - Run this once on your VPS
# Usage: bash /var/www/sams/setup-vps.sh

cd /var/www/sams

echo "=== SAMS Setup Script ==="
echo ""

# Step 1: Fix .env file
echo "[1/6] Fixing .env file..."
rm -f packages/backend/.env
cat > packages/backend/.env << 'ENVFILE'
DATABASE_URL="postgresql://sams_user:SamsDB@2025Secure@localhost:5432/sams_db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="k8Xp2mN9vQ4wR7tY1uA3bC6dE0fG5hJ8iL2oP4sU7xZ9"
JWT_REFRESH_SECRET="mT3nW6yB9cF2gH5jK8lO1pQ4rS7uV0xA3dE6fI9kM2nP5"
QR_SECRET="qR7sT0uV3wX6yZ9aB2cD5eF8gH1iJ4kL7mN0oP3qR6sT9"
LICENSE_SECRET="lI4cE7nS0eK3rE6tH9aS2hM5aC8kE1yF4oR7gE0nE3rA6"
MPESA_SHORTCODE="4158238"
MPESA_CALLBACK_URL="https://api.smart-managment.com/api/v1/payments/callback"
MPESA_BASE_URL="https://sandbox.safaricom.co.ke"
NODE_ENV="production"
PORT="3001"
CORS_ORIGIN="https://smart-managment.com"
ENVFILE
echo "Done."

# Step 2: Stop PM2
echo "[2/6] Stopping PM2..."
pm2 delete all 2>/dev/null
echo "Done."

# Step 3: Flush Redis
echo "[3/6] Flushing Redis..."
redis-cli FLUSHALL 2>/dev/null
echo "Done."

# Step 4: Push database schema
echo "[4/6] Pushing database schema..."
cd packages/backend
npx prisma db push --accept-data-loss 2>/dev/null
echo "Done."

# Step 5: Unlock accounts and seed super admin
echo "[5/6] Unlocking accounts and seeding super admin..."
npx tsx -e "
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.user.updateMany({ data: { isLocked: false, failedLoginCount: 0, failedLoginWindowStart: null } });
  await prisma.licenseKey.deleteMany({});
  const school = await prisma.school.upsert({ where: { schoolCode: 'SUPERADMIN' }, update: {}, create: { name: 'SAMS System', schoolCode: 'SUPERADMIN', planTier: 'ENTERPRISE', licenseExpiresAt: new Date('2030-12-31') } });
  const hash = await bcrypt.hash('SuperAdmin@2025', 12);
  await prisma.user.upsert({ where: { id: 'super-admin-user' }, update: { passwordHash: hash, isLocked: false, failedLoginCount: 0 }, create: { id: 'super-admin-user', schoolId: school.id, role: 'SUPER_ADMIN', fullName: 'Denis Macharia', email: 'admin@smart-managment.com', passwordHash: hash } });
  console.log('Super Admin ready!');
}
main().catch(console.error).finally(() => process.exit());
"
echo "Done."

# Step 6: Start API with PM2
echo "[6/6] Starting API..."
cd /var/www/sams
pm2 start npx --name sams-api -- tsx /var/www/sams/packages/backend/src/index.ts
pm2 save
sleep 5

# Test
echo ""
echo "=== Testing ==="
curl -s http://localhost:3001/health
echo ""
echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Super Admin Login:"
echo "  URL: https://super.smart-managment.com"
echo "  Email: admin@smart-managment.com"
echo "  Password: SuperAdmin@2025"
echo ""
