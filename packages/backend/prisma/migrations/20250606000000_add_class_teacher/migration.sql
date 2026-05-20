-- AlterTable
ALTER TABLE "classes" ADD COLUMN "classTeacherId" TEXT;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_classTeacherId_fkey" FOREIGN KEY ("classTeacherId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
