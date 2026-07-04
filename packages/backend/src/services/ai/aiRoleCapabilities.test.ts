import { describe, expect, it } from 'vitest';
import { UserRole } from '@sams/shared';
import { findAction, isActionPermitted } from './roleActionRegistry';
import { actionIntentDetector } from './actionIntentDetector';

describe('AI role capabilities matrix', () => {
  describe('view stats', () => {
    it('HOD can view_department_stats', () => {
      expect(isActionPermitted(UserRole.HOD, 'view_department_stats')).toBe(true);
    });

    it('SCHOOL_ADMIN can get_school_stats', () => {
      expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'get_school_stats')).toBe(true);
    });

    it('TEACHER cannot view_department_stats', () => {
      expect(isActionPermitted(UserRole.TEACHER, 'view_department_stats')).toBe(false);
    });
  });

  describe('notifications', () => {
    it('TEACHER can send_class_message', () => {
      expect(isActionPermitted(UserRole.TEACHER, 'send_class_message')).toBe(true);
    });

    it('HOD can send_department_notification', () => {
      expect(isActionPermitted(UserRole.HOD, 'send_department_notification')).toBe(true);
    });

    it('SCHOOL_ADMIN can send school and department notifications', () => {
      expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'send_school_notification')).toBe(true);
      expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'send_department_notification')).toBe(true);
    });

    it('STUDENT cannot send any notification action', () => {
      expect(isActionPermitted(UserRole.STUDENT, 'send_class_message')).toBe(false);
      expect(isActionPermitted(UserRole.STUDENT, 'send_department_notification')).toBe(false);
      expect(isActionPermitted(UserRole.STUDENT, 'send_school_notification')).toBe(false);
    });

    it('TEACHER cannot send school or department notifications', () => {
      expect(isActionPermitted(UserRole.TEACHER, 'send_school_notification')).toBe(false);
      expect(isActionPermitted(UserRole.TEACHER, 'send_department_notification')).toBe(false);
    });

    it('HOD cannot send school-wide notifications', () => {
      expect(isActionPermitted(UserRole.HOD, 'send_school_notification')).toBe(false);
    });

    it('parent and teacher chat messages require confirmation', () => {
      expect(findAction(UserRole.GUARDIAN, 'send_message_to_teacher')?.destructive).toBe(true);
      expect(findAction(UserRole.TEACHER, 'reply_to_parent')?.destructive).toBe(true);
    });
  });

  describe('intent detection', () => {
    it('detects teacher class message', async () => {
      const r = await actionIntentDetector.detect(
        'send message to class: Parents evening Friday',
        UserRole.TEACHER,
      );
      expect(r.action).toBe('send_class_message');
      expect(r.requiresConfirmation).toBe(true);
    });

    it('detects HOD department notify', async () => {
      const r = await actionIntentDetector.detect(
        'notify department students: Lab safety briefing',
        UserRole.HOD,
      );
      expect(r.action).toBe('send_department_notification');
    });

    it('detects school admin school notify', async () => {
      const r = await actionIntentDetector.detect(
        'notify school: School closed tomorrow',
        UserRole.SCHOOL_ADMIN,
      );
      expect(r.action).toBe('send_school_notification');
    });

    it('does not assign school notify to teacher', async () => {
      const r = await actionIntentDetector.detect('notify school: Closed', UserRole.TEACHER);
      expect(r.action).not.toBe('send_school_notification');
      expect(r.isAction).toBe(false);
    });

    it('detects super admin password reset', async () => {
      const r = await actionIntentDetector.detect(
        'reset password for jsmith at school ABC123',
        UserRole.SUPER_ADMIN,
      );
      expect(r.action).toBe('reset_user_password');
      expect(r.requiresConfirmation).toBe(true);
      expect(r.params).toMatchObject({ identifier: 'jsmith', schoolCode: 'ABC123' });
    });

    it('detects school admin password reset without school code', async () => {
      const r = await actionIntentDetector.detect(
        'reset password for john',
        UserRole.SCHOOL_ADMIN,
      );
      expect(r.action).toBe('reset_user_password');
      expect(r.requiresConfirmation).toBe(true);
      expect(r.params).toMatchObject({ identifier: 'john', mode: 'temp_password' });
    });
  });

  describe('super admin confirmation safety', () => {
    it.each([
      'unsuspend_school',
      'generate_license',
      'extend_license',
      'send_platform_summary',
      'trigger_backup',
      'trigger_scheduled_job',
      'trigger_data_export',
    ])('requires confirmation for %s', (actionName) => {
      expect(findAction(UserRole.SUPER_ADMIN, actionName)?.destructive).toBe(true);
    });
  });

  describe('role side-effect confirmation safety', () => {
    it.each([
      [UserRole.SCHOOL_ADMIN, 'add_user'],
      [UserRole.SCHOOL_ADMIN, 'create_class'],
      [UserRole.SCHOOL_ADMIN, 'create_department'],
      [UserRole.SCHOOL_ADMIN, 'link_guardian'],
      [UserRole.SCHOOL_ADMIN, 'set_class_rep'],
      [UserRole.SCHOOL_ADMIN, 'create_knowledge'],
      [UserRole.SCHOOL_ADMIN, 'mark_notifications_read'],
      [UserRole.SCHOOL_ADMIN, 'update_phone'],
      [UserRole.HOD, 'start_session'],
      [UserRole.HOD, 'mark_attendance'],
      [UserRole.HOD, 'add_teacher'],
      [UserRole.HOD, 'create_class'],
      [UserRole.HOD, 'create_timetable_entry'],
      [UserRole.HOD, 'create_knowledge'],
      [UserRole.HOD, 'mark_notifications_read'],
      [UserRole.HOD, 'update_phone'],
      [UserRole.TEACHER, 'start_session'],
      [UserRole.TEACHER, 'mark_attendance'],
      [UserRole.TEACHER, 'create_registration_link'],
      [UserRole.TEACHER, 'export_attendance_report'],
      [UserRole.TEACHER, 'enter_exam_result'],
      [UserRole.TEACHER, 'create_knowledge'],
      [UserRole.TEACHER, 'mark_notifications_read'],
      [UserRole.TEACHER, 'update_phone'],
      [UserRole.STUDENT, 'mark_notifications_read'],
      [UserRole.STUDENT, 'update_phone'],
      [UserRole.GUARDIAN, 'export_child_attendance_report'],
      [UserRole.GUARDIAN, 'mark_notifications_read'],
      [UserRole.GUARDIAN, 'update_phone'],
    ] as const)('%s %s requires confirmation', (role, actionName) => {
      expect(findAction(role, actionName)?.destructive).toBe(true);
    });
  });
});
