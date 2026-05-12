/**
 * SAMS RBAC (Role-Based Access Control)
 * Ensures only authorized users can access specific school data.
 */
const roles = {
    ADMIN: ['generate_license', 'delete_student', 'view_all_reports'],
    HOD: ['view_class_reports', 'edit_student_info', 'mark_attendance'],
    TEACHER: ['mark_attendance', 'view_own_class']
};

exports.checkPermission = (role, action) => {
    if (!roles[role]) return false;
    return roles[role].includes(action);
};