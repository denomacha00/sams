-- CreateTable
CREATE TABLE "SchoolClosure" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "schoolId" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolClosure_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "SchoolClosure_schoolId_date_idx" ON "SchoolClosure"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClosure_schoolId_date_key" ON "SchoolClosure"("schoolId", "date");
