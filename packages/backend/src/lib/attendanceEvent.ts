import type { AttendanceRecord } from '@prisma/client';
import { prisma } from './prisma';

export interface AttendanceEventPayload {
  id: string;
  studentId: string;
  studentName: string;
  status: string;
  method: string;
  scannedAt: Date;
}

export async function buildAttendanceEventPayload(
  record: AttendanceRecord,
): Promise<AttendanceEventPayload> {
  const student = await prisma.user.findUnique({
    where: { id: record.studentId },
    select: { fullName: true },
  });

  return {
    id: record.id,
    studentId: record.studentId,
    studentName: student?.fullName ?? 'Student',
    status: record.status,
    method: record.method,
    scannedAt: record.scannedAt,
  };
}
