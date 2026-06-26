import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@sams/shared';
import { actionIntentDetector } from './actionIntentDetector';
import * as roleActionRegistry from './roleActionRegistry';

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

  it('detects student list_my_teachers for natural phrasing', async () => {
    const cases = [
      'name of our teachers',
      'who are my teachers',
      'who teaches me',
    ];
    for (const message of cases) {
      const result = await actionIntentDetector.detect(message, UserRole.STUDENT);
      expect(result.isAction).toBe(true);
      expect(result.action).toBe('list_my_teachers');
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it('does not treat school admin teacher headcount as student list_my_teachers', async () => {
    const result = await actionIntentDetector.detect(
      'how many teachers in the school',
      UserRole.STUDENT,
    );
    expect(result.action).not.toBe('list_my_teachers');
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

  it('detects student explain_reminders for remind-me phrasing', async () => {
    const result = await actionIntentDetector.detect(
      'will you remind me at that time please',
      UserRole.STUDENT,
    );
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('explain_reminders');
  });

  it('detects student list_my_hod for natural phrasing', async () => {
    const cases = [
      'my hod',
      'MY HOD',
      'who is my hod',
      'who are is my hod',
      'head of my department',
      'who is my head of department',
      'who is HOD of this dep',
      'who is the hod',
    ];
    for (const message of cases) {
      const result = await actionIntentDetector.detect(message, UserRole.STUDENT);
      expect(result.isAction).toBe(true);
      expect(result.action).toBe('list_my_hod');
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it('detects list_school_admin for students, teachers, and HOD', async () => {
    const cases = ['who is admin of this school', 'who is adim of this school', 'school admin'];
    for (const message of cases) {
      const student = await actionIntentDetector.detect(message, UserRole.STUDENT);
      expect(student.action).toBe('list_school_admin');
      const teacher = await actionIntentDetector.detect(message, UserRole.TEACHER);
      expect(teacher.action).toBe('list_school_admin');
      const hod = await actionIntentDetector.detect(message, UserRole.HOD);
      expect(hod.action).toBe('list_school_admin');
    }
  });

  it('does not treat HOD question as list_my_teachers', async () => {
    const result = await actionIntentDetector.detect('who is my hod', UserRole.STUDENT);
    expect(result.action).toBe('list_my_hod');
    expect(result.action).not.toBe('list_my_teachers');
  });

  it('detects unsuspend_school without matching suspend_school substring', async () => {
    const cases = [
      'unsuspend school Test Academy',
      'unblock school Test Academy',
      'reactivate school Test Academy',
      'undo suspend Test Academy',
      'undo suspension for Test Academy',
    ];
    for (const message of cases) {
      const result = await actionIntentDetector.detect(message, UserRole.SUPER_ADMIN);
      expect(result.isAction).toBe(true);
      expect(result.action).toBe('unsuspend_school');
      expect(result.params?.schoolName).toBe('Test Academy');
    }
  });

  it('detects suspend_school with word-boundary patterns only', async () => {
    const suspend = await actionIntentDetector.detect('suspend school Test Academy', UserRole.SUPER_ADMIN);
    expect(suspend.isAction).toBe(true);
    expect(suspend.action).toBe('suspend_school');
    expect(suspend.params?.schoolName).toBe('Test Academy');

    const unsuspend = await actionIntentDetector.detect(
      'unsuspend school Test Academy',
      UserRole.SUPER_ADMIN,
    );
    expect(unsuspend.action).toBe('unsuspend_school');
    expect(unsuspend.action).not.toBe('suspend_school');
  });

  it('detects get_school_info for super admin', async () => {
    const result = await actionIntentDetector.detect(
      'school info for Test Academy',
      UserRole.SUPER_ADMIN,
    );
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('get_school_info');
    expect(result.params?.schoolName).toBe('Test Academy');
  });

  it('detects HOD timetable generation as a confirmed role action', async () => {
    const result = await actionIntentDetector.detect('auto generate timetable for all classes', UserRole.HOD);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('generate_timetable');
    expect(result.requiresConfirmation).toBe(true);
    expect(result.params?.allClasses).toBe(true);
  });

  it('detects report export requests for students and staff', async () => {
    const student = await actionIntentDetector.detect('download my attendance report pdf', UserRole.STUDENT);
    expect(student.isAction).toBe(true);
    expect(student.action).toBe('export_attendance_report');
    expect(student.params?.format).toBe('pdf');

    const teacher = await actionIntentDetector.detect('export class report as excel', UserRole.TEACHER);
    expect(teacher.isAction).toBe(true);
    expect(teacher.action).toBe('export_attendance_report');
    expect(teacher.params?.format).toBe('excel');

    const admin = await actionIntentDetector.detect('export school attendance report csv', UserRole.SCHOOL_ADMIN);
    expect(admin.isAction).toBe(true);
    expect(admin.action).toBe('export_attendance_report');
    expect(admin.params?.reportType).toBe('school');
  });

  it('detects @school as a safe school database overview before terminal fallback', async () => {
    const result = await actionIntentDetector.detect('@school greenwood', UserRole.SUPER_ADMIN);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('get_school_info');
    expect(result.params?.schoolName).toBe('greenwood');
  });

  it('detects @ terminal commands for super admin only', async () => {
    const result = await actionIntentDetector.detect('@status', UserRole.SUPER_ADMIN);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('run_terminal_command');
    expect(result.params?.command).toBe('@status');

    const schoolAdminResult = await actionIntentDetector.detect('@status', UserRole.SCHOOL_ADMIN);
    expect(schoolAdminResult.isAction).toBe(false);
  });

  it('detects @db as a super admin database overview action', async () => {
    const result = await actionIntentDetector.detect('@db', UserRole.SUPER_ADMIN);
    expect(result.isAction).toBe(true);
    expect(result.action).toBe('database_overview');
  });

  it('does not throw when an action definition has no patterns array', async () => {
    const spy = vi.spyOn(roleActionRegistry, 'getActionsForRole').mockReturnValue([
      {
        action: 'broken_action',
        description: 'test',
        destructive: false,
        patterns: undefined as unknown as RegExp[],
        extractParams: () => ({}),
        descriptionTemplate: () => 'test',
        handler: async () => ({ answer: 'ok' }),
      },
    ]);

    const result = await actionIntentDetector.detect('who is admin of this school', UserRole.STUDENT);
    expect(result.isAction).toBe(false);

    spy.mockRestore();
  });
});
