"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = void 0;
exports.requirePermission = requirePermission;
exports.enforceSchoolScope = enforceSchoolScope;
exports.assertSchoolOwnership = assertSchoolOwnership;
exports.requireHODScope = requireHODScope;
exports.requireStudentSelf = requireStudentSelf;
const shared_1 = require("@sams/shared");
const errors_1 = require("./errors");
// ─── Role → Permissions map ───────────────────────────────────────────────────
exports.ROLE_PERMISSIONS = {
    [shared_1.UserRole.SUPER_ADMIN]: ['super:admin', 'view:reports'],
    [shared_1.UserRole.SCHOOL_ADMIN]: ['manage:users', 'manage:timetable', 'view:reports', 'view:risk', 'manage:payments', 'manage:knowledge'],
    [shared_1.UserRole.HOD]: ['manage:users', 'manage:timetable', 'view:reports', 'view:risk', 'manage:knowledge'],
    [shared_1.UserRole.TEACHER]: ['start:session', 'mark:attendance', 'view:reports', 'manage:knowledge'],
    [shared_1.UserRole.STUDENT]: ['view:reports'],
};
// ─── requirePermission ────────────────────────────────────────────────────────
// Middleware factory. Returns a middleware that checks whether the authenticated
// user's role includes the requested permission. Returns 403 if not.
function requirePermission(permission) {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
            return;
        }
        const permissions = exports.ROLE_PERMISSIONS[user.role] ?? [];
        if (!permissions.includes(permission)) {
            res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
            return;
        }
        next();
    };
}
// ─── enforceSchoolScope ───────────────────────────────────────────────────────
// Sets `req.schoolId` from the authenticated user's JWT claim so that all
// downstream DB queries are automatically scoped to the correct school.
function enforceSchoolScope(req, res, next) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
    }
    req.schoolId = user.schoolId;
    next();
}
// ─── assertSchoolOwnership ────────────────────────────────────────────────────
// Requirement 2.3 — Cross-school access guard.
// Call this inside any route handler after fetching a resource from the DB.
// Throws AppError 403 if the resource belongs to a different school than the
// authenticated user, preventing cross-tenant data leakage.
function assertSchoolOwnership(resource, req) {
    if (resource.schoolId !== req.schoolId) {
        throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }
}
// ─── requireHODScope ─────────────────────────────────────────────────────────
// Requirement 3.3 — HOD department scope guard.
// For HOD users, verifies that the target user (identified by `req.params.userId`)
// or the target department (identified by `req.body.departmentId`) matches the
// HOD's own `departmentId` from the JWT. Non-HOD roles pass through unchanged.
function requireHODScope(req, res, next) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
    }
    if (user.role !== shared_1.UserRole.HOD) {
        next();
        return;
    }
    // HOD must have a departmentId in their JWT
    if (!user.departmentId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
    }
    // Determine the target department from route params or request body
    const targetDepartmentId = (typeof req.params.departmentId === 'string' ? req.params.departmentId : undefined) ??
        req.body?.departmentId;
    // If a departmentId target is present, enforce it matches the HOD's own department
    if (targetDepartmentId !== undefined && targetDepartmentId !== user.departmentId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
    }
    next();
}
// ─── requireStudentSelf ───────────────────────────────────────────────────────
// Requirement 3.5 — Student privacy guard.
// For STUDENT users, verifies that the target student ID in the route params
// (`req.params.studentId` or `req.params.id`) matches the authenticated user's
// own `sub` (userId). Non-STUDENT roles pass through unchanged.
function requireStudentSelf(req, res, next) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
    }
    if (user.role !== shared_1.UserRole.STUDENT) {
        next();
        return;
    }
    const targetStudentId = (typeof req.params.studentId === 'string' ? req.params.studentId : undefined) ??
        (typeof req.params.id === 'string' ? req.params.id : undefined);
    if (targetStudentId !== undefined && targetStudentId !== user.sub) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
    }
    next();
}
//# sourceMappingURL=rbac.js.map