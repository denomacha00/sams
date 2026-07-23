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
  schoolName?: string;
  studentId: string;
  studentName: string;
  admissionNumber?: string | null;
  className?: string | null;
  departmentName?: string | null;
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
  schoolName?: string;
  classId: string;
  className: string;
  classTeacherName?: string | null;
  departmentName?: string | null;
  totalSessions: number;
  students: StudentReportData[];
  averageAttendancePercentage: number;
}

export interface DepartmentReportData {
  schoolName?: string;
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
type StudentSeed = { id: string; fullName: string; classId?: string | null; admissionNumber?: string | null };
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

/** Human-friendly label for the raw attendance method stored on a record.
 *  Raw values: QR, LINK, MANUAL, BIOMETRIC, FINGERPRINT, AUTO_ABSENT,
 *  OFFLINE_QR, OFFLINE_MANUAL. Anything unmapped is title-cased as a fallback. */
function formatMethod(method: string | null | undefined): string {
  if (!method) return '--';
  const map: Record<string, string> = {
    QR: 'QR',
    LINK: 'Link',
    MANUAL: 'Manual',
    BIOMETRIC: 'Biometric',
    FINGERPRINT: 'Fingerprint',
    AUTO_ABSENT: 'Auto',
    OFFLINE_QR: 'Offline QR',
    OFFLINE_MANUAL: 'Offline Manual',
  };
  return map[method] ?? method.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format an ISO timestamp as local HH:mm (24-hour, with minutes). */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Short weekday name (Mon, Tue, …) for a YYYY-MM-DD date string. */
function dayName(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '--' : (DAY_NAMES_SHORT[d.getDay()] ?? '--');
}

/** Weekday name (Mon, Tue, ...) for a YYYY-MM-DD date string. */
function formatDay(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-GB', { weekday: 'short' });
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
    admissionNumber: student.admissionNumber ?? null,
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
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        fullName: true,
        schoolId: true,
        classId: true,
        admissionNumber: true,
        class: { select: { name: true } },
        department: { select: { name: true } },
        school: { select: { name: true } },
      },
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    if (student.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    // Scope attendance counts to the student's CURRENT class sessions so that a
    // student moved between classes doesn't carry old-class records into the new
    // class's totals (which would push attendance % over 100% and hide absences).
    const recordWhere = withDateRange<Prisma.AttendanceRecordWhereInput>({
      studentId,
      schoolId,
      ...(student.classId ? { session: { classId: student.classId } } : {}),
    }, 'scannedAt', dateRange);

    const statusRows = await prisma.attendanceRecord.groupBy({
      by: ['status'],
      where: recordWhere,
      _count: { _all: true },
    });

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
      schoolName: student.school?.name,
      studentId,
      studentName: student.fullName,
      admissionNumber: student.admissionNumber ?? null,
      className: student.class?.name ?? null,
      departmentName: student.department?.name ?? null,
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
      select: {
        id: true,
        name: true,
        schoolId: true,
        department: { select: { name: true } },
        school: { select: { name: true } },
      },
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

    const report = reports[0] ?? {
      classId,
      className: classData.name,
      totalSessions: 0,
      students: [],
      averageAttendancePercentage: 0,
    };

    return {
      ...report,
      schoolName: classData.school?.name,
      departmentName: classData.department?.name ?? null,
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
      select: { id: true, name: true, schoolId: true, school: { select: { name: true } } },
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

    const classReports = await this._buildClassReports(schoolId, classes, dateRange, { includeEvidence: true });

    return {
      schoolName: department.school?.name,
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

    const allClassReports = await this._buildClassReports(schoolId, classes, dateRange, { includeEvidence: true });
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
        select: { id: true, fullName: true, classId: true, admissionNumber: true },
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
      // Scope counts to sessions of the classes in this report, so records a
      // student earned in a class they've since left don't inflate their totals
      // in the class they now belong to (attendance % > 100% / hidden absences).
      const recordWhere = withDateRange<Prisma.AttendanceRecordWhereInput>({
        schoolId,
        studentId: { in: studentIds },
        session: { classId: { in: classIds } },
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
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const NAVY = '#1e3a5f';
      const GRAY = '#4b5563';
      const DARK = '#111827';

      // Helper: draw table header row with navy background
      const drawHeader = (headers: string[], startX: number, y: number, widths: number[]) => {
        doc.rect(50, y, 495, 18).fill(NAVY);
        let cx = startX;
        headers.forEach((h, i) => {
          doc.fill('#ffffff').font('Helvetica-Bold').fontSize(7.5).text(h, cx + 3, y + 4, { width: widths[i] - 3, align: 'left' });
          cx += widths[i];
        });
        doc.fill(DARK); // reset fill
      };

      // Helper: draw a table data row
      const drawRow = (values: (string | number)[], startX: number, y: number, widths: number[]) => {
        let cx = startX;
        values.forEach((v, i) => {
          doc.fill(DARK).font('Helvetica').fontSize(7).text(String(v), cx + 3, y + 3, { width: widths[i] - 3, align: i === values.length - 1 ? 'right' : 'left' });
          cx += widths[i];
        });
      };

      // Helper: page break check
      const checkPage = (needed: number) => {
        if (y + needed > 760) { doc.addPage(); y = 50; }
      };

      // -- Header banner --
      // School name is the primary identity on the report. SAMS appears only as
      // the small generator signature in the footer.
      const schoolName =
        ('schoolName' in data && data.schoolName) ? data.schoolName : 'Attendance Report';
      doc.rect(50, 40, 495, 65).fill(NAVY);
      doc.fill('#ffffff').fontSize(20).font('Helvetica-Bold').text(schoolName, 70, 52, { width: 455 });
      doc.fontSize(9).font('Helvetica').text('Attendance Report', 70, 82);

      let y = 125;

      if ('studentName' in data) {
        // ===== Student Report =====
        checkPage(30);
        doc.font('Helvetica-Bold').fontSize(15).fill(NAVY).text('Student Attendance Report', 50, y); y += 25;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#d1d5db').stroke(); y += 12;
        doc.font('Helvetica-Bold').fontSize(13).fill(DARK).text(data.studentName, 50, y); y += 18;
        // Student identity line: admission no · class · department
        const meta = [
          data.admissionNumber ? 'Adm No: ' + data.admissionNumber : null,
          data.className ? 'Class: ' + data.className : null,
          data.departmentName ? 'Department: ' + data.departmentName : null,
        ].filter(Boolean).join('     |     ');
        if (meta) { doc.font('Helvetica').fontSize(9).fill(GRAY).text(meta, 50, y); y += 16; }
        y += 4;

        // Summary card
        doc.roundedRect(50, y, 240, 75, 5).fill('#f0f7ff');
        doc.fill(NAVY).font('Helvetica-Bold').fontSize(9).text('Attendance Summary', 62, y + 7);
        doc.fill(DARK).font('Helvetica').fontSize(9);
        doc.text('Present:  ' + data.totalPresent, 62, y + 24);
        doc.text('Late:     ' + data.totalLate, 62, y + 37);
        doc.text('Excused:  ' + data.totalExcused, 62, y + 50);
        doc.text('Absent:   ' + data.totalAbsent, 62, y + 63);
        doc.fill(DARK).font('Helvetica').fontSize(9).text('Total Expected:  ' + data.totalExpected, 310, y + 24);
        doc.font('Helvetica-Bold').fontSize(13).fill(NAVY).text('Attendance:  ' + data.attendancePercentage + '%', 310, y + 42);
        y += 95;

        if (data.records?.length) {
          checkPage(30);
          doc.font('Helvetica-Bold').fontSize(12).fill(NAVY).text('Daily Evidence', 50, y); y += 20;
          const cw = [40, 58, 110, 100, 45, 62, 40];
          drawHeader(['Day', 'Date', 'Unit', 'Teacher', 'Status', 'Method', 'Time'], 50, y, cw); y += 20;
          for (const row of data.records.slice(0, 50)) {
            checkPage(13);
            const tn = (row.teacherName || '--').length > 20 ? row.teacherName!.slice(0, 17) + '...' : (row.teacherName || '--');
            drawRow([dayName(row.date), row.date, row.subject, tn, row.status, formatMethod(row.method), formatTime(row.scannedAt)], 50, y, cw); y += 13;
          }
          if (data.records.length > 50) {
            doc.fill(GRAY).font('Helvetica-Oblique').fontSize(8).text('...and ' + (data.records.length - 50) + ' more. Export Excel for full detail.', 50, y); y += 14;
          }
        }
      } else if ('className' in data) {
        // ===== Class Report =====
        checkPage(30);
        doc.font('Helvetica-Bold').fontSize(15).fill(NAVY).text('Class Attendance Report', 50, y); y += 25;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#d1d5db').stroke(); y += 12;
        // Department first, then Class directly below it — same font size.
        if (data.departmentName) {
          doc.font('Helvetica-Bold').fontSize(13).fill(DARK).text('Department: ' + data.departmentName, 50, y); y += 18;
        }
        doc.font('Helvetica-Bold').fontSize(13).fill(DARK).text('Class: ' + data.className, 50, y); y += 18;
        doc.font('Helvetica').fontSize(10).fill(GRAY).text('Sessions: ' + data.totalSessions + '  |  Avg Attendance: ' + data.averageAttendancePercentage + '%', 50, y); y += 24;

        checkPage(30);
        doc.font('Helvetica-Bold').fontSize(12).fill(NAVY).text('Student Summary', 50, y); y += 20;
        const sw = [92, 118, 42, 40, 32, 42, 36, 43];
        drawHeader(['Adm No', 'Student', 'Expected', 'Present', 'Late', 'Excused', 'Absent', '%'], 50, y, sw); y += 20;
        for (const s of data.students) {
          checkPage(13);
          const sn = s.studentName.length > 20 ? s.studentName.slice(0, 17) + '...' : s.studentName;
          drawRow([s.admissionNumber || '--', sn, s.totalExpected, s.totalPresent, s.totalLate, s.totalExcused, s.totalAbsent, s.attendancePercentage + '%'], 50, y, sw); y += 13;
        }

        const ev = data.students.flatMap(s => (s.records || []).map(r => ({ n: s.studentName, r })));
        if (ev.length) {
          checkPage(30);
          doc.font('Helvetica-Bold').fontSize(12).fill(NAVY).text('Daily Evidence', 50, y); y += 20;
          const ew = [78, 34, 52, 82, 82, 42, 55, 40];
          drawHeader(['Student', 'Day', 'Date', 'Unit', 'Teacher', 'Status', 'Method', 'Time'], 50, y, ew); y += 20;
          for (const { n, r } of ev.slice(0, 40)) {
            checkPage(13);
            const sn = n.length > 14 ? n.slice(0, 12) + '...' : n;
            const tn = (r.teacherName || '--').length > 16 ? r.teacherName!.slice(0, 13) + '...' : (r.teacherName || '--');
            drawRow([sn, dayName(r.date), r.date, r.subject, tn, r.status, formatMethod(r.method), formatTime(r.scannedAt)], 50, y, ew); y += 13;
          }
        }
      } else if ('departmentName' in data) {
        // ===== Department Report =====
        checkPage(30);
        doc.font('Helvetica-Bold').fontSize(15).fill(NAVY).text('Department Attendance Report', 50, y); y += 25;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#d1d5db').stroke(); y += 12;
        doc.font('Helvetica-Bold').fontSize(14).fill(DARK).text(data.departmentName, 50, y); y += 10;
        let dp = 0, dl = 0, de = 0, da = 0;
        for (const c of data.classes) for (const s of c.students || []) { dp += s.totalPresent||0; dl += s.totalLate||0; de += s.totalExcused||0; da += s.totalAbsent||0; }
        doc.roundedRect(50, y, 495, 26, 4).fill('#f0f7ff');
        doc.fill(NAVY).font('Helvetica-Bold').fontSize(9).text('Total  P:' + dp + '  L:' + dl + '  E:' + de + '  A:' + da + '  |  Avg: ' + data.averageAttendancePercentage + '%', 60, y + 8); y += 36;

        for (const c of data.classes) {
          checkPage(24);
          doc.roundedRect(50, y, 495, 18, 3).fill('#e8f4fd');
          doc.fill('#1e40af').font('Helvetica-Bold').fontSize(9).text(c.className + '  —  Avg ' + c.averageAttendancePercentage + '%', 60, y + 4); y += 24;
          if (c.students?.length) {
            const cw = [175, 48, 44, 38, 44, 38, 50];
            drawHeader(['Student', 'Expected', 'Present', 'Late', 'Excused', 'Absent', '%'], 50, y, cw); y += 18;
            for (const s of c.students) {
              checkPage(12);
              const sn = s.studentName.length > 26 ? s.studentName.slice(0, 23) + '...' : s.studentName;
              drawRow([sn, s.totalExpected, s.totalPresent, s.totalLate, s.totalExcused, s.totalAbsent, s.attendancePercentage + '%'], 50, y, cw); y += 12;
            }
          }
          // Daily evidence for this class (who marked, day, method, exact time)
          const cev = (c.students || []).flatMap(s => (s.records || []).map(r => ({ n: s.studentName, r })));
          if (cev.length) {
            checkPage(24);
            doc.fill(GRAY).font('Helvetica-Bold').fontSize(8).text('Daily Evidence', 55, y); y += 14;
            const ew = [78, 34, 52, 82, 82, 42, 55, 40];
            drawHeader(['Student', 'Day', 'Date', 'Unit', 'Teacher', 'Status', 'Method', 'Time'], 50, y, ew); y += 18;
            for (const { n, r } of cev.slice(0, 30)) {
              checkPage(12);
              const sn = n.length > 14 ? n.slice(0, 12) + '...' : n;
              const tn = (r.teacherName || '--').length > 16 ? r.teacherName!.slice(0, 13) + '...' : (r.teacherName || '--');
              drawRow([sn, dayName(r.date), r.date, r.subject, tn, r.status, formatMethod(r.method), formatTime(r.scannedAt)], 50, y, ew); y += 12;
            }
            if (cev.length > 30) {
              doc.fill(GRAY).font('Helvetica-Oblique').fontSize(7).text('...and ' + (cev.length - 30) + ' more. Export Excel for full detail.', 55, y); y += 12;
            }
          }
          y += 4;
        }
      } else {
        // ===== School Report =====
        checkPage(30);
        doc.font('Helvetica-Bold').fontSize(15).fill(NAVY).text('School Attendance Report', 50, y); y += 25;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#d1d5db').stroke(); y += 12;
        doc.font('Helvetica-Bold').fontSize(14).fill(DARK).text(data.schoolName, 50, y); y += 10;
        let sp = 0, sl = 0, se = 0, sa = 0;
        for (const d of data.departments) for (const c of d.classes || []) for (const s of c.students || []) { sp += s.totalPresent||0; sl += s.totalLate||0; se += s.totalExcused||0; sa += s.totalAbsent||0; }
        doc.roundedRect(50, y, 495, 26, 4).fill('#f0f7ff');
        doc.fill(NAVY).font('Helvetica-Bold').fontSize(9).text('Total  P:' + sp + '  L:' + sl + '  E:' + se + '  A:' + sa + '  |  Avg: ' + data.averageAttendancePercentage + '%', 60, y + 8); y += 36;

        for (const d of data.departments) {
          checkPage(22);
          doc.roundedRect(50, y, 495, 18, 3).fill('#e8f4fd');
          doc.fill('#1e40af').font('Helvetica-Bold').fontSize(9).text(d.departmentName + '  —  Avg ' + d.averageAttendancePercentage + '%', 60, y + 4); y += 24;
          for (const c of d.classes || []) {
            checkPage(18);
            doc.fill('#4b5563').font('Helvetica-Bold').fontSize(8).text('  ' + c.className + '  —  Avg ' + c.averageAttendancePercentage + '%', 55, y); y += 14;
            if (c.students?.length) {
              const cw = [130, 38, 34, 28, 34, 28, 36];
              drawHeader(['Student', 'Exp', 'P', 'L', 'E', 'A', '%'], 60, y, cw); y += 16;
              for (const s of c.students) {
                checkPage(11);
                const sn = s.studentName.length > 20 ? s.studentName.slice(0, 18) + '...' : s.studentName;
                drawRow([sn, s.totalExpected, s.totalPresent, s.totalLate, s.totalExcused, s.totalAbsent, s.attendancePercentage + '%'], 60, y, cw); y += 11;
              }
            }
            y += 3;
          }
          y += 4;
        }
      }

      // Footer
      doc.fontSize(7).fill('#9ca3af').font('Helvetica').text(
        'SAMS  |  Report generated ' + new Date().toLocaleDateString('en-GB'),
        50, 790, { align: 'center' },
      );
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
      if (data.admissionNumber) sheet.addRow({ metric: 'Admission Number', value: data.admissionNumber });
      if (data.className) sheet.addRow({ metric: 'Class', value: data.className });
      if (data.departmentName) sheet.addRow({ metric: 'Department', value: data.departmentName });
      sheet.addRow({ metric: 'Total Expected', value: data.totalExpected });
      sheet.addRow({ metric: 'Present', value: data.totalPresent });
      sheet.addRow({ metric: 'Late', value: data.totalLate });
      sheet.addRow({ metric: 'Excused', value: data.totalExcused });
      sheet.addRow({ metric: 'Absent', value: data.totalAbsent });
      sheet.addRow({ metric: 'Attendance %', value: data.attendancePercentage });
      if (data.records?.length) {
        const detailSheet = workbook.addWorksheet('Daily Evidence');
        detailSheet.columns = [
          { header: 'Day', key: 'day', width: 8 },
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Unit', key: 'subject', width: 28 },
          { header: 'Class', key: 'className', width: 20 },
          { header: 'Teacher', key: 'teacherName', width: 24 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Method', key: 'method', width: 14 },
          { header: 'Time', key: 'time', width: 10 },
          { header: 'Marked At', key: 'scannedAt', width: 24 },
          { header: 'Note', key: 'note', width: 32 },
        ];
        for (const row of data.records) {
          detailSheet.addRow({
            day: dayName(row.date),
            date: row.date,
            subject: row.subject,
            className: row.className ?? '',
            teacherName: row.teacherName ?? '',
            status: row.status,
            method: formatMethod(row.method),
            time: formatTime(row.scannedAt),
            scannedAt: row.scannedAt ?? '',
            note: row.note ?? '',
          });
        }
      }
    } else if ('className' in data) {
      // Class report
      sheet.columns = [
        { header: 'Adm No', key: 'admissionNumber', width: 14 },
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
          admissionNumber: student.admissionNumber ?? '',
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
          { header: 'Day', key: 'day', width: 8 },
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Unit', key: 'subject', width: 28 },
          { header: 'Teacher', key: 'teacherName', width: 24 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Method', key: 'method', width: 14 },
          { header: 'Time', key: 'time', width: 10 },
          { header: 'Marked At', key: 'scannedAt', width: 24 },
          { header: 'Note', key: 'note', width: 32 },
        ];
        for (const { studentName, row } of evidenceRows) {
          detailSheet.addRow({
            student: studentName,
            day: dayName(row.date),
            date: row.date,
            subject: row.subject,
            teacherName: row.teacherName ?? '',
            status: row.status,
            method: formatMethod(row.method),
            time: formatTime(row.scannedAt),
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

      const deptEvidence = data.classes.flatMap((cls) =>
        (cls.students ?? []).flatMap((student) =>
          (student.records ?? []).map((row) => ({ className: cls.className, studentName: student.studentName, row })),
        ),
      );
      if (deptEvidence.length) {
        const evidenceSheet = workbook.addWorksheet('Daily Evidence');
        evidenceSheet.columns = [
          { header: 'Class', key: 'className', width: 20 },
          { header: 'Student', key: 'student', width: 28 },
          { header: 'Day', key: 'day', width: 8 },
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Unit', key: 'subject', width: 24 },
          { header: 'Teacher', key: 'teacherName', width: 24 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Method', key: 'method', width: 14 },
          { header: 'Time', key: 'time', width: 10 },
          { header: 'Marked At', key: 'scannedAt', width: 24 },
          { header: 'Note', key: 'note', width: 28 },
        ];
        for (const { className, studentName, row } of deptEvidence) {
          evidenceSheet.addRow({
            className,
            student: studentName,
            day: dayName(row.date),
            date: row.date,
            subject: row.subject,
            teacherName: row.teacherName ?? '',
            status: row.status,
            method: formatMethod(row.method),
            time: formatTime(row.scannedAt),
            scannedAt: row.scannedAt ?? '',
            note: row.note ?? '',
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

      const schoolEvidence = data.departments.flatMap((dept) =>
        (dept.classes ?? []).flatMap((cls) =>
          (cls.students ?? []).flatMap((student) =>
            (student.records ?? []).map((row) => ({ department: dept.departmentName, className: cls.className, studentName: student.studentName, row })),
          ),
        ),
      );
      if (schoolEvidence.length) {
        const evidenceSheet = workbook.addWorksheet('Daily Evidence');
        evidenceSheet.columns = [
          { header: 'Department', key: 'department', width: 20 },
          { header: 'Class', key: 'className', width: 18 },
          { header: 'Student', key: 'student', width: 26 },
          { header: 'Day', key: 'day', width: 8 },
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Unit', key: 'subject', width: 22 },
          { header: 'Teacher', key: 'teacherName', width: 22 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Method', key: 'method', width: 14 },
          { header: 'Time', key: 'time', width: 10 },
          { header: 'Marked At', key: 'scannedAt', width: 24 },
          { header: 'Note', key: 'note', width: 26 },
        ];
        for (const { department, className, studentName, row } of schoolEvidence) {
          evidenceSheet.addRow({
            department,
            className,
            student: studentName,
            day: dayName(row.date),
            date: row.date,
            subject: row.subject,
            teacherName: row.teacherName ?? '',
            status: row.status,
            method: formatMethod(row.method),
            time: formatTime(row.scannedAt),
            scannedAt: row.scannedAt ?? '',
            note: row.note ?? '',
          });
        }
      }
    }

    // Style header rows for all sheets
    workbook.eachSheet((ws) => {
      const headerRow = ws.getRow(1);
      if (headerRow.cellCount > 0) {
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.border = {
          bottom: { style: 'medium', color: { argb: 'FF2563eb' } },
        };
      }
      if (ws.columnCount > 1) {
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private _exportCSV(data: StudentReportData | ClassReportData | DepartmentReportData | SchoolReportData): Promise<Buffer> {
    const lines: string[] = [];

    if ('studentName' in data) {
      // Student report
      lines.push('Metric,Value');
      lines.push(`Student,"${this._escapeCSV(data.studentName)}"`);
      if (data.admissionNumber) lines.push(`Admission Number,"${this._escapeCSV(data.admissionNumber)}"`);
      if (data.className) lines.push(`Class,"${this._escapeCSV(data.className)}"`);
      if (data.departmentName) lines.push(`Department,"${this._escapeCSV(data.departmentName)}"`);
      lines.push(`Total Expected,${data.totalExpected}`);
      lines.push(`Present,${data.totalPresent}`);
      lines.push(`Late,${data.totalLate}`);
      lines.push(`Excused,${data.totalExcused}`);
      lines.push(`Absent,${data.totalAbsent}`);
      lines.push(`Attendance %,${data.attendancePercentage}`);
      if (data.records?.length) {
        lines.push('');
        lines.push('Day,Date,Unit,Class,Teacher,Status,Method,Time,Marked At,Note');
        for (const row of data.records) {
          lines.push([
            dayName(row.date),
            row.date,
            this._escapeCSV(row.subject),
            this._escapeCSV(row.className ?? ''),
            this._escapeCSV(row.teacherName ?? ''),
            row.status,
            formatMethod(row.method),
            formatTime(row.scannedAt),
            row.scannedAt ?? '',
            this._escapeCSV(row.note ?? ''),
          ].map((value) => `"${value}"`).join(','));
        }
      }
    } else if ('className' in data) {
      // Class report
      lines.push('Adm No,Student,Expected,Present,Late,Excused,Absent,Attendance %');
      for (const student of data.students) {
        lines.push(
          `"${this._escapeCSV(student.admissionNumber ?? '')}","${this._escapeCSV(student.studentName)}",${student.totalExpected},${student.totalPresent},${student.totalLate},${student.totalExcused},${student.totalAbsent},${student.attendancePercentage}`,
        );
      }
      const evidenceRows = data.students.flatMap((student) =>
        (student.records ?? []).map((row) => ({ studentName: student.studentName, row })),
      );
      if (evidenceRows.length) {
        lines.push('');
        lines.push('Student,Day,Date,Unit,Teacher,Status,Method,Time,Marked At,Note');
        for (const { studentName, row } of evidenceRows) {
          lines.push([
            this._escapeCSV(studentName),
            dayName(row.date),
            row.date,
            this._escapeCSV(row.subject),
            this._escapeCSV(row.teacherName ?? ''),
            row.status,
            formatMethod(row.method),
            formatTime(row.scannedAt),
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

      const deptEvidence = data.classes.flatMap((cls) =>
        (cls.students ?? []).flatMap((student) =>
          (student.records ?? []).map((row) => ({ className: cls.className, studentName: student.studentName, row })),
        ),
      );
      if (deptEvidence.length) {
        lines.push('');
        lines.push('Class,Student,Day,Date,Unit,Teacher,Status,Method,Time,Marked At,Note');
        for (const { className, studentName, row } of deptEvidence) {
          lines.push([
            this._escapeCSV(className),
            this._escapeCSV(studentName),
            dayName(row.date),
            row.date,
            this._escapeCSV(row.subject),
            this._escapeCSV(row.teacherName ?? ''),
            row.status,
            formatMethod(row.method),
            formatTime(row.scannedAt),
            row.scannedAt ?? '',
            this._escapeCSV(row.note ?? ''),
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

      const schoolEvidence = data.departments.flatMap((dept) =>
        (dept.classes ?? []).flatMap((cls) =>
          (cls.students ?? []).flatMap((student) =>
            (student.records ?? []).map((row) => ({ department: dept.departmentName, className: cls.className, studentName: student.studentName, row })),
          ),
        ),
      );
      if (schoolEvidence.length) {
        lines.push('');
        lines.push('Department,Class,Student,Day,Date,Unit,Teacher,Status,Method,Time,Marked At,Note');
        for (const { department, className, studentName, row } of schoolEvidence) {
          lines.push([
            this._escapeCSV(department),
            this._escapeCSV(className),
            this._escapeCSV(studentName),
            dayName(row.date),
            row.date,
            this._escapeCSV(row.subject),
            this._escapeCSV(row.teacherName ?? ''),
            row.status,
            formatMethod(row.method),
            formatTime(row.scannedAt),
            row.scannedAt ?? '',
            this._escapeCSV(row.note ?? ''),
          ].map((value) => `"${value}"`).join(','));
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
