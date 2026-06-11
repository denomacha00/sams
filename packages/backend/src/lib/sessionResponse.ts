import type { AttendanceRecord, AttendanceSession, Class, User } from '@prisma/client';

type SessionWithClass = AttendanceSession & {
  class?: Pick<Class, 'name'> | null;
};

type RecordWithStudent = Pick<AttendanceRecord, 'id' | 'studentId' | 'status' | 'method' | 'scannedAt' | 'note'> & {
  student?: Pick<User, 'fullName'> | null;
};

export interface ClientSessionResponse {
  id: string;
  schoolId: string;
  classId: string;
  className: string | null;
  teacherId: string;
  timetableEntryId: string | null;
  subject: string;
  lateThresholdMin: number;
  locationLat: number | null;
  locationLng: number | null;
  hasGpsAnchor: boolean;
  locationRadiusM: number;
  qrToken: string | null;
  currentQRToken: string | null;
  startedAt: Date;
  endedAt: Date | null;
  isActive: boolean;
}

export interface ClientStudentPreview {
  id: string;
  fullName: string;
  admissionNumber: string | null;
}

export interface ClientAttendanceRecordPreview {
  id: string;
  studentId: string;
  studentName: string;
  status: string;
  method: string;
  scannedAt: Date;
  note: string | null;
}

export function formatSessionForClient(session: SessionWithClass): ClientSessionResponse {
  return {
    id: session.id,
    schoolId: session.schoolId,
    classId: session.classId,
    className: session.class?.name ?? null,
    teacherId: session.teacherId,
    timetableEntryId: session.timetableEntryId,
    subject: session.subject,
    lateThresholdMin: session.lateThresholdMin,
    locationLat: session.locationLat,
    locationLng: session.locationLng,
    hasGpsAnchor: session.locationLat != null && session.locationLng != null,
    locationRadiusM: session.locationRadiusM,
    qrToken: session.currentQRToken,
    currentQRToken: session.currentQRToken,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    isActive: session.isActive,
  };
}

export function formatStudentsForClient(
  students: Array<Pick<User, 'id' | 'fullName' | 'admissionNumber'>>,
): ClientStudentPreview[] {
  return students.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    admissionNumber: s.admissionNumber,
  }));
}

export function formatAttendanceRecordsForClient(
  records: RecordWithStudent[],
): ClientAttendanceRecordPreview[] {
  return records.map((record) => ({
    id: record.id,
    studentId: record.studentId,
    studentName: record.student?.fullName ?? 'Student',
    status: record.status,
    method: record.method,
    scannedAt: record.scannedAt,
    note: record.note,
  }));
}
