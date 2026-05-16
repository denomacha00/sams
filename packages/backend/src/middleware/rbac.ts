import { type Request, type Response, type NextFunction } from 'express';
import { UserRole } from '@sams/shared';
import { AppError } from './errors';

// ─── Augment Express Request ──────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      schoolId: string;
    }
  }
}

// ─── Permission type ──────────────────────────────────────────────────────────

export type Permission =
  | 'manage:users'
  | 'start:session'
  | 'mark:attendance'
  | 'view:reports'
  | 'manage:timetable'
  | 'view:risk'
  | 'manage:payments'
  | 'manage:knowledge'
  | 'super:admin';

// ─── Role → Permissions map ───────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]:  ['super:admin', 'view:reports'],
  [UserRole.SCHOOL_ADMIN]: ['manage:users', 'manage:timetable', 'view:reports', 'view:risk', 'manage:payments', 'manage:knowledge'],
  [UserRole.HOD]:          ['manage:users', 'manage:timetable', 'view:reports', 'view:risk', 'manage:knowledge'],
  [UserRole.TEACHER]:      ['start:session', 'mark:attendance', 'view:reports', 'manage:knowledge'],
  [UserRole.STUDENT]:      ['view:reports'],
};

// ─── requirePermission ────────────────────────────────────────────────────────
// Middleware factory. Returns a middleware that checks whether the authenticated
// user's role includes the requested permission. Returns 403 if not.

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }

    const permissions = ROLE_PERMISSIONS[user.role] ?? [];

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

export function enforceSchoolScope(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  req.schoolId = user.schoolId;
  next();
}

// ─── AuthRequest alias ────────────────────────────────────────────────────────
// Convenience alias used by the guards below. `req.user` is guaranteed to be
// present after the `authenticate` middleware has run.

export type AuthRequest = Request & { user: NonNullable<Request['user']> };

// ─── assertSchoolOwnership ────────────────────────────────────────────────────
// Requirement 2.3 — Cross-school access guard.
// Call this inside any route handler after fetching a resource from the DB.
// Throws AppError 403 if the resource belongs to a different school than the
// authenticated user, preventing cross-tenant data leakage.

export function assertSchoolOwnership(
  resource: { schoolId: string },
  req: AuthRequest,
): void {
  if (resource.schoolId !== req.schoolId) {
    throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
  }
}

// ─── requireHODScope ─────────────────────────────────────────────────────────
// Requirement 3.3 — HOD department scope guard.
// For HOD users, verifies that the target user (identified by `req.params.userId`)
// or the target department (identified by `req.body.departmentId`) matches the
// HOD's own `departmentId` from the JWT. Non-HOD roles pass through unchanged.

export function requireHODScope(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  if (user.role !== UserRole.HOD) {
    next();
    return;
  }

  // HOD must have a departmentId in their JWT
  if (!user.departmentId) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }

  // Determine the target department from route params or request body
  const targetDepartmentId: string | undefined =
    (typeof req.params.departmentId === 'string' ? req.params.departmentId : undefined) ??
    ((req.body as Record<string, unknown> | undefined)?.departmentId as string | undefined);

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

export function requireStudentSelf(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  if (user.role !== UserRole.STUDENT) {
    next();
    return;
  }

  const targetStudentId: string | undefined =
    (typeof req.params.studentId === 'string' ? req.params.studentId : undefined) ??
    (typeof req.params.id === 'string' ? req.params.id : undefined);

  if (targetStudentId !== undefined && targetStudentId !== user.sub) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }

  next();
}
