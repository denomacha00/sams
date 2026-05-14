import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { UserRole } from '@sams/shared';

// Mock prisma before importing the router
vi.mock('../index', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock reportService
vi.mock('../services/reportService', () => ({
  reportService: {
    getStudentReport: vi.fn().mockResolvedValue({
      studentId: 'student-1',
      studentName: 'Test Student',
      totalSessions: 10,
      totalExpected: 10,
      totalPresent: 8,
      totalLate: 1,
      totalExcused: 1,
      totalAbsent: 0,
      attendancePercentage: 80,
    }),
    getClassReport: vi.fn().mockResolvedValue({
      classId: 'class-1',
      className: 'Test Class',
      totalSessions: 10,
      students: [],
      averageAttendancePercentage: 75,
    }),
    getDepartmentReport: vi.fn().mockResolvedValue({
      departmentId: 'dept-1',
      departmentName: 'Test Department',
      classes: [],
      averageAttendancePercentage: 70,
    }),
    getSchoolReport: vi.fn().mockResolvedValue({
      schoolId: 'school-1',
      schoolName: 'Test School',
      departments: [],
      averageAttendancePercentage: 72,
    }),
    exportReportById: vi.fn().mockResolvedValue(Buffer.from('test')),
  },
}));

import { reportsRouter } from './reports';
import { prisma } from '../index';

// ─── Test App Setup ───────────────────────────────────────────────────────────

function createTestApp(user: { sub: string; schoolId: string; role: UserRole; departmentId?: string; classId?: string }) {
  const app = express();
  app.use(express.json());

  // Simulate auth middleware
  app.use((req, _res, next) => {
    req.user = { ...user, iat: 0, exp: 0 };
    req.schoolId = user.schoolId;
    next();
  });

  app.use('/reports', reportsRouter);

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Report Routes - Role-Based Scope Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /reports/student/:id', () => {
    it('should allow a student to view their own report', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/student/student-1');
      expect(res.status).toBe(200);
      expect(res.body.studentId).toBe('student-1');
    });

    it('should deny a student from viewing another student report', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/student/student-2');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a teacher to view a student report in their class', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ classId: 'class-1', schoolId: 'school-1' });
      const app = createTestApp({ sub: 'teacher-1', schoolId: 'school-1', role: UserRole.TEACHER, classId: 'class-1' });
      const res = await request(app).get('/reports/student/student-1');
      expect(res.status).toBe(200);
    });

    it('should deny a teacher from viewing a student report outside their class', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ classId: 'class-2', schoolId: 'school-1' });
      const app = createTestApp({ sub: 'teacher-1', schoolId: 'school-1', role: UserRole.TEACHER, classId: 'class-1' });
      const res = await request(app).get('/reports/student/student-1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow an HOD to view a student report in their department', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ departmentId: 'dept-1', schoolId: 'school-1' });
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/student/student-1');
      expect(res.status).toBe(200);
    });

    it('should deny an HOD from viewing a student report outside their department', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ departmentId: 'dept-2', schoolId: 'school-1' });
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/student/student-1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a school admin to view any student report', async () => {
      const app = createTestApp({ sub: 'admin-1', schoolId: 'school-1', role: UserRole.SCHOOL_ADMIN });
      const res = await request(app).get('/reports/student/student-1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /reports/class/:classId', () => {
    it('should deny a student from accessing class reports', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/class/class-1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a teacher to view their assigned class report', async () => {
      const app = createTestApp({ sub: 'teacher-1', schoolId: 'school-1', role: UserRole.TEACHER, classId: 'class-1' });
      const res = await request(app).get('/reports/class/class-1');
      expect(res.status).toBe(200);
    });

    it('should deny a teacher from viewing a different class report', async () => {
      const app = createTestApp({ sub: 'teacher-1', schoolId: 'school-1', role: UserRole.TEACHER, classId: 'class-1' });
      const res = await request(app).get('/reports/class/class-2');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow an HOD to view a class report in their department', async () => {
      (prisma.class.findUnique as any).mockResolvedValue({ departmentId: 'dept-1', schoolId: 'school-1' });
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/class/class-1');
      expect(res.status).toBe(200);
    });

    it('should deny an HOD from viewing a class report outside their department', async () => {
      (prisma.class.findUnique as any).mockResolvedValue({ departmentId: 'dept-2', schoolId: 'school-1' });
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/class/class-1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a school admin to view any class report', async () => {
      const app = createTestApp({ sub: 'admin-1', schoolId: 'school-1', role: UserRole.SCHOOL_ADMIN });
      const res = await request(app).get('/reports/class/class-1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /reports/department/:deptId', () => {
    it('should deny a student from accessing department reports', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/department/dept-1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should deny a teacher from accessing department reports', async () => {
      const app = createTestApp({ sub: 'teacher-1', schoolId: 'school-1', role: UserRole.TEACHER, classId: 'class-1' });
      const res = await request(app).get('/reports/department/dept-1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow an HOD to view their own department report', async () => {
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/department/dept-1');
      expect(res.status).toBe(200);
    });

    it('should deny an HOD from viewing a different department report', async () => {
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/department/dept-2');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a school admin to view any department report', async () => {
      const app = createTestApp({ sub: 'admin-1', schoolId: 'school-1', role: UserRole.SCHOOL_ADMIN });
      const res = await request(app).get('/reports/department/dept-1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /reports/school', () => {
    it('should deny a student from accessing school reports', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/school');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should deny a teacher from accessing school reports', async () => {
      const app = createTestApp({ sub: 'teacher-1', schoolId: 'school-1', role: UserRole.TEACHER, classId: 'class-1' });
      const res = await request(app).get('/reports/school');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should deny an HOD from accessing school reports', async () => {
      const app = createTestApp({ sub: 'hod-1', schoolId: 'school-1', role: UserRole.HOD, departmentId: 'dept-1' });
      const res = await request(app).get('/reports/school');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a school admin to view the school report', async () => {
      const app = createTestApp({ sub: 'admin-1', schoolId: 'school-1', role: UserRole.SCHOOL_ADMIN });
      const res = await request(app).get('/reports/school');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /reports/:reportId/export', () => {
    it('should return 400 if format is missing', async () => {
      const app = createTestApp({ sub: 'admin-1', schoolId: 'school-1', role: UserRole.SCHOOL_ADMIN });
      const res = await request(app).get('/reports/student:student-1/export');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should allow a student to export their own report', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/student:student-1/export?format=pdf');
      expect(res.status).toBe(200);
    });

    it('should deny a student from exporting another student report', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/student:student-2/export?format=pdf');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should deny a student from exporting a class report', async () => {
      const app = createTestApp({ sub: 'student-1', schoolId: 'school-1', role: UserRole.STUDENT });
      const res = await request(app).get('/reports/class:class-1/export?format=pdf');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should allow a school admin to export any report', async () => {
      const app = createTestApp({ sub: 'admin-1', schoolId: 'school-1', role: UserRole.SCHOOL_ADMIN });
      const res = await request(app).get('/reports/school/export?format=excel');
      expect(res.status).toBe(200);
    });
  });
});
