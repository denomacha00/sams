import { UserRole } from '@sams/shared';

/** Actions that must never be suggested or executed for a role (audit / prompt hints). */
const FORBIDDEN_ACTION_NAMES: Partial<Record<UserRole, string[]>> = {
  [UserRole.TEACHER]: [
    'add_user',
    'remove_user',
    'create_class',
    'create_department',
    'get_school_stats',
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
    'School-wide user, class, and department management. No platform license/suspend actions (Super Admin only). School-wide SMS is via the Notifications UI, not AI.',
  [UserRole.HOD]:
    'Department teachers and stats only. Cannot add/remove school users or manage licenses.',
  [UserRole.TEACHER]:
    'Your assigned class only: attendance sessions, class roster, in-app class messages. No user management, no school-wide SMS, no other classes.',
  [UserRole.STUDENT]:
    'Your own attendance and timetable only. No administrative or messaging actions.',
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
