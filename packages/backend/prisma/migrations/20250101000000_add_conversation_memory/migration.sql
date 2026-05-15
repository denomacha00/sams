-- CreateTable
CREATE TABLE "ConversationThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "encryptedMessage" BYTEA NOT NULL,
    "encryptedResponse" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationThread_userId_schoolId_idx" ON "ConversationThread"("userId", "schoolId");

-- CreateIndex
CREATE INDEX "ConversationThread_userId_updatedAt_idx" ON "ConversationThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ConversationRecord_userId_schoolId_threadId_idx" ON "ConversationRecord"("userId", "schoolId", "threadId");

-- CreateIndex
CREATE INDEX "ConversationRecord_userId_schoolId_createdAt_idx" ON "ConversationRecord"("userId", "schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationRecord_threadId_createdAt_idx" ON "ConversationRecord"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationThread" ADD CONSTRAINT "ConversationThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationThread" ADD CONSTRAINT "ConversationThread_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRecord" ADD CONSTRAINT "ConversationRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRecord" ADD CONSTRAINT "ConversationRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRecord" ADD CONSTRAINT "ConversationRecord_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ConversationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
