import { createId } from '@paralleldrive/cuid2';
import { AttendanceStatus, UserRole } from '@sams/shared';
import { prisma } from './prisma';

/**
 * When a timetable-backed lesson really ends, students without any record become
 * absent. Live QR/link scans stay PRESENT/LATE; true absences are finalized here.
 */
export async function markMissingStudentsAbsentForSessions(sessionIds: string[]): Promise<number> {
  const uniqueSessionIds = [...new Set(sessionIds.filter(Boolean))];
  if (uniqueSessionIds.length === 0) return 0;

  const sessions = await prisma.attendanceSession.findMany({
    where: { id: { in: uniqueSessionIds } },
    select: { id: true, schoolId: true, classId: true },
  });

  let created = 0;
  for (const session of sessions) {
    const [students, records] = await Promise.all([
      prisma.user.findMany({
        where: {
          schoolId: session.schoolId,
          classId: session.classId,
          role: UserRole.STUDENT,
          isLocked: false,
        },
        select: { id: true },
      }),
      prisma.attendanceRecord.findMany({
        where: { sessionId: session.id },
        select: { studentId: true },
      }),
    ]);

    const recordedStudentIds = new Set(records.map((record) => record.studentId));
    const missingStudents = students.filter((student) => !recordedStudentIds.has(student.id));
    if (missingStudents.length === 0) continue;

    const now = new Date();
    const result = await prisma.attendanceRecord.createMany({
      data: missingStudents.map((student) => ({
        id: createId(),
        schoolId: session.schoolId,
        sessionId: session.id,
        studentId: student.id,
        status: AttendanceStatus.ABSENT,
        method: 'AUTO_ABSENT',
        note: 'Marked absent when the timetable lesson ended.',
        scannedAt: now,
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }

  return created;
}
