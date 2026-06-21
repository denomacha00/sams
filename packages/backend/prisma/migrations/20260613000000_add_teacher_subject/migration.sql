-- CreateTable
CREATE TABLE "TeacherSubject" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "TeacherSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE INDEX "TeacherSubject_schoolId_idx" ON "TeacherSubject"("schoolId");

-- CreateIndex
CREATE INDEX "TeacherSubject_teacherId_idx" ON "TeacherSubject"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherSubject_teacherId_subject_key" ON "TeacherSubject"("teacherId", "subject");
