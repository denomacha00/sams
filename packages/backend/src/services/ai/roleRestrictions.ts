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
    'add_teacher',
    'view_department_stats',
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
  ],
  [UserRole.HOD]: [
    'suspend_school',
    'unsuspend_school',
    'generate_license',
    'extend_license',
    'get_system_stats',
    'clear_audit_logs',
    'add_user',
    'remove_user',
    'create_department',
    'send_school_notification',
  ],
  [UserRole.SCHOOL_ADMIN]: [
    'suspend_school',
    'unsuspend_school',
    'generate_license',
    'extend_license',
    'get_system_stats',
    'clear_audit_logs',
  ],
};

const ROLE_SCOPE_NOTES: Partial<Record<UserRole, string>> = {
  [UserRole.SUPER_ADMIN]:
    'Full platform access. Can manage schools, licenses, and system-wide audit logs.',
  [UserRole.SCHOOL_ADMIN]:
    'School-wide user, class, and department management; in-app school/department notifications via chat. No platform license/suspend (Super Admin only). SMS via Notifications UI only.',
  [UserRole.HOD]:
    'Department teachers, stats, student registration links for department classes, and in-app department/class notifications. Cannot add/remove school users directly, school-wide notify, or manage licenses.',
  [UserRole.TEACHER]:
    'Your assigned class only: attendance sessions, class roster, in-app class messages to students, and student registration links (invite via link — same as Registration Links page; never add users directly). No user management, no department/school notify, no SMS via AI.',
  [UserRole.STUDENT]:
    'Your own attendance, class timetable, today\'s schedule, and teachers assigned to your class (same as the app). In-app announcements arrive when staff send them (Notifications page). No timed personal reminders, school-wide lists, admin stats, or outbound messaging actions.',
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
