CREATE TABLE "NotificationAttachment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationAttachment_schoolId_batchId_idx" ON "NotificationAttachment"("schoolId", "batchId");
CREATE INDEX "NotificationAttachment_batchId_idx" ON "NotificationAttachment"("batchId");
CREATE INDEX "NotificationAttachment_senderId_createdAt_idx" ON "NotificationAttachment"("senderId", "createdAt");
