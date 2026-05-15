-- AlterTable: Add scope fields to AIKnowledge
-- Delete existing rows since they have no school/creator association
DELETE FROM "AIKnowledge";

-- Add new scope columns
ALTER TABLE "AIKnowledge" ADD COLUMN "schoolId" TEXT NOT NULL;
ALTER TABLE "AIKnowledge" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "AIKnowledge" ADD COLUMN "classId" TEXT;
ALTER TABLE "AIKnowledge" ADD COLUMN "createdById" TEXT NOT NULL;

-- Update column type constraints
ALTER TABLE "AIKnowledge" ALTER COLUMN "title" TYPE VARCHAR(200);
ALTER TABLE "AIKnowledge" ALTER COLUMN "category" TYPE VARCHAR(50);

-- AddForeignKey
ALTER TABLE "AIKnowledge" ADD CONSTRAINT "AIKnowledge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AIKnowledge" ADD CONSTRAINT "AIKnowledge_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIKnowledge" ADD CONSTRAINT "AIKnowledge_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIKnowledge" ADD CONSTRAINT "AIKnowledge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AIKnowledge_schoolId_idx" ON "AIKnowledge"("schoolId");
CREATE INDEX "AIKnowledge_schoolId_departmentId_idx" ON "AIKnowledge"("schoolId", "departmentId");
CREATE INDEX "AIKnowledge_schoolId_classId_idx" ON "AIKnowledge"("schoolId", "classId");
CREATE INDEX "AIKnowledge_createdById_idx" ON "AIKnowledge"("createdById");
