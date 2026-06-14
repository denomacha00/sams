import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
}

export interface AttendanceEvidenceRow {
  sessionId: string;
  recordId: string | null;
  date: string;
  subject: string;
  classId: string | null;
  className: string | null;
  teacherName: string | null;
  status: AttendanceStatusKey;
  method: string | null;
  scannedAt: string | null;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  note: string | null;
}

export interface StudentReportData {
  studentId: string;
  studentName: string;
  totalSessions: number;
  totalExpected: number;
  totalPresent: number;
  totalLate: number;
  totalExcused: number;
  totalAbsent: number;
  attendancePercentage: number;
  records?: AttendanceEvidenceRow[];
}

export interface ClassReportData {
  classId: string;
  className: string;
  totalSessions: number;
  students: StudentReportData[];
  averageAttendancePercentage: number;
}

export interface DepartmentReportData {
  departmentId: string;
  departmentName: string;
  totalSessions: number;
  classes: ClassReportData[];
  averageAttendancePercentage: number;
}

export interface SchoolReportData {
  schoolId: string;
  schoolName: string;
  totalSessions: number;
  departments: DepartmentReportData[];
  averageAttendancePercentage: number;
}

// ─── Report Service ───────────────────────────────────────────────────────────

type AttendanceStatusKey = 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT';
type StatusCounts = Partial<Record<AttendanceStatusKey, number>>;
type StudentSeed = { id: string; fullName: string; classId?: string | null };
type ClassSeed = { id: string; name: string; departmentId?: string | null };
type ClassReportBuildOptions = { includeEvidence?: boolean };
type EvidenceSessionSeed = {
  id: string;
  classId: string;
  subject: string;
  startedAt: Date;
  endedAt: Date | null;
  class: { name: string } | null;
  teacher: { fullName: string } | null;
  records: Array<{
    id: string;
    studentId: string;
    status: string;
    method: string;
    scannedAt: Date;
    note: string | null;
  }>;
};

function withDateRange<T extends object>(
  where: T,
  field: 'scannedAt' | 'startedAt',
  dateRange?: DateRange,
): T {
  if (!dateRange) return where;
  return {
    ...where,
    [field]: {
      gte: dateRange.from,
      lte: dateRange.to,
    },
  } as T;
}

function sumStatusCounts(counts: StatusCounts): number {
  return (counts.PRESENT ?? 0) + (counts.LATE ?? 0) + (counts.EXCUSED ?? 0) + (counts.ABSENT ?? 0);
}

export function calculateAttendancePercentage(
  totalPresent: number,
  totalLate: number,
  totalExpected: number,
): number {
  return totalExpected > 0
    ? Math.round(((totalPresent + totalLate) / totalExpected) * 100 * 100) / 100
    : 0;
}

function buildStudentReport(student: StudentSeed, counts: StatusCounts, totalSessions: number): StudentReportData {
  const totalPresent = counts.PRESENT ?? 0;
  const totalLate = counts.LATE ?? 0;
  const totalExcused = counts.EXCUSED ?? 0;
  const totalExpected = totalSessions > 0 ? totalSessions : sumStatusCounts(counts);
  const attendancePercentage = calculateAttendancePercentage(totalPresent, totalLate, totalExpected);

  return {
    studentId: student.id,
    studentName: student.fullName,
    totalSessions: totalExpected,
    totalExpected,
    totalPresent,
    totalLate,
    totalExcused,
    totalAbsent: Math.max(0, totalExpected - totalPresent - totalLate - totalExcused),
    attendancePercentage,
  };
}

function averageAttendance(
  reports: Array<{ attendancePercentage?: number; averageAttendancePercentage?: number }>,
): number {
  if (reports.length === 0) return 0;
  const total = reports.reduce(
    (sum, report) => sum + (report.attendancePercentage ?? report.averageAttendancePercentage ?? 0),
    0,
  );
  return Math.round((total / reports.length) * 100) / 100;
}

export class ReportService {
  /**
   * Get attendance report for a single student.
   * Attendance % = (totalPresent / totalExpected) * 100, rounded to 2 dp
   * Requirements: 10.1, 10.5, 10.7
   */
  async getStudentReport(schoolId: string, studentId: string, dateRange?: DateRange): Promise<StudentReportData> {
    const recordWhere = withDateRange<Prisma.AttendanceRecordWhereInput>({
      studentId,
      schoolId,
    }, 'scannedAt', dateRange);

    const [student, statusRows] = await Promise.all([
      prisma.user.findUnique({
        where: { id: studentId },
        select: { id: true, fullName: true, schoolId: true, classId: true },
      }),
      prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: recordWhere,
        _count: { _all: true },
      }),
    ]);

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    if (student.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    const counts: StatusCounts = {};
    for (const row of statusRows) {
      counts[row.status as AttendanceStatusKey] = row._count._all;
    }

    let totalSessions = 0;
    let evidenceRows: AttendanceEvidenceRow[] = [];
    if (student.classId) {
      const sessionWhere = withDateRange<Prisma.AttendanceSessionWhereInput>({
        schoolId,
        classId: student.classId,
      }, 'startedAt', dateRange);
      const sessions = await prisma.attendanceSession.findMany({
        where: sessionWhere,
        select: {
          id: true,
          classId: true,
          subject: true,
          startedAt: true,
          endedAt: true,
          class: { select: { name: true } },
          teacher: { select: { fullName: true } },
          records: {
            where: { studentId },
            select: {
              id: true,
              status: true,
              method: true,
              scannedAt: true,
              note: true,
            },
          },
        },
        orderBy: { startedAt: 'desc' },
      });
      totalSessions = sessions.length;
      evidenceRows = sessions.map((session) => {
        const record = session.records[0];
        return {
          sessionId: session.id,
          recordId: record?.id ?? null,
          date: session.startedAt.toISOString().slice(0, 10),
          subject: session.subject,
          classId: session.classId,
          className: session.class?.name ?? null,
          teacherName: session.teacher?.fullName ?? null,
          status: (record?.status ?? 'ABSENT') as AttendanceStatusKey,
          method: record?.method ?? null,
          scannedAt: record?.scannedAt?.toISOString() ?? null,
          sessionStartedAt: session.startedAt.toISOString(),
          sessionEndedAt: session.endedAt?.toISOString() ?? null,
          note: record?.note ?? null,
        };
      });
    }

    // totalExpected is the number of sessions the student should have attended
    const totalExpected = totalSessions > 0 ? totalSessions : sumStatusCounts(counts);

    const totalPresent = counts.PRESENT ?? 0;
    const totalLate = counts.LATE ?? 0;
    const totalExcused = counts.EXCUSED ?? 0;
    const totalAbsent = totalExpected - totalPresent - totalLate - totalExcused;

    // Attendance percentage treats PRESENT and LATE as attended lessons.
    // Per Requirement 10.5: (Total Present / Total Expected) × 100
    const attendancePercentage = calculateAttendancePercentage(totalPresent, totalLate, totalExpected);

    return {
      studentId,
      studentName: student.fullName,
      totalSessions: totalExpected,
      totalExpected,
      totalPresent,
      totalLate,
      totalExcused,
      totalAbsent: Math.max(0, totalAbsent),
      attendancePercentage,
      records: evidenceRows,
    };
  }

  /**
   * Get attendance report for a class.
   * Aggregates attendance data for all students in the class.
   * Requirements: 10.2, 10.5, 10.7
   */
  async getClassReport(schoolId: string, classId: string, dateRange?: DateRange): Promise<ClassReportData> {
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, name: true, schoolId: true },
    });

    if (!classData) {
      throw new AppError(404, 'CLASS_NOT_FOUND', 'Class not found');
    }

    if (classData.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    const reports = await this._buildClassReports(
      schoolId,
      [{ id: classData.id, name: classData.name }],
      dateRange,
      { includeEvidence: true },
    );

    return reports[0] ?? {
      classId,
      className: classData.name,
      totalSessions: 0,
      students: [],
      averageAttendancePercentage: 0,
    };
  }

  /**
   * Get attendance report for a department.
   * Aggregates attendance data across all classes in the department.
   * Requirements: 10.3, 10.5, 10.7
   */
  async getDepartmentReport(schoolId: string, departmentId: string, dateRange?: DateRange): Promise<DepartmentReportData> {
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true, name: true, schoolId: true },
    });

    if (!department) {
      throw new AppError(404, 'DEPARTMENT_NOT_FOUND', 'Department not found');
    }

    if (department.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    const classes = await prisma.class.findMany({
      where: { schoolId, departmentId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const classReports = await this._buildClassReports(schoolId, classes, dateRange);

    return {
      departmentId,
      departmentName: department.name,
      totalSessions: classReports.reduce((sum, report) => sum + report.totalSessions, 0),
      classes: classReports,
      averageAttendancePercentage: averageAttendance(classReports),
    };
  }

  /**
   * Get attendance report for the entire school.
   * Aggregates attendance data across all departments in the school.
   * Requirements: 10.4, 10.5, 10.7
   */
  async getSchoolReport(schoolId: string, dateRange?: DateRange): Promise<SchoolReportData> {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });

    if (!school) {
      throw new AppError(404, 'SCHOOL_NOT_FOUND', 'School not found');
    }

    const [departments, classes] = await Promise.all([
      prisma.department.findMany({
        where: { schoolId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.class.findMany({
        where: { schoolId },
        select: { id: true, name: true, departmentId: true },
        orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const allClassReports = await this._buildClassReports(schoolId, classes, dateRange);
    const classReportById = new Map(allClassReports.map((report) => [report.classId, report]));
    const reportsByDepartment = new Map<string, ClassReportData[]>();
    for (const cls of classes) {
      const report = classReportById.get(cls.id);
      if (!report) continue;
      const reports = reportsByDepartment.get(cls.departmentId) ?? [];
      reports.push(report);
      reportsByDepartment.set(cls.departmentId, reports);
    }

    const departmentReports = departments.map((dept) => {
      const classReports = reportsByDepartment.get(dept.id) ?? [];
      return {
        departmentId: dept.id,
        departmentName: dept.name,
        totalSessions: classReports.reduce((sum, report) => sum + report.totalSessions, 0),
        classes: classReports,
        averageAttendancePercentage: averageAttendance(classReports),
      };
    });

    return {
      schoolId,
      schoolName: school.name,
      totalSessions: departmentReports.reduce((sum, report) => sum + report.totalSessions, 0),
      departments: departmentReports,
      averageAttendancePercentage: averageAttendance(departmentReports),
    };
  }

  private async _buildClassReports(
    schoolId: string,
    classes: ClassSeed[],
    dateRange?: DateRange,
    options: ClassReportBuildOptions = {},
  ): Promise<ClassReportData[]> {
    if (classes.length === 0) return [];

    const classIds = classes.map((cls) => cls.id);
    const sessionWhere = withDateRange<Prisma.AttendanceSessionWhereInput>({
      schoolId,
      classId: { in: classIds },
    }, 'startedAt', dateRange);

    const [sessionRows, students, evidenceSessions] = await Promise.all([
      prisma.attendanceSession.groupBy({
        by: ['classId'],
        where: sessionWhere,
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: { schoolId, classId: { in: classIds }, role: 'STUDENT' },
        select: { id: true, fullName: true, classId: true },
        orderBy: [{ classId: 'asc' }, { fullName: 'asc' }],
      }),
      options.includeEvidence
        ? prisma.attendanceSession.findMany({
            where: sessionWhere,
            select: {
              id: true,
              classId: true,
              subject: true,
              startedAt: true,
              endedAt: true,
              class: { select: { name: true } },
              teacher: { select: { fullName: true } },
              records: {
                where: { student: { role: 'STUDENT' } },
                select: {
                  id: true,
                  studentId: true,
                  status: true,
                  method: true,
                  scannedAt: true,
                  note: true,
                },
              },
            },
            orderBy: { startedAt: 'desc' },
          })
        : Promise.resolve([] as EvidenceSessionSeed[]),
    ]);

    const sessionCountByClass = new Map<string, number>(
      sessionRows.map((row) => [row.classId, row._count._all]),
    );

    const studentsByClass = new Map<string, StudentSeed[]>();
    const studentIds: string[] = [];
    for (const student of students) {
      if (!student.classId) continue;
      studentIds.push(student.id);
      const rows = studentsByClass.get(student.classId) ?? [];
      rows.push(student);
      studentsByClass.set(student.classId, rows);
    }

    const sessionsByClass = new Map<string, EvidenceSessionSeed[]>();
    if (options.includeEvidence) {
      for (const session of evidenceSessions as EvidenceSessionSeed[]) {
        const rows = sessionsByClass.get(session.classId) ?? [];
        rows.push(session);
        sessionsByClass.set(session.classId, rows);
      }
    }

    const buildEvidenceRows = (student: StudentSeed): AttendanceEvidenceRow[] => {
      if (!options.includeEvidence || !student.classId) return [];
      const sessions = sessionsByClass.get(student.classId) ?? [];
      return sessions.map((session) => {
        const record = session.records.find((row) => row.studentId === student.id);
        return {
          sessionId: session.id,
          recordId: record?.id ?? null,
          date: session.startedAt.toISOString().slice(0, 10),
          subject: session.subject,
          classId: session.classId,
          className: session.class?.name ?? null,
          teacherName: session.teacher?.fullName ?? null,
          status: (record?.status ?? 'ABSENT') as AttendanceStatusKey,
          method: record?.method ?? null,
          scannedAt: record?.scannedAt?.toISOString() ?? null,
          sessionStartedAt: session.startedAt.toISOString(),
          sessionEndedAt: session.endedAt?.toISOString() ?? null,
          note: record?.note ?? null,
        };
      });
    };

    const countsByStudent = new Map<string, StatusCounts>();
    if (studentIds.length > 0) {
      const recordWhere = withDateRange<Prisma.AttendanceRecordWhereInput>({
        schoolId,
        studentId: { in: studentIds },
      }, 'scannedAt', dateRange);

      const recordRows = await prisma.attendanceRecord.groupBy({
        by: ['studentId', 'status'],
        where: recordWhere,
        _count: { _all: true },
      });

      for (const row of recordRows) {
        const counts = countsByStudent.get(row.studentId) ?? {};
        counts[row.status as AttendanceStatusKey] = row._count._all;
        countsByStudent.set(row.studentId, counts);
      }
    }

    return classes.map((cls) => {
      const totalSessions = sessionCountByClass.get(cls.id) ?? 0;
      const studentReports = (studentsByClass.get(cls.id) ?? []).map((student) => {
        const report = buildStudentReport(student, countsByStudent.get(student.id) ?? {}, totalSessions);
        if (options.includeEvidence) {
          report.records = buildEvidenceRows(student);
        }
        return report;
      });

      return {
        classId: cls.id,
        className: cls.name,
        totalSessions,
        students: studentReports,
        averageAttendancePercentage: averageAttendance(studentReports),
      };
    });
  }

  /**
   * Export report by reportId and format.
   * reportId format: "type:schoolId:targetId" (e.g., "student:school-1:student-1")
   * For school reports: "school:school-1"
   * Accepts optional dateRange encoded as query params in the reportId or as a separate param.
   * Requirements: 10.6
   */
  async exportReportById(reportId: string, format: 'pdf' | 'excel' | 'csv', dateRange?: DateRange): Promise<Buffer> {
    const parts = reportId.split(':');
    if (parts.length < 2) {
      throw new AppError(400, 'INVALID_REPORT_ID', 'Report ID must be in format "type:schoolId:targetId"');
    }

    const [type, schoolId, targetId] = parts;

    let reportData: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData;

    switch (type) {
      case 'student':
        if (!targetId) throw new AppError(400, 'INVALID_REPORT_ID', 'Student report requires a targetId');
        reportData = await this.getStudentReport(schoolId, targetId, dateRange);
        break;
      case 'class':
        if (!targetId) throw new AppError(400, 'INVALID_REPORT_ID', 'Class report requires a targetId');
        reportData = await this.getClassReport(schoolId, targetId, dateRange);
        break;
      case 'department':
        if (!targetId) throw new AppError(400, 'INVALID_REPORT_ID', 'Department report requires a targetId');
        reportData = await this.getDepartmentReport(schoolId, targetId, dateRange);
        break;
      case 'school':
        reportData = await this.getSchoolReport(schoolId, dateRange);
        break;
      default:
        throw new AppError(400, 'INVALID_REPORT_ID', `Unknown report type: ${type}`);
    }

    return this.exportReport(reportData, format);
  }

  /**
   * Export report data to PDF, Excel, or CSV format.
   * Requirements: 10.6
   */
  async exportReport(data: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData, format: 'pdf' | 'excel' | 'csv'): Promise<Buffer> {
    if (format === 'pdf') {
      return this._exportPDF(data);
    } else if (format === 'excel') {
      return this._exportExcel(data);
    } else {
      return this._exportCSV(data);
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private _exportPDF(data: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      doc.fontSize(20).text('SAMS Attendance Report', { align: 'center' });
      doc.moveDown();

      // Report content
      if ('studentName' in data) {
        // Student report
        doc.fontSize(14).text(`Student: ${data.studentName}`);
        doc.moveDown(0.5);
        doc.fontSize(12);
        doc.text(`Total Expected: ${data.totalExpected}`);
        doc.text(`Present: ${data.totalPresent}`);
        doc.text(`Late: ${data.totalLate}`);
        doc.text(`Excused: ${data.totalExcused}`);
        doc.text(`Absent: ${data.totalAbsent}`);
        doc.moveDown(0.5);
        doc.fontSize(14).text(`Attendance: ${data.attendancePercentage}%`);
        if (data.records?.length) {
          doc.moveDown();
          doc.fontSize(13).text('Daily Evidence');
          doc.moveDown(0.25);
          for (const row of data.records.slice(0, 80)) {
            const marked = row.scannedAt ? new Date(row.scannedAt).toLocaleString('en-GB') : 'Not marked';
            doc.fontSize(9).text(
              `${row.date} | ${row.subject} | ${row.status} | ${row.method ?? 'ABSENT'} | ${marked}`,
            );
          }
          if (data.records.length > 80) {
            doc.fontSize(9).text(`...and ${data.records.length - 80} more row(s). Export Excel for the full detail.`);
          }
        }
      } else if ('className' in data) {
        // Class report — includes student rows
        doc.fontSize(14).text(`Class: ${data.className}`);
        doc.text(`Total Sessions: ${data.totalSessions}`);
        doc.text(`Average Attendance: ${data.averageAttendancePercentage}%`);
        doc.moveDown();
        doc.fontSize(11).text('Student Summary');
        doc.moveDown(0.25);
        for (const student of data.students) {
          doc.fontSize(9).text(
            `${student.studentName} | Expected ${student.totalExpected} | Present ${student.totalPresent} | Late ${student.totalLate} | Excused ${student.totalExcused} | Absent ${student.totalAbsent} | ${student.attendancePercentage}%`,
          );
        }

        const evidenceRows = data.students.flatMap((student) =>
          (student.records ?? []).map((row) => ({ studentName: student.studentName, row })),
        );
        if (evidenceRows.length) {
          doc.moveDown();
          doc.fontSize(11).text('Daily Evidence Preview');
          doc.moveDown(0.25);
          for (const { studentName, row } of evidenceRows.slice(0, 120)) {
            const marked = row.scannedAt ? new Date(row.scannedAt).toLocaleString('en-GB') : 'Not marked';
            doc.fontSize(8).text(
              `${row.date} | ${studentName} | ${row.subject} | ${row.status} | ${row.method ?? 'ABSENT'} | ${marked}`,
            );
          }
          if (evidenceRows.length > 120) {
            doc.fontSize(8).text(`...and ${evidenceRows.length - 120} more row(s). Export Excel for the full detail.`);
          }
        }
      } else if ('departmentName' in data) {
        // Department report — includes per-student breakdown per class
        doc.fontSize(14).text(`Department: ${data.departmentName}`);
        doc.text(`Total Sessions: ${data.totalSessions}`);
        doc.text(`Average Attendance: ${data.averageAttendancePercentage}%`);
        doc.moveDown();

        // Compute aggregate counts
        let deptPresent = 0, deptLate = 0, deptExcused = 0, deptAbsent = 0;
        for (const cls of data.classes) {
          for (const student of cls.students ?? []) {
            deptPresent += student.totalPresent ?? 0;
            deptLate += student.totalLate ?? 0;
            deptExcused += student.totalExcused ?? 0;
            deptAbsent += student.totalAbsent ?? 0;
          }
        }
        doc.fontSize(12).text(`Total Present: ${deptPresent}`);
        doc.text(`Total Late: ${deptLate}`);
        doc.text(`Total Excused: ${deptExcused}`);
        doc.text(`Total Absent: ${deptAbsent}`);
        doc.moveDown();

        // Per-class student breakdown
        for (const cls of data.classes) {
          doc.fontSize(13).text(`${cls.className} — Avg ${cls.averageAttendancePercentage}%`);
          doc.moveDown(0.2);
          if (cls.students?.length) {
            for (const student of cls.students) {
              doc.fontSize(8).text(
                `${student.studentName} | Expected ${student.totalExpected} | Present ${student.totalPresent} | Late ${student.totalLate} | Excused ${student.totalExcused} | Absent ${student.totalAbsent} | ${student.attendancePercentage}%`,
              );
            }
          } else {
            doc.fontSize(8).text('(No student records for this class)');
          }
          doc.moveDown(0.5);
        }
      } else {
        // School report — department + class + student breakdown
        doc.fontSize(14).text(`School: ${data.schoolName}`);
        doc.text(`Total Sessions: ${data.totalSessions}`);
        doc.text(`Average Attendance: ${data.averageAttendancePercentage}%`);
        doc.moveDown();

        // Compute aggregate counts
        let schoolPresent = 0, schoolLate = 0, schoolExcused = 0, schoolAbsent = 0;
        for (const dept of data.departments) {
          for (const cls of dept.classes ?? []) {
            for (const student of cls.students ?? []) {
              schoolPresent += student.totalPresent ?? 0;
              schoolLate += student.totalLate ?? 0;
              schoolExcused += student.totalExcused ?? 0;
              schoolAbsent += student.totalAbsent ?? 0;
            }
          }
        }
        doc.fontSize(12).text(`Total Present: ${schoolPresent}`);
        doc.text(`Total Late: ${schoolLate}`);
        doc.text(`Total Excused: ${schoolExcused}`);
        doc.text(`Total Absent: ${schoolAbsent}`);
        doc.moveDown();

        // Per-department → per-class → per-student breakdown
        for (const dept of data.departments) {
          doc.fontSize(13).text(`${dept.departmentName} — Avg ${dept.averageAttendancePercentage}%`);
          doc.moveDown(0.2);
          for (const cls of dept.classes ?? []) {
            doc.fontSize(10).text(`  ${cls.className} — Avg ${cls.averageAttendancePercentage}%`);
            if (cls.students?.length) {
              for (const student of cls.students) {
                doc.fontSize(7).text(
                  `    ${student.studentName} | P${student.totalPresent} L${student.totalLate} E${student.totalExcused} A${student.totalAbsent} | ${student.attendancePercentage}%`,
                );
              }
            }
            doc.moveDown(0.3);
          }
        }
      }

      doc.end();
    });
  }

  private async _exportExcel(data: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance Report');

    if ('studentName' in data) {
      // Student report
      sheet.columns = [
        { header: 'Metric', key: 'metric', width: 25 },
        { header: 'Value', key: 'value', width: 15 },
      ];
      sheet.addRow({ metric: 'Student', value: data.studentName });
      sheet.addRow({ metric: 'Total Expected', value: data.totalExpected });
      sheet.addRow({ metric: 'Present', value: data.totalPresent });
      sheet.addRow({ metric: 'Late', value: data.totalLate });
      sheet.addRow({ metric: 'Excused', value: data.totalExcused });
      sheet.addRow({ metric: 'Absent', value: data.totalAbsent });
      sheet.addRow({ metric: 'Attendance %', value: data.attendancePercentage });
      if (data.records?.length) {
        const detailSheet = workbook.addWorksheet('Daily Evidence');
        detailSheet.columns = [
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Subject', key: 'subject', width: 28 },
          { header: 'Class', key: 'className', width: 20 },
          { header: 'Teacher', key: 'teacherName', width: 24 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Method', key: 'method', width: 14 },
          { header: 'Marked At', key: 'scannedAt', width: 24 },
          { header: 'Note', key: 'note', width: 32 },
        ];
        for (const row of data.records) {
          detailSheet.addRow({
            date: row.date,
            subject: row.subject,
            className: row.className ?? '',
            teacherName: row.teacherName ?? '',
            status: row.status,
            method: row.method ?? '',
            scannedAt: row.scannedAt ?? '',
            note: row.note ?? '',
          });
        }
      }
    } else if ('className' in data) {
      // Class report
      sheet.columns = [
        { header: 'Student', key: 'student', width: 30 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Present', key: 'present', width: 12 },
        { header: 'Late', key: 'late', width: 12 },
        { header: 'Excused', key: 'excused', width: 12 },
        { header: 'Absent', key: 'absent', width: 12 },
        { header: 'Attendance %', key: 'percentage', width: 15 },
      ];
      for (const student of data.students) {
        sheet.addRow({
          student: student.studentName,
          expected: student.totalExpected,
          present: student.totalPresent,
          late: student.totalLate,
          excused: student.totalExcused,
          absent: student.totalAbsent,
          percentage: student.attendancePercentage,
        });
      }
      const evidenceRows = data.students.flatMap((student) =>
        (student.records ?? []).map((row) => ({ studentName: student.studentName, row })),
      );
      if (evidenceRows.length) {
        const detailSheet = workbook.addWorksheet('Daily Evidence');
        detailSheet.columns = [
          { header: 'Student', key: 'student', width: 30 },
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Subject', key: 'subject', width: 28 },
          { header: 'Teacher', key: 'teacherName', width: 24 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Method', key: 'method', width: 14 },
          { header: 'Marked At', key: 'scannedAt', width: 24 },
          { header: 'Note', key: 'note', width: 32 },
        ];
        for (const { studentName, row } of evidenceRows) {
          detailSheet.addRow({
            student: studentName,
            date: row.date,
            subject: row.subject,
            teacherName: row.teacherName ?? '',
            status: row.status,
            method: row.method ?? '',
            scannedAt: row.scannedAt ?? '',
            note: row.note ?? '',
          });
        }
      }
    } else if ('departmentName' in data) {
      // Department report
      sheet.columns = [
        { header: 'Class', key: 'className', width: 30 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Present', key: 'present', width: 12 },
        { header: 'Late', key: 'late', width: 12 },
        { header: 'Excused', key: 'excused', width: 12 },
        { header: 'Absent', key: 'absent', width: 12 },
        { header: 'Average Attendance %', key: 'percentage', width: 20 },
      ];
      // Add a summary row
      let deptPresent = 0, deptLate = 0, deptExcused = 0, deptAbsent = 0, deptExpected = 0;
      for (const cls of data.classes) {
        let clsPresent = 0, clsLate = 0, clsExcused = 0, clsAbsent = 0, clsExpected = 0;
        for (const student of cls.students ?? []) {
          clsPresent += student.totalPresent ?? 0;
          clsLate += student.totalLate ?? 0;
          clsExcused += student.totalExcused ?? 0;
          clsAbsent += student.totalAbsent ?? 0;
          clsExpected += student.totalExpected ?? 0;
        }
        deptPresent += clsPresent;
        deptLate += clsLate;
        deptExcused += clsExcused;
        deptAbsent += clsAbsent;
        deptExpected += clsExpected;
        sheet.addRow({
          className: cls.className,
          expected: clsExpected,
          present: clsPresent,
          late: clsLate,
          excused: clsExcused,
          absent: clsAbsent,
          percentage: cls.averageAttendancePercentage,
        });
      }
      sheet.addRow({
        className: 'TOTAL',
        expected: deptExpected,
        present: deptPresent,
        late: deptLate,
        excused: deptExcused,
        absent: deptAbsent,
        percentage: data.averageAttendancePercentage,
      });

      const detailSheet = workbook.addWorksheet('Student Details');
      detailSheet.columns = [
        { header: 'Class', key: 'className', width: 28 },
        { header: 'Student', key: 'student', width: 30 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Present', key: 'present', width: 12 },
        { header: 'Late', key: 'late', width: 12 },
        { header: 'Excused', key: 'excused', width: 12 },
        { header: 'Absent', key: 'absent', width: 12 },
        { header: 'Attendance %', key: 'percentage', width: 15 },
      ];
      for (const cls of data.classes) {
        for (const student of cls.students ?? []) {
          detailSheet.addRow({
            className: cls.className,
            student: student.studentName,
            expected: student.totalExpected,
            present: student.totalPresent,
            late: student.totalLate,
            excused: student.totalExcused,
            absent: student.totalAbsent,
            percentage: student.attendancePercentage,
          });
        }
      }
    } else {
      // School report
      sheet.columns = [
        { header: 'Department', key: 'department', width: 30 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Present', key: 'present', width: 12 },
        { header: 'Late', key: 'late', width: 12 },
        { header: 'Excused', key: 'excused', width: 12 },
        { header: 'Absent', key: 'absent', width: 12 },
        { header: 'Average Attendance %', key: 'percentage', width: 20 },
      ];
      let schoolPresent = 0, schoolLate = 0, schoolExcused = 0, schoolAbsent = 0, schoolExpected = 0;
      for (const dept of data.departments) {
        let deptPresent = 0, deptLate = 0, deptExcused = 0, deptAbsent = 0, deptExpected = 0;
        for (const cls of dept.classes ?? []) {
          for (const student of cls.students ?? []) {
            deptPresent += student.totalPresent ?? 0;
            deptLate += student.totalLate ?? 0;
            deptExcused += student.totalExcused ?? 0;
            deptAbsent += student.totalAbsent ?? 0;
            deptExpected += student.totalExpected ?? 0;
          }
        }
        schoolPresent += deptPresent;
        schoolLate += deptLate;
        schoolExcused += deptExcused;
        schoolAbsent += deptAbsent;
        schoolExpected += deptExpected;
        sheet.addRow({
          department: dept.departmentName,
          expected: deptExpected,
          present: deptPresent,
          late: deptLate,
          excused: deptExcused,
          absent: deptAbsent,
          percentage: dept.averageAttendancePercentage,
        });
      }
      sheet.addRow({
        department: 'SCHOOL TOTAL',
        expected: schoolExpected,
        present: schoolPresent,
        late: schoolLate,
        excused: schoolExcused,
        absent: schoolAbsent,
        percentage: data.averageAttendancePercentage,
      });

      const classSheet = workbook.addWorksheet('Class Summary');
      classSheet.columns = [
        { header: 'Department', key: 'department', width: 28 },
        { header: 'Class', key: 'className', width: 28 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Present', key: 'present', width: 12 },
        { header: 'Late', key: 'late', width: 12 },
        { header: 'Excused', key: 'excused', width: 12 },
        { header: 'Absent', key: 'absent', width: 12 },
        { header: 'Average Attendance %', key: 'percentage', width: 20 },
      ];
      const detailSheet = workbook.addWorksheet('Student Details');
      detailSheet.columns = [
        { header: 'Department', key: 'department', width: 28 },
        { header: 'Class', key: 'className', width: 28 },
        { header: 'Student', key: 'student', width: 30 },
        { header: 'Expected', key: 'expected', width: 12 },
        { header: 'Present', key: 'present', width: 12 },
        { header: 'Late', key: 'late', width: 12 },
        { header: 'Excused', key: 'excused', width: 12 },
        { header: 'Absent', key: 'absent', width: 12 },
        { header: 'Attendance %', key: 'percentage', width: 15 },
      ];
      for (const dept of data.departments) {
        for (const cls of dept.classes ?? []) {
          let clsPresent = 0, clsLate = 0, clsExcused = 0, clsAbsent = 0, clsExpected = 0;
          for (const student of cls.students ?? []) {
            clsPresent += student.totalPresent ?? 0;
            clsLate += student.totalLate ?? 0;
            clsExcused += student.totalExcused ?? 0;
            clsAbsent += student.totalAbsent ?? 0;
            clsExpected += student.totalExpected ?? 0;
            detailSheet.addRow({
              department: dept.departmentName,
              className: cls.className,
              student: student.studentName,
              expected: student.totalExpected,
              present: student.totalPresent,
              late: student.totalLate,
              excused: student.totalExcused,
              absent: student.totalAbsent,
              percentage: student.attendancePercentage,
            });
          }
          classSheet.addRow({
            department: dept.departmentName,
            className: cls.className,
            expected: clsExpected,
            present: clsPresent,
            late: clsLate,
            excused: clsExcused,
            absent: clsAbsent,
            percentage: cls.averageAttendancePercentage,
          });
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private _exportCSV(data: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData): Promise<Buffer> {
    const lines: string[] = [];

    if ('studentName' in data) {
      // Student report
      lines.push('Metric,Value');
      lines.push(`Student,"${this._escapeCSV(data.studentName)}"`);
      lines.push(`Total Expected,${data.totalExpected}`);
      lines.push(`Present,${data.totalPresent}`);
      lines.push(`Late,${data.totalLate}`);
      lines.push(`Excused,${data.totalExcused}`);
      lines.push(`Absent,${data.totalAbsent}`);
      lines.push(`Attendance %,${data.attendancePercentage}`);
      if (data.records?.length) {
        lines.push('');
        lines.push('Date,Subject,Class,Teacher,Status,Method,Marked At,Note');
        for (const row of data.records) {
          lines.push([
            row.date,
            this._escapeCSV(row.subject),
            this._escapeCSV(row.className ?? ''),
            this._escapeCSV(row.teacherName ?? ''),
            row.status,
            row.method ?? '',
            row.scannedAt ?? '',
            this._escapeCSV(row.note ?? ''),
          ].map((value) => `"${value}"`).join(','));
        }
      }
    } else if ('className' in data) {
      // Class report
      lines.push('Student,Expected,Present,Late,Excused,Absent,Attendance %');
      for (const student of data.students) {
        lines.push(
          `"${this._escapeCSV(student.studentName)}",${student.totalExpected},${student.totalPresent},${student.totalLate},${student.totalExcused},${student.totalAbsent},${student.attendancePercentage}`,
        );
      }
      const evidenceRows = data.students.flatMap((student) =>
        (student.records ?? []).map((row) => ({ studentName: student.studentName, row })),
      );
      if (evidenceRows.length) {
        lines.push('');
        lines.push('Student,Date,Subject,Teacher,Status,Method,Marked At,Note');
        for (const { studentName, row } of evidenceRows) {
          lines.push([
            this._escapeCSV(studentName),
            row.date,
            this._escapeCSV(row.subject),
            this._escapeCSV(row.teacherName ?? ''),
            row.status,
            row.method ?? '',
            row.scannedAt ?? '',
            this._escapeCSV(row.note ?? ''),
          ].map((value) => `"${value}"`).join(','));
        }
      }
    } else if ('departmentName' in data) {
      // Department report
      lines.push('Class,Expected,Present,Late,Excused,Absent,Average Attendance %');
      let deptExpected = 0, deptPresent = 0, deptLate = 0, deptExcused = 0, deptAbsent = 0;
      for (const cls of data.classes) {
        let clsExpected = 0, clsPresent = 0, clsLate = 0, clsExcused = 0, clsAbsent = 0;
        for (const student of cls.students ?? []) {
          clsExpected += student.totalExpected ?? 0;
          clsPresent += student.totalPresent ?? 0;
          clsLate += student.totalLate ?? 0;
          clsExcused += student.totalExcused ?? 0;
          clsAbsent += student.totalAbsent ?? 0;
        }
        deptExpected += clsExpected;
        deptPresent += clsPresent;
        deptLate += clsLate;
        deptExcused += clsExcused;
        deptAbsent += clsAbsent;
        lines.push(`"${this._escapeCSV(cls.className)}",${clsExpected},${clsPresent},${clsLate},${clsExcused},${clsAbsent},${cls.averageAttendancePercentage}`);
      }
      lines.push(`"TOTAL",${deptExpected},${deptPresent},${deptLate},${deptExcused},${deptAbsent},${data.averageAttendancePercentage}`);

      lines.push('');
      lines.push('Class,Student,Expected,Present,Late,Excused,Absent,Attendance %');
      for (const cls of data.classes) {
        for (const student of cls.students ?? []) {
          lines.push([
            this._escapeCSV(cls.className),
            this._escapeCSV(student.studentName),
            student.totalExpected,
            student.totalPresent,
            student.totalLate,
            student.totalExcused,
            student.totalAbsent,
            student.attendancePercentage,
          ].map((value) => `"${value}"`).join(','));
        }
      }
    } else {
      // School report
      lines.push('Department,Expected,Present,Late,Excused,Absent,Average Attendance %');
      let schoolExpected = 0, schoolPresent = 0, schoolLate = 0, schoolExcused = 0, schoolAbsent = 0;
      for (const dept of data.departments) {
        let deptExpected = 0, deptPresent = 0, deptLate = 0, deptExcused = 0, deptAbsent = 0;
        for (const cls of dept.classes ?? []) {
          for (const student of cls.students ?? []) {
            deptExpected += student.totalExpected ?? 0;
            deptPresent += student.totalPresent ?? 0;
            deptLate += student.totalLate ?? 0;
            deptExcused += student.totalExcused ?? 0;
            deptAbsent += student.totalAbsent ?? 0;
          }
        }
        schoolExpected += deptExpected;
        schoolPresent += deptPresent;
        schoolLate += deptLate;
        schoolExcused += deptExcused;
        schoolAbsent += deptAbsent;
        lines.push(`"${this._escapeCSV(dept.departmentName)}",${deptExpected},${deptPresent},${deptLate},${deptExcused},${deptAbsent},${dept.averageAttendancePercentage}`);
      }
      lines.push(`"SCHOOL TOTAL",${schoolExpected},${schoolPresent},${schoolLate},${schoolExcused},${schoolAbsent},${data.averageAttendancePercentage}`);

      lines.push('');
      lines.push('Department,Class,Expected,Present,Late,Excused,Absent,Average Attendance %');
      for (const dept of data.departments) {
        for (const cls of dept.classes ?? []) {
          let clsExpected = 0, clsPresent = 0, clsLate = 0, clsExcused = 0, clsAbsent = 0;
          for (const student of cls.students ?? []) {
            clsExpected += student.totalExpected ?? 0;
            clsPresent += student.totalPresent ?? 0;
            clsLate += student.totalLate ?? 0;
            clsExcused += student.totalExcused ?? 0;
            clsAbsent += student.totalAbsent ?? 0;
          }
          lines.push([
            this._escapeCSV(dept.departmentName),
            this._escapeCSV(cls.className),
            clsExpected,
            clsPresent,
            clsLate,
            clsExcused,
            clsAbsent,
            cls.averageAttendancePercentage,
          ].map((value) => `"${value}"`).join(','));
        }
      }

      lines.push('');
      lines.push('Department,Class,Student,Expected,Present,Late,Excused,Absent,Attendance %');
      for (const dept of data.departments) {
        for (const cls of dept.classes ?? []) {
          for (const student of cls.students ?? []) {
            lines.push([
              this._escapeCSV(dept.departmentName),
              this._escapeCSV(cls.className),
              this._escapeCSV(student.studentName),
              student.totalExpected,
              student.totalPresent,
              student.totalLate,
              student.totalExcused,
              student.totalAbsent,
              student.attendancePercentage,
            ].map((value) => `"${value}"`).join(','));
          }
        }
      }
    }

    const csvContent = lines.join('\n');
    return Promise.resolve(Buffer.from(csvContent, 'utf-8'));
  }

  private _escapeCSV(value: string): string {
    return value.replace(/"/g, '""');
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const reportService = new ReportService();
