-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "senderId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "batchId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_batchId_idx" ON "Notification"("batchId");
CREATE INDEX "Notification_senderId_idx" ON "Notification"("senderId");
