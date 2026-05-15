-- AlterTable
ALTER TABLE "AttendanceSession" ADD COLUMN "currentLinkToken" TEXT;
ALTER TABLE "AttendanceSession" ADD COLUMN "linkExpiresAt" TIMESTAMP(3);
