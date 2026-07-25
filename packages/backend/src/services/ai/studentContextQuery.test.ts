import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import {
  detectStudentContextAction,
  isStudentContextQuery,
  queryStudentContext,
} from './studentContextQuery';

vi.mock('./roleActionRegistry', () => ({
  findAction: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { findAction } from './roleActionRegistry';
import { prisma } from '../../lib/prisma';

const studentUser = {
  sub: 'stu-betty',
  schoolId: 'school-1',
  role: UserRole.STUDENT,
  classId: 'class-ethics',
  iat: 0,
  exp: 9999999999,
};

describe('studentContextQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects bare "my hod" and related phrasing', () => {
    const cases = [
      'my hod',
      'MY HOD',
      'my hod?',
      'who is my hod',
      'who is my head of department',
      'head of my department',
      'my head of department',
      'who is the hod',
      'who is HOD of this dep',
      'who is hod of this department',
      'this dept hod',
    ];
    for (const message of cases) {
      expect(isStudentContextQuery(message), message).toBe(true);
      expect(detectStudentContextAction(message), message).toBe('list_my_hod');
    }
  });

  it('detects school admin phrasing including adim typo', () => {
    const cases = [
      'who is admin of this school',
      'who is adim of this school',
      'school admin',
      'my school admin',
      'who is the school administrator',
    ];
    for (const message of cases) {
      expect(detectStudentContextAction(message), message).toBe('list_school_admin');
    }
  });

  it('detects teachers, class, department, and class rep phrasing', () => {
    expect(detectStudentContextAction('my teachers')).toBe('list_my_teachers');
    expect(detectStudentContextAction('my class')).toBe('describe_my_class');
    expect(detectStudentContextAction('my department')).toBe('describe_my_department');
    expect(detectStudentContextAction('who is my class rep')).toBe('who_is_class_rep');
  });

  it('class rep is detected before generic my class', () => {
    expect(detectStudentContextAction('my class rep')).toBe('who_is_class_rep');
  });

  it('answers a teacher asking for their HOD via departmentId (no classId dead-end)', async () => {
    // Teacher lookup: first their own departmentId, then the HOD in that department.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ departmentId: 'dept-1' } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      fullName: 'Dr. Smith',
      email: 'smith@school.edu',
      phone: null,
      department: { name: 'Science' },
    } as never);

    const teacher = { ...studentUser, role: UserRole.TEACHER, departmentId: 'dept-1', classId: undefined };
    const result = await queryStudentContext(teacher as never, 'my hod');
    expect(result?.intent).toBe('list_my_hod');
    expect(result?.answer).toMatch(/Dr\. Smith/);
    // Must NOT hit the classId-dependent student handler dead-end.
    expect(result?.answer).not.toMatch(/not linked to a class/i);
  });

  it('allows HOD to query school admin', async () => {
    const handler = vi.fn().mockResolvedValue({
      answer: '🏫 **School administrator**\n\n• **Admin One**',
      data: { admins: [{ fullName: 'Admin One' }] },
    });
    vi.mocked(findAction).mockReturnValue({
      action: 'list_school_admin',
      handler,
      patterns: [],
      description: '',
      destructive: false,
      extractParams: () => ({}),
      descriptionTemplate: () => '',
    });

    const hod = { ...studentUser, role: UserRole.HOD, departmentId: 'dept-1', classId: undefined };
    const result = await queryStudentContext(hod as never, 'who is adim of this school');
    expect(result?.intent).toBe('list_school_admin');
    expect(handler).toHaveBeenCalled();
  });

  it('allows teachers to query school admin', async () => {
    const handler = vi.fn().mockResolvedValue({
      answer: '🏫 **School administrator**\n\n• **Admin One**',
      data: { admins: [{ fullName: 'Admin One' }] },
    });
    vi.mocked(findAction).mockReturnValue({
      action: 'list_school_admin',
      handler,
      patterns: [],
      description: '',
      destructive: false,
      extractParams: () => ({}),
      descriptionTemplate: () => '',
    });

    const teacher = { ...studentUser, role: UserRole.TEACHER, classId: undefined };
    const result = await queryStudentContext(teacher as never, 'who is admin of this school');
    expect(result?.intent).toBe('list_school_admin');
    expect(handler).toHaveBeenCalled();
  });

  it('queryStudentContext invokes list_my_hod handler', async () => {
    const handler = vi.fn().mockResolvedValue({
      answer: '👤 **Your Head of Department** (Science)\n\n**Dr. Smith** is the HOD.',
      data: { hod: { fullName: 'Dr. Smith' } },
    });
    vi.mocked(findAction).mockReturnValue({
      action: 'list_my_hod',
      handler,
      patterns: [],
      description: '',
      destructive: false,
      extractParams: () => ({}),
      descriptionTemplate: () => '',
    });

    const result = await queryStudentContext(studentUser as never, 'my hod');
    expect(result?.intent).toBe('list_my_hod');
    expect(result?.answer).toMatch(/Dr\. Smith/);
    expect(handler).toHaveBeenCalled();
  });
});
