import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '@sams/shared';
import { requirePermission, enforceSchoolScope, ROLE_PERMISSIONS, type Permission } from './rbac';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    schoolId: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { res, status, json };
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ─── ROLE_PERMISSIONS map ─────────────────────────────────────────────────────

describe('ROLE_PERMISSIONS', () => {
  it('covers all UserRole values', () => {
    const roles = Object.values(UserRole);
    for (const role of roles) {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
    }
  });

  it('SUPER_ADMIN has super:admin and view:reports', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain('super:admin');
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toContain('view:reports');
  });

  it('SCHOOL_ADMIN has manage:users, manage:timetable, view:reports, view:risk, manage:payments', () => {
    const perms = ROLE_PERMISSIONS[UserRole.SCHOOL_ADMIN];
    expect(perms).toContain('manage:users');
    expect(perms).toContain('manage:timetable');
    expect(perms).toContain('view:reports');
    expect(perms).toContain('view:risk');
    expect(perms).toContain('manage:payments');
  });

  it('HOD has manage:users, view:reports, view:risk', () => {
    const perms = ROLE_PERMISSIONS[UserRole.HOD];
    expect(perms).toContain('manage:users');
    expect(perms).toContain('view:reports');
    expect(perms).toContain('view:risk');
    expect(perms).not.toContain('manage:payments');
    expect(perms).not.toContain('super:admin');
  });

  it('TEACHER has start:session, mark:attendance, view:reports', () => {
    const perms = ROLE_PERMISSIONS[UserRole.TEACHER];
    expect(perms).toContain('start:session');
    expect(perms).toContain('mark:attendance');
    expect(perms).toContain('view:reports');
    expect(perms).not.toContain('manage:users');
  });

  it('STUDENT has only view:reports', () => {
    const perms = ROLE_PERMISSIONS[UserRole.STUDENT];
    expect(perms).toEqual(['view:reports']);
  });

  it('SUPER_ADMIN does not have manage:users or manage:payments', () => {
    const perms = ROLE_PERMISSIONS[UserRole.SUPER_ADMIN];
    expect(perms).not.toContain('manage:users');
    expect(perms).not.toContain('manage:payments');
  });
});

// ─── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  it('calls next() when role has the required permission', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.TEACHER, iat: 0, exp: 9999 } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requirePermission('start:session')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when role lacks the required permission', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.STUDENT, iat: 0, exp: 9999 } } as any);
    const { res, status, json } = makeRes();
    const next = makeNext();

    requirePermission('manage:users')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('returns 401 when req.user is missing', () => {
    const req = makeReq() as any;
    const { res, status, json } = makeRes();
    const next = makeNext();

    requirePermission('view:reports')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('SCHOOL_ADMIN can manage:payments', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.SCHOOL_ADMIN, iat: 0, exp: 9999 } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requirePermission('manage:payments')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('TEACHER cannot manage:payments', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.TEACHER, iat: 0, exp: 9999 } } as any);
    const { res, status } = makeRes();
    const next = makeNext();

    requirePermission('manage:payments')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('SUPER_ADMIN can access super:admin permission', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.SUPER_ADMIN, iat: 0, exp: 9999 } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requirePermission('super:admin')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('SCHOOL_ADMIN cannot access super:admin permission', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.SCHOOL_ADMIN, iat: 0, exp: 9999 } } as any);
    const { res, status } = makeRes();
    const next = makeNext();

    requirePermission('super:admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('HOD can view:risk but not manage:timetable', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, iat: 0, exp: 9999 } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requirePermission('view:risk')(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    const req2 = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, iat: 0, exp: 9999 } } as any);
    const { res: res2, status: status2 } = makeRes();
    const next2 = makeNext();

    requirePermission('manage:timetable')(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(status2).toHaveBeenCalledWith(403);
  });

  it('all roles can view:reports', () => {
    const roles = Object.values(UserRole);
    for (const role of roles) {
      const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role, iat: 0, exp: 9999 } } as any);
      const { res } = makeRes();
      const next = makeNext();

      requirePermission('view:reports')(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    }
  });
});

// ─── enforceSchoolScope ───────────────────────────────────────────────────────

describe('enforceSchoolScope', () => {
  it('injects req.schoolId from req.user.schoolId and calls next()', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 'school-abc', role: UserRole.TEACHER, iat: 0, exp: 9999 } } as any);
    const { res } = makeRes();
    const next = makeNext();

    enforceSchoolScope(req, res, next);

    expect((req as any).schoolId).toBe('school-abc');
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when req.user is missing', () => {
    const req = makeReq() as any;
    const { res, status, json } = makeRes();
    const next = makeNext();

    enforceSchoolScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('overwrites any pre-existing req.schoolId with the JWT value', () => {
    const req = makeReq({
      user: { sub: 'u1', schoolId: 'jwt-school', role: UserRole.SCHOOL_ADMIN, iat: 0, exp: 9999 },
      schoolId: 'tampered-school',
    } as any);
    const { res } = makeRes();
    const next = makeNext();

    enforceSchoolScope(req, res, next);

    expect((req as any).schoolId).toBe('jwt-school');
    expect(next).toHaveBeenCalledOnce();
  });

  it('works for every role', () => {
    const roles = Object.values(UserRole);
    for (const role of roles) {
      const req = makeReq({ user: { sub: 'u1', schoolId: `school-${role}`, role, iat: 0, exp: 9999 } } as any);
      const { res } = makeRes();
      const next = makeNext();

      enforceSchoolScope(req, res, next);

      expect((req as any).schoolId).toBe(`school-${role}`);
      expect(next).toHaveBeenCalledOnce();
    }
  });
});

// ─── assertSchoolOwnership ────────────────────────────────────────────────────

import { assertSchoolOwnership, requireHODScope, requireStudentSelf, type AuthRequest } from './rbac';
import { AppError } from './errors';

describe('assertSchoolOwnership', () => {
  it('does not throw when resource.schoolId matches req.schoolId', () => {
    const req = { schoolId: 'school-a', user: { sub: 'u1', schoolId: 'school-a', role: UserRole.TEACHER, iat: 0, exp: 9999 } } as unknown as AuthRequest;
    expect(() => assertSchoolOwnership({ schoolId: 'school-a' }, req)).not.toThrow();
  });

  it('throws AppError 403 when resource.schoolId differs from req.schoolId', () => {
    const req = { schoolId: 'school-a', user: { sub: 'u1', schoolId: 'school-a', role: UserRole.TEACHER, iat: 0, exp: 9999 } } as unknown as AuthRequest;
    expect(() => assertSchoolOwnership({ schoolId: 'school-b' }, req)).toThrow(AppError);
  });

  it('thrown AppError has statusCode 403 and code FORBIDDEN', () => {
    const req = { schoolId: 'school-a', user: { sub: 'u1', schoolId: 'school-a', role: UserRole.TEACHER, iat: 0, exp: 9999 } } as unknown as AuthRequest;
    try {
      assertSchoolOwnership({ schoolId: 'school-b' }, req);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).code).toBe('FORBIDDEN');
    }
  });
});

// ─── requireHODScope ─────────────────────────────────────────────────────────

describe('requireHODScope', () => {
  it('calls next() for non-HOD roles without checking department', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.TEACHER, iat: 0, exp: 9999 }, params: { departmentId: 'dept-x' } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for HOD when no departmentId target is present in params or body', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, departmentId: 'dept-1', iat: 0, exp: 9999 }, params: {}, body: {} } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for HOD when body.departmentId matches their own departmentId', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, departmentId: 'dept-1', iat: 0, exp: 9999 }, params: {}, body: { departmentId: 'dept-1' } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 for HOD when body.departmentId differs from their departmentId', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, departmentId: 'dept-1', iat: 0, exp: 9999 }, params: {}, body: { departmentId: 'dept-2' } } as any);
    const { res, status, json } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('returns 403 for HOD when params.departmentId differs from their departmentId', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, departmentId: 'dept-1', iat: 0, exp: 9999 }, params: { departmentId: 'dept-99' }, body: {} } as any);
    const { res, status } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('returns 403 for HOD with no departmentId in JWT', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.HOD, iat: 0, exp: 9999 }, params: {}, body: {} } as any);
    const { res, status } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('returns 401 when req.user is missing', () => {
    const req = makeReq() as any;
    const { res, status, json } = makeRes();
    const next = makeNext();

    requireHODScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });
});

// ─── requireStudentSelf ───────────────────────────────────────────────────────

describe('requireStudentSelf', () => {
  it('calls next() for non-STUDENT roles without checking studentId', () => {
    const req = makeReq({ user: { sub: 'u1', schoolId: 's1', role: UserRole.TEACHER, iat: 0, exp: 9999 }, params: { studentId: 'other-student' } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for STUDENT when params.studentId matches their own sub', () => {
    const req = makeReq({ user: { sub: 'student-1', schoolId: 's1', role: UserRole.STUDENT, iat: 0, exp: 9999 }, params: { studentId: 'student-1' } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for STUDENT when params.id matches their own sub', () => {
    const req = makeReq({ user: { sub: 'student-1', schoolId: 's1', role: UserRole.STUDENT, iat: 0, exp: 9999 }, params: { id: 'student-1' } } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for STUDENT when no studentId param is present (list routes)', () => {
    const req = makeReq({ user: { sub: 'student-1', schoolId: 's1', role: UserRole.STUDENT, iat: 0, exp: 9999 }, params: {} } as any);
    const { res } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 for STUDENT when params.studentId differs from their sub', () => {
    const req = makeReq({ user: { sub: 'student-1', schoolId: 's1', role: UserRole.STUDENT, iat: 0, exp: 9999 }, params: { studentId: 'student-2' } } as any);
    const { res, status, json } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('returns 403 for STUDENT when params.id differs from their sub', () => {
    const req = makeReq({ user: { sub: 'student-1', schoolId: 's1', role: UserRole.STUDENT, iat: 0, exp: 9999 }, params: { id: 'student-99' } } as any);
    const { res, status } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('returns 401 when req.user is missing', () => {
    const req = makeReq() as any;
    const { res, status, json } = makeRes();
    const next = makeNext();

    requireStudentSelf(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });
});
