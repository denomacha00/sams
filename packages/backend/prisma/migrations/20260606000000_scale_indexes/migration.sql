-- Scale indexes for multi-school production traffic.
-- These are idempotent so a partially applied VPS migration can be rerun safely.

CREATE INDEX IF NOT EXISTS "School_isSuspended_idx" ON "School"("isSuspended");
CREATE INDEX IF NOT EXISTS "School_licenseExpiresAt_idx" ON "School"("licenseExpiresAt");
CREATE INDEX IF NOT EXISTS "School_createdAt_idx" ON "School"("createdAt");

CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_schoolId_classId_role_idx" ON "User"("schoolId", "classId", "role");
CREATE INDEX IF NOT EXISTS "User_schoolId_departmentId_role_idx" ON "User"("schoolId", "departmentId", "role");
CREATE INDEX IF NOT EXISTS "User_schoolId_isLocked_idx" ON "User"("schoolId", "isLocked");

CREATE INDEX IF NOT EXISTS "Class_schoolId_departmentId_idx" ON "Class"("schoolId", "departmentId");
CREATE INDEX IF NOT EXISTS "Class_classTeacherId_idx" ON "Class"("classTeacherId");

CREATE INDEX IF NOT EXISTS "TimetableEntry_schoolId_teacherId_dayOfWeek_startTime_idx"
  ON "TimetableEntry"("schoolId", "teacherId", "dayOfWeek", "startTime");
CREATE INDEX IF NOT EXISTS "TimetableEntry_schoolId_classId_dayOfWeek_startTime_idx"
  ON "TimetableEntry"("schoolId", "classId", "dayOfWeek", "startTime");
CREATE INDEX IF NOT EXISTS "TimetableEntry_teacherId_classId_idx" ON "TimetableEntry"("teacherId", "classId");
CREATE INDEX IF NOT EXISTS "TimetableEntry_classId_teacherId_idx" ON "TimetableEntry"("classId", "teacherId");

CREATE INDEX IF NOT EXISTS "AttendanceSession_schoolId_startedAt_idx"
  ON "AttendanceSession"("schoolId", "startedAt");
CREATE INDEX IF NOT EXISTS "AttendanceSession_schoolId_classId_startedAt_idx"
  ON "AttendanceSession"("schoolId", "classId", "startedAt");
CREATE INDEX IF NOT EXISTS "AttendanceSession_schoolId_teacherId_startedAt_idx"
  ON "AttendanceSession"("schoolId", "teacherId", "startedAt");
CREATE INDEX IF NOT EXISTS "AttendanceSession_timetableEntryId_isActive_idx"
  ON "AttendanceSession"("timetableEntryId", "isActive");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_schoolId_scannedAt_idx"
  ON "AttendanceRecord"("schoolId", "scannedAt");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_schoolId_studentId_scannedAt_idx"
  ON "AttendanceRecord"("schoolId", "studentId", "scannedAt");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_schoolId_status_scannedAt_idx"
  ON "AttendanceRecord"("schoolId", "status", "scannedAt");
CREATE INDEX IF NOT EXISTS "RegistrationLink_schoolId_createdById_idx"
  ON "RegistrationLink"("schoolId", "createdById");
CREATE INDEX IF NOT EXISTS "RegistrationLink_schoolId_classId_idx"
  ON "RegistrationLink"("schoolId", "classId");
CREATE INDEX IF NOT EXISTS "RegistrationLink_schoolId_departmentId_idx"
  ON "RegistrationLink"("schoolId", "departmentId");
CREATE INDEX IF NOT EXISTS "RegistrationLink_expiresAt_idx" ON "RegistrationLink"("expiresAt");

CREATE INDEX IF NOT EXISTS "BiometricTemplate_schoolId_idx" ON "BiometricTemplate"("schoolId");

CREATE INDEX IF NOT EXISTS "RiskScore_schoolId_score_idx" ON "RiskScore"("schoolId", "score");
CREATE INDEX IF NOT EXISTS "RiskScore_schoolId_computedAt_idx" ON "RiskScore"("schoolId", "computedAt");

CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON "Payment"("status");
CREATE INDEX IF NOT EXISTS "Payment_schoolId_status_initiatedAt_idx"
  ON "Payment"("schoolId", "status", "initiatedAt");
CREATE INDEX IF NOT EXISTS "Payment_schoolId_initiatedAt_idx" ON "Payment"("schoolId", "initiatedAt");

CREATE INDEX IF NOT EXISTS "Notification_userId_read_createdAt_idx"
  ON "Notification"("userId", "read", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_schoolId_createdAt_idx" ON "Notification"("schoolId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_senderId_createdAt_idx" ON "Notification"("senderId", "createdAt");

CREATE INDEX IF NOT EXISTS "AIKnowledge_schoolId_createdAt_idx" ON "AIKnowledge"("schoolId", "createdAt");
CREATE INDEX IF NOT EXISTS "AIKnowledge_createdById_idx" ON "AIKnowledge"("createdById");
