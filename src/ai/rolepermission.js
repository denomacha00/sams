/**
 * SAMS Role-Based Access Control (RBAC)
 * Maps user roles to system permissions
 */
const roles = {
    superadmin: ['MANAGE_SCHOOLS', 'MANAGE_LICENSES', 'VIEW_ALL_REPORTS'],
    admin: ['ADD_STUDENT', 'EDIT_STUDENT', 'VIEW_SCHOOL_REPORTS'],
    teacher: ['MARK_ATTENDANCE', 'VIEW_CLASS_STATS'],
    student: ['VIEW_OWN_ATTENDANCE']
};

exports.checkPermission = (role, action) => {
    return roles[role]?.includes(action) || false;
};