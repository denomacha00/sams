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
    expect(teacher.isAction).toBe(true);
    expect(teacher.action).toBe('create_registration_link');
    expect(teacher.params?.studentName).toBe('Jane Doe');
    expect(teacher.requiresConfirmation).toBe(false);
  });

  it('detects teacher invite student phrasing', async () => {
    const link = await actionIntentDetector.detect('generate enrollment link', UserRole.TEACHER);
    expect(link.isAction).toBe(true);
    expect(link.action).toBe('create_registration_link');

    const named = await actionIntentDetector.detect('add student Ken Adim', UserRole.TEACHER);
    expect(named.action).toBe('create_registration_link');
    expect(named.params?.studentName).toBe('Ken Adim');
  });

  it('detects HOD student registration link intent', async () => {
    const result = await actionIntentDetector.detect('register new student', UserRole.HOD);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('create_registration_link');
  });

  it('student view_attendance is student-only', async () => {
    const student = await actionIntentDetector.detect('show my attendance', UserRole.STUDENT);
    expect(student.isAction).toBe(true);
    expect(student.action).toBe('view_attendance');

    const teacher = await actionIntentDetector.detect('show my attendance', UserRole.TEACHER);
    expect(teacher.isAction).toBe(false);
  });

  it('detects HOD view_department_stats for natural headcount questions', async () => {
    const result = await actionIntentDetector.detect(
      'how many teachers and students in my dep',
      UserRole.HOD,
    );
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('view_department_stats');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('detects HOD view_department_stats for department stats phrasing', async () => {
    const result = await actionIntentDetector.detect('show department statistics', UserRole.HOD);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('view_department_stats');
  });

  it('does not treat HOD department headcount as school admin action', async () => {
    const result = await actionIntentDetector.detect(
      'how many teachers and students in my dep',
      UserRole.SCHOOL_ADMIN,
    );
    expect(result.action).not.toBe('view_department_stats');
  });

  it('detects teacher notify students in class', async () => {
    const result = await actionIntentDetector.detect(
      'notify students in my class: Bring calculators',
      UserRole.TEACHER,
    );
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('send_class_message');
  });

  it('detects HOD notify department', async () => {
    const result = await actionIntentDetector.detect(
      'notify department: Staff meeting 3pm',
      UserRole.HOD,
    );
    expect(result.action).toBe('send_department_notification');
  });

  it('detects school admin notify school', async () => {
    const result = await actionIntentDetector.detect(
      'notify school: Sports day Friday',
      UserRole.SCHOOL_ADMIN,
    );
    expect(result.action).toBe('send_school_notification');
  });

  it('detects bare HOD post notification intent', async () => {
    const result = await actionIntentDetector.detect('post a notification', UserRole.HOD);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('send_department_notification');
  });

  it('detects bare teacher notify class intent', async () => {
    const result = await actionIntentDetector.detect('notify my class', UserRole.TEACHER);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('send_class_message');
  });
});
