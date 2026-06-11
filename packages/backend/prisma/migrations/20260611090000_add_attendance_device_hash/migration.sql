ALTER TABLE "AttendanceRecord" ADD COLUMN "deviceHash" VARCHAR(64);

CREATE UNIQUE INDEX "AttendanceRecord_sessionId_deviceHash_key"
  ON "AttendanceRecord"("sessionId", "deviceHash");
