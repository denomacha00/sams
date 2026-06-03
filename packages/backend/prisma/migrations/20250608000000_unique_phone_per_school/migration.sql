-- One phone per school (multiple NULL phones allowed in PostgreSQL)
CREATE UNIQUE INDEX "User_schoolId_phone_key" ON "User"("schoolId", "phone") WHERE "phone" IS NOT NULL;
