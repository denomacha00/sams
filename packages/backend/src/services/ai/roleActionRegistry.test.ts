import { describe, expect, it } from 'vitest';
import { UserRole } from '@sams/shared';
import {
  getActionNames,
  isActionPermitted,
  findAction,
} from './roleActionRegistry';

describe('roleActionRegistry permissions', () => {
  it('SUPER_ADMIN has platform actions', () => {
    expect(isActionPermitted(UserRole.SUPER_ADMIN, 'suspend_school')).toBe(true);
    expect(isActionPermitted(UserRole.SUPER_ADMIN, 'get_system_stats')).toBe(true);
  });

  it('SCHOOL_ADMIN has school management but not platform suspend', () => {
    expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'add_user')).toBe(true);
    expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'suspend_school')).toBe(false);
  });

  it('TEACHER can run class attendance actions', () => {
    expect(isActionPermitted(UserRole.TEACHER, 'start_session')).toBe(true);
    expect(isActionPermitted(UserRole.TEACHER, 'mark_attendance')).toBe(true);
    expect(isActionPermitted(UserRole.TEACHER, 'view_class_roster')).toBe(true);
    expect(isActionPermitted(UserRole.TEACHER, 'send_class_message')).toBe(true);
    expect(isActionPermitted(UserRole.TEACHER, 'create_registration_link')).toBe(true);
  });

  it('TEACHER cannot run school admin or platform actions', () => {
    expect(isActionPermitted(UserRole.TEACHER, 'add_user')).toBe(false);
    expect(isActionPermitted(UserRole.TEACHER, 'remove_user')).toBe(false);
    expect(isActionPermitted(UserRole.TEACHER, 'get_school_stats')).toBe(false);
    expect(isActionPermitted(UserRole.TEACHER, 'generate_license')).toBe(false);
    expect(findAction(UserRole.TEACHER, 'add_user')).toBeUndefined();
  });

  it('STUDENT has read-only self actions only', () => {
    const names = getActionNames(UserRole.STUDENT);
    expect(names).toEqual(expect.arrayContaining(['view_attendance', 'view_timetable']));
    expect(names).not.toContain('start_session');
    expect(isActionPermitted(UserRole.STUDENT, 'send_class_message')).toBe(false);
  });

  it('unknown role has no permitted actions', () => {
    expect(getActionNames('UNKNOWN')).toEqual([]);
    expect(isActionPermitted('UNKNOWN', 'start_session')).toBe(false);
  });

  it('HOD can view department stats', () => {
    expect(isActionPermitted(UserRole.HOD, 'view_department_stats')).toBe(true);
    expect(findAction(UserRole.HOD, 'view_department_stats')?.destructive).toBe(false);
  });

  it('HOD can send department notifications but not school-wide', () => {
    expect(isActionPermitted(UserRole.HOD, 'send_department_notification')).toBe(true);
    expect(isActionPermitted(UserRole.HOD, 'send_school_notification')).toBe(false);
  });

  it('SCHOOL_ADMIN can send school and department notifications', () => {
    expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'send_school_notification')).toBe(true);
    expect(isActionPermitted(UserRole.SCHOOL_ADMIN, 'send_department_notification')).toBe(true);
  });
});
