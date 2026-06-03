import { describe, expect, it } from 'vitest';
import { UserRole } from '@sams/shared';
import { actionIntentDetector } from './actionIntentDetector';

describe('actionIntentDetector role scoping (regex path)', () => {
  it('detects teacher start_session', async () => {
    const result = await actionIntentDetector.detect('start attendance session for Math', UserRole.TEACHER);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('start_session');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('does not treat add_user as teacher action', async () => {
    const result = await actionIntentDetector.detect('add user John Doe as student', UserRole.TEACHER);
    expect(result.isAction).toBe(false);
  });

  it('detects teacher class roster', async () => {
    const result = await actionIntentDetector.detect('show my class roster', UserRole.TEACHER);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('view_class_roster');
  });

  it('detects school admin add_user only for SCHOOL_ADMIN', async () => {
    const admin = await actionIntentDetector.detect('add student Jane Doe', UserRole.SCHOOL_ADMIN);
    expect(admin.isAction).toBe(true);
    expect(admin.action).toBe('add_user');

    const teacher = await actionIntentDetector.detect('add student Jane Doe', UserRole.TEACHER);
    expect(teacher.isAction).toBe(false);
  });

  it('student view_attendance is student-only', async () => {
    const student = await actionIntentDetector.detect('show my attendance', UserRole.STUDENT);
    expect(student.isAction).toBe(true);
    expect(student.action).toBe('view_attendance');

    const teacher = await actionIntentDetector.detect('show my attendance', UserRole.TEACHER);
    expect(teacher.isAction).toBe(false);
  });
});
