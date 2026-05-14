import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
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
  classes: ClassReportData[];
  averageAttendancePercentage: number;
}

export interface SchoolReportData {
  schoolId: string;
  schoolName: string;
  departments: DepartmentReportData[];
  averageAttendancePercentage: number;
}

// ─── Report Service ───────────────────────────────────────────────────────────

export class ReportService {
  /**
   * Get attendance report for a single student.
   * Attendance % = (totalPresent / totalExpected) * 100, rounded to 2 dp
   * Requirements: 10.1, 10.5, 10.7
   */
  async getStudentReport(schoolId: string, studentId: string, dateRange?: DateRange): Promise<StudentReportData> {
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, fullName: true, schoolId: true, classId: true },
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    if (student.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    const recordWhere: Record<string, unknown> = {
      studentId,
      schoolId,
    };

    if (dateRange) {
      recordWhere.scannedAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const records = await prisma.attendanceRecord.findMany({ where: recordWhere });

    // Count total expected sessions for this student in the date range
    const sessionWhere: Record<string, unknown> = { schoolId };
    if (dateRange) {
      sessionWhere.startedAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    let totalSessions = 0;
    if (student.classId) {
      totalSessions = await prisma.attendanceSession.count({
        where: {
          ...sessionWhere,
          classId: student.classId,
        },
      });
    }

    // totalExpected is the number of sessions the student should have attended
    const totalExpected = totalSessions > 0 ? totalSessions : records.length;

    const totalPresent = records.filter((r) => r.status === 'PRESENT').length;
    const totalLate = records.filter((r) => r.status === 'LATE').length;
    const totalExcused = records.filter((r) => r.status === 'EXCUSED').length;
    const totalAbsent = totalExpected - totalPresent - totalLate - totalExcused;

    // Attendance percentage = (totalPresent / totalExpected) * 100, rounded to 2 dp
    // Per Requirement 10.5: (Total Present / Total Expected) × 100
    const attendancePercentage = totalExpected > 0
      ? Math.round((totalPresent / totalExpected) * 100 * 100) / 100
      : 0;

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

    // Count total sessions for this class in the date range
    const sessionWhere: Record<string, unknown> = { schoolId, classId };
    if (dateRange) {
      sessionWhere.startedAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }
    const totalSessions = await prisma.attendanceSession.count({ where: sessionWhere });

    // Get all students in this class
    const students = await prisma.user.findMany({
      where: { schoolId, classId, role: 'STUDENT' },
      select: { id: true },
    });

    const studentReports: StudentReportData[] = [];
    for (const student of students) {
      const report = await this.getStudentReport(schoolId, student.id, dateRange);
      studentReports.push(report);
    }

    const averageAttendancePercentage = studentReports.length > 0
      ? Math.round(
          (studentReports.reduce((sum, r) => sum + r.attendancePercentage, 0) / studentReports.length) * 100,
        ) / 100
      : 0;

    return {
      classId,
      className: classData.name,
      totalSessions,
      students: studentReports,
      averageAttendancePercentage,
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

    // Get all classes in this department
    const classes = await prisma.class.findMany({
      where: { schoolId, departmentId },
      select: { id: true },
    });

    const classReports: ClassReportData[] = [];
    for (const cls of classes) {
      const report = await this.getClassReport(schoolId, cls.id, dateRange);
      classReports.push(report);
    }

    const averageAttendancePercentage = classReports.length > 0
      ? Math.round(
          (classReports.reduce((sum, r) => sum + r.averageAttendancePercentage, 0) / classReports.length) * 100,
        ) / 100
      : 0;

    return {
      departmentId,
      departmentName: department.name,
      classes: classReports,
      averageAttendancePercentage,
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

    // Get all departments in this school
    const departments = await prisma.department.findMany({
      where: { schoolId },
      select: { id: true },
    });

    const departmentReports: DepartmentReportData[] = [];
    for (const dept of departments) {
      const report = await this.getDepartmentReport(schoolId, dept.id, dateRange);
      departmentReports.push(report);
    }

    const averageAttendancePercentage = departmentReports.length > 0
      ? Math.round(
          (departmentReports.reduce((sum, r) => sum + r.averageAttendancePercentage, 0) / departmentReports.length) * 100,
        ) / 100
      : 0;

    return {
      schoolId,
      schoolName: school.name,
      departments: departmentReports,
      averageAttendancePercentage,
    };
  }

  /**
   * Export report by reportId and format.
   * reportId format: "type:schoolId:targetId" (e.g., "student:school-1:student-1")
   * For school reports: "school:school-1"
   * Accepts optional dateRange encoded as query params in the reportId or as a separate param.
   * Requirements: 10.6
   */
  async exportReportById(reportId: string, format: 'pdf' | 'excel', dateRange?: DateRange): Promise<Buffer> {
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
      } else if ('className' in data) {
        // Class report
        doc.fontSize(14).text(`Class: ${data.className}`);
        doc.text(`Average Attendance: ${data.averageAttendancePercentage}%`);
        doc.moveDown();
        for (const student of data.students) {
          doc.fontSize(10).text(`${student.studentName}: ${student.attendancePercentage}%`);
        }
      } else if ('departmentName' in data) {
        // Department report
        doc.fontSize(14).text(`Department: ${data.departmentName}`);
        doc.text(`Average Attendance: ${data.averageAttendancePercentage}%`);
        doc.moveDown();
        for (const cls of data.classes) {
          doc.fontSize(12).text(`${cls.className}: ${cls.averageAttendancePercentage}%`);
        }
      } else {
        // School report
        doc.fontSize(14).text(`School: ${data.schoolName}`);
        doc.text(`Average Attendance: ${data.averageAttendancePercentage}%`);
        doc.moveDown();
        for (const dept of data.departments) {
          doc.fontSize(12).text(`${dept.departmentName}: ${dept.averageAttendancePercentage}%`);
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
    } else if ('departmentName' in data) {
      // Department report
      sheet.columns = [
        { header: 'Class', key: 'className', width: 30 },
        { header: 'Average Attendance %', key: 'percentage', width: 20 },
      ];
      for (const cls of data.classes) {
        sheet.addRow({ className: cls.className, percentage: cls.averageAttendancePercentage });
      }
    } else {
      // School report
      sheet.columns = [
        { header: 'Department', key: 'department', width: 30 },
        { header: 'Average Attendance %', key: 'percentage', width: 20 },
      ];
      for (const dept of data.departments) {
        sheet.addRow({ department: dept.departmentName, percentage: dept.averageAttendancePercentage });
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
    } else if ('className' in data) {
      // Class report
      lines.push('Student,Expected,Present,Late,Excused,Absent,Attendance %');
      for (const student of data.students) {
        lines.push(
          `"${this._escapeCSV(student.studentName)}",${student.totalExpected},${student.totalPresent},${student.totalLate},${student.totalExcused},${student.totalAbsent},${student.attendancePercentage}`,
        );
      }
    } else if ('departmentName' in data) {
      // Department report
      lines.push('Class,Average Attendance %');
      for (const cls of data.classes) {
        lines.push(`"${this._escapeCSV(cls.className)}",${cls.averageAttendancePercentage}`);
      }
    } else {
      // School report
      lines.push('Department,Average Attendance %');
      for (const dept of data.departments) {
        lines.push(`"${this._escapeCSV(dept.departmentName)}",${dept.averageAttendancePercentage}`);
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
