-- Notification send scope metadata + class rep flag
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "scope" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "targetId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "targetRole" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isClassRep" BOOLEAN NOT NULL DEFAULT false;
