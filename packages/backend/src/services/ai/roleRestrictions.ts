import { UserRole } from '@sams/shared';

/** Actions that must never be suggested or executed for a role (audit / prompt hints). */
const FORBIDDEN_ACTION_NAMES: Partial<Record<UserRole, string[]>> = {
  [UserRole.TEACHER]: [
    'add_user',
    'remove_user',
    'create_class',
    'create_department',
    'get_school_stats',
    'send_department_notification',
    'send_school_notification',
    'suspend_school',
    'unsuspend_school',
    'generate_license',
    'extend_license',
    'get_school_info',
    'get_system_stats',
    'clear_audit_logs',
    'reset_user_password',
    'add_teacher',
    'view_department_stats',
    'link_guardian',
    'unlink_guardian',
    'list_linked_guardians',
    'create_timetable_entry',
    'remove_timetable_entry',
    'view_timetable_by_class',
  ],
  [UserRole.STUDENT]: [
    'start_session',
    'end_session',
    'mark_attendance',
    'add_user',
    'remove_user',
    'create_class',
    'create_department',
    'get_school_stats',
    'send_class_message',
    'send_department_notification',
    'send_school_notification',
    'view_class_roster',
    'suspend_school',
    'generate_license',
    'get_system_stats',
    'clear_audit_logs',
    'reset_user_password',
    'link_guardian',
    'unlink_guardian',
    'list_linked_guardians',
    'create_knowledge',
    'create_timetable_entry',
    'remove_timetable_entry',
    'set_class_rep',
    'unset_class_rep',
  ],
  ['GUARDIAN' as UserRole]: [
    'start_session',
    'end_session',
    'mark_attendance',
    'add_user',
    'remove_user',
    'create_class',
    'create_department',
    'get_school_stats',
    'send_class_message',
    'send_department_notification',
    'send_school_notification',
    'view_class_roster',
    'suspend_school',
    'unsuspend_school',
    'generate_license',
    'extend_license',
    'get_system_stats',
    'clear_audit_logs',
    'reset_user_password',
    'link_guardian',
    'unlink_guardian',
    'list_linked_guardians',
    'create_knowledge',
    'create_timetable_entry',
    'remove_timetable_entry',
    'set_class_rep',
    'unset_class_rep',
  ],
  [UserRole.HOD]: [
    'suspend_school',
    'unsuspend_school',
    'generate_license',
    'extend_license',
    'get_system_stats',
    'clear_audit_logs',
    'reset_user_password',
    'add_user',
    'remove_user',
    'create_department',
    'send_school_notification',
    'link_guardian',
    'unlink_guardian',
    'list_linked_guardians',
    'set_class_rep',
    'unset_class_rep',
  ],
  [UserRole.SCHOOL_ADMIN]: [
    'suspend_school',
    'unsuspend_school',
    'generate_license',
    'extend_license',
    'get_system_stats',
    'clear_audit_logs',
    'create_timetable_entry',
    'remove_timetable_entry',
    'view_timetable_by_class',
  ],
};

const ROLE_SCOPE_NOTES: Partial<Record<UserRole, string>> = {
  [UserRole.SUPER_ADMIN]:
    'Full platform access. Can manage schools, licenses, system-wide audit logs, and reset user passwords (temporary password shown once — never read or list passwords).',
  [UserRole.SCHOOL_ADMIN]:
    'School-wide user, class, and department management; reset passwords for users at your school (temp password once — never read passwords; not other school admins). In-app school/department notifications via chat. No platform license/suspend (Super Admin only). SMS is reserved for OTP/password-reset flows while notifications stay app-only.',
  [UserRole.HOD]:
    'Department teachers, department class creation, stats, student registration links for department classes, and in-app department/class notifications. Cannot add/remove school users directly, school-wide notify, or manage licenses.',
  [UserRole.TEACHER]:
    'Your assigned class only: attendance sessions, class roster, in-app class messages to students, and student registration links (invite via link — same as Registration Links page; never add users directly). No user management, no department/school notify, no SMS via AI.',
  [UserRole.STUDENT]:
    'Your own attendance, class timetable, today\'s schedule, teachers assigned to your class, and your department Head of Department (same as the app). In-app announcements arrive when staff send them (Notifications page). No timed personal reminders, school-wide lists, admin stats, or outbound messaging actions.',
  ['GUARDIAN' as UserRole]:
    'Parent/guardian access: linked children only. Can view linked students, child attendance, child timetable, export linked child attendance reports, and manage their own in-app notifications. No school-wide, class-wide, password, attendance marking, or staff management actions.',
};

export function getRoleScopeNote(role: string): string | undefined {
  return ROLE_SCOPE_NOTES[role as UserRole];
}

export function getForbiddenActionNames(role: string): string[] {
  return FORBIDDEN_ACTION_NAMES[role as UserRole] ?? [];
}

export function isActionForbiddenForRole(role: string, actionName: string): boolean {
  return getForbiddenActionNames(role).includes(actionName);
}
