import { describe, it, expect, vi } from 'vitest';

// Mock the index module to avoid loading prisma/bcrypt native modules
vi.mock('../index', () => ({
  prisma: {},
}));

import { ReportService, StudentReportData, ClassReportData, DepartmentReportData, SchoolReportData } from './reportService';

describe('ReportService.exportReport', () => {
  const service = new ReportService();

  const studentReport: StudentReportData = {
    studentId: 'student-1',
    studentName: 'John Doe',
    totalSessions: 20,
    totalExpected: 20,
    totalPresent: 15,
    totalLate: 3,
    totalExcused: 1,
    totalAbsent: 1,
    attendancePercentage: 90,
  };

  const classReport: ClassReportData = {
    classId: 'class-1',
    className: 'Form 1A',
    totalSessions: 20,
    students: [
      studentReport,
      {
        studentId: 'student-2',
        studentName: 'Jane Smith',
        totalSessions: 20,
        totalExpected: 20,
        totalPresent: 18,
        totalLate: 1,
        totalExcused: 0,
        totalAbsent: 1,
        attendancePercentage: 95,
      },
    ],
    averageAttendancePercentage: 92.5,
  };

  const departmentReport: DepartmentReportData = {
    departmentId: 'dept-1',
    departmentName: 'Science',
    classes: [classReport],
    averageAttendancePercentage: 92.5,
  };

  const schoolReport: SchoolReportData = {
    schoolId: 'school-1',
    schoolName: 'Kenya High School',
    departments: [departmentReport],
    averageAttendancePercentage: 92.5,
  };

  // ─── PDF Export ─────────────────────────────────────────────────────────────

  describe('PDF export', () => {
    it('should return a Buffer for student report', async () => {
      const result = await service.exportReport(studentReport, 'pdf');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      // PDF files start with %PDF
      expect(result.toString('ascii', 0, 4)).toBe('%PDF');
    });

    it('should return a Buffer for class report', async () => {
      const result = await service.exportReport(classReport, 'pdf');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString('ascii', 0, 4)).toBe('%PDF');
    });

    it('should return a Buffer for department report', async () => {
      const result = await service.exportReport(departmentReport, 'pdf');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString('ascii', 0, 4)).toBe('%PDF');
    });

    it('should return a Buffer for school report', async () => {
      const result = await service.exportReport(schoolReport, 'pdf');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString('ascii', 0, 4)).toBe('%PDF');
    });
  });

  // ─── Excel Export ───────────────────────────────────────────────────────────

  describe('Excel export', () => {
    it('should return a Buffer for student report', async () => {
      const result = await service.exportReport(studentReport, 'excel');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a Buffer for class report', async () => {
      const result = await service.exportReport(classReport, 'excel');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a Buffer for department report', async () => {
      const result = await service.exportReport(departmentReport, 'excel');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return a Buffer for school report', async () => {
      const result = await service.exportReport(schoolReport, 'excel');
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── CSV Export ─────────────────────────────────────────────────────────────

  describe('CSV export', () => {
    it('should return a Buffer with correct CSV content for student report', async () => {
      const result = await service.exportReport(studentReport, 'csv');
      expect(result).toBeInstanceOf(Buffer);
      const csv = result.toString('utf-8');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Metric,Value');
      expect(lines[1]).toBe('Student,"John Doe"');
      expect(lines[2]).toBe('Total Expected,20');
      expect(lines[3]).toBe('Present,15');
      expect(lines[4]).toBe('Late,3');
      expect(lines[5]).toBe('Excused,1');
      expect(lines[6]).toBe('Absent,1');
      expect(lines[7]).toBe('Attendance %,90');
    });

    it('should return a Buffer with correct CSV content for class report', async () => {
      const result = await service.exportReport(classReport, 'csv');
      expect(result).toBeInstanceOf(Buffer);
      const csv = result.toString('utf-8');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Student,Expected,Present,Late,Excused,Absent,Attendance %');
      expect(lines[1]).toBe('"John Doe",20,15,3,1,1,90');
      expect(lines[2]).toBe('"Jane Smith",20,18,1,0,1,95');
    });

    it('should return a Buffer with correct CSV content for department report', async () => {
      const result = await service.exportReport(departmentReport, 'csv');
      expect(result).toBeInstanceOf(Buffer);
      const csv = result.toString('utf-8');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Class,Average Attendance %');
      expect(lines[1]).toBe('"Form 1A",92.5');
    });

    it('should return a Buffer with correct CSV content for school report', async () => {
      const result = await service.exportReport(schoolReport, 'csv');
      expect(result).toBeInstanceOf(Buffer);
      const csv = result.toString('utf-8');
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Department,Average Attendance %');
      expect(lines[1]).toBe('"Science",92.5');
    });

    it('should properly escape double quotes in CSV values', async () => {
      const reportWithQuotes: StudentReportData = {
        ...studentReport,
        studentName: 'John "The Great" Doe',
      };
      const result = await service.exportReport(reportWithQuotes, 'csv');
      const csv = result.toString('utf-8');
      const lines = csv.split('\n');
      expect(lines[1]).toBe('Student,"John ""The Great"" Doe"');
    });
  });

  // ─── exportReportById ───────────────────────────────────────────────────────

  describe('exportReportById', () => {
    it('should throw INVALID_REPORT_ID for malformed reportId', async () => {
      await expect(service.exportReportById('invalid', 'pdf')).rejects.toMatchObject({
        code: 'INVALID_REPORT_ID',
      });
    });

    it('should throw INVALID_REPORT_ID for unknown report type', async () => {
      await expect(service.exportReportById('unknown:school-1:target-1', 'pdf')).rejects.toMatchObject({
        code: 'INVALID_REPORT_ID',
      });
    });

    it('should throw INVALID_REPORT_ID for student report without targetId', async () => {
      await expect(service.exportReportById('student:school-1', 'pdf')).rejects.toMatchObject({
        code: 'INVALID_REPORT_ID',
      });
    });

    it('should throw INVALID_REPORT_ID for class report without targetId', async () => {
      await expect(service.exportReportById('class:school-1', 'pdf')).rejects.toMatchObject({
        code: 'INVALID_REPORT_ID',
      });
    });

    it('should throw INVALID_REPORT_ID for department report without targetId', async () => {
      await expect(service.exportReportById('department:school-1', 'pdf')).rejects.toMatchObject({
        code: 'INVALID_REPORT_ID',
      });
    });
  });
});
