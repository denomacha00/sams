import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import {
  extractInviteStudentParams,
  createRegistrationLinkHandler,
} from './registrationLinkAction';

vi.mock('../../registrationLinkService', () => ({
  registrationLinkService: {
    generateLink: vi.fn(),
  },
}));

vi.mock('../../../lib/teacherScope', () => ({
  resolveTeacherClassId: vi.fn(),
}));

import { registrationLinkService } from '../../registrationLinkService';
import { resolveTeacherClassId } from '../../../lib/teacherScope';

describe('extractInviteStudentParams', () => {
  it('extracts student name from add student message', () => {
    const params = extractInviteStudentParams('add student Ken Adim', [
      'add student Ken Adim',
      'Ken Adim',
    ] as RegExpMatchArray);
    expect(params.studentName).toBe('Ken Adim');
    expect(params.targetRole).toBe('STUDENT');
  });
});

describe('createRegistrationLinkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = 'https://school.example.com';
  });

  it('generates link for teacher with default class', async () => {
    vi.mocked(resolveTeacherClassId).mockResolvedValue('class-1');
    vi.mocked(registrationLinkService.generateLink).mockResolvedValue({
      id: 'link-1',
      token: 'tok-abc',
      expiresAt: new Date('2026-07-01'),
      maxUses: 100,
      classId: 'class-1',
      targetRole: UserRole.STUDENT,
    } as Awaited<ReturnType<typeof registrationLinkService.generateLink>>);

    const result = await createRegistrationLinkHandler(
      { studentName: 'Ken Adim' },
      {
        userId: 'teacher-1',
        role: UserRole.TEACHER,
        schoolId: 'school-1',
        departmentId: 'dept-1',
        classId: undefined,
      },
    );

    expect(registrationLinkService.generateLink).toHaveBeenCalledWith(
      'teacher-1',
      UserRole.TEACHER,
      'school-1',
      'dept-1',
      'class-1',
      { targetRole: 'STUDENT' },
    );
    expect(result.answer).toContain('https://school.example.com/register/tok-abc');
    expect(result.answer).toContain('Ken Adim');
    expect(result.answer).toContain('Registration Links');
    expect(result.answer).toContain('cannot add them directly');
  });
});
