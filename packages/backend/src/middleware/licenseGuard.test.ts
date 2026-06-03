import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UserRole } from '@sams/shared';
import { licenseGuard } from './licenseGuard';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    school: { findUnique: vi.fn() },
  },
}));

function makeReq(overrides: Partial<Request> = {}): Request {
  return { user: undefined, ...overrides } as unknown as Request;
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

describe('licenseGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when req.user is missing', async () => {
    const req = makeReq();
    const { res, status, json } = makeRes();
    const next = makeNext();

    await licenseGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('skips suspension check for SUPER_ADMIN', async () => {
    const req = makeReq({
      user: { sub: 'sa-1', schoolId: 'platform', role: UserRole.SUPER_ADMIN, iat: 0, exp: 9999 },
    } as any);
    const { res } = makeRes();
    const next = makeNext();

    await licenseGuard(req, res, next);

    expect(prisma.school.findUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips suspension check for platform school', async () => {
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: true,
      schoolCode: 'SAMS_PLATFORM',
    } as any);

    const req = makeReq({
      user: { sub: 'u1', schoolId: 'platform', role: UserRole.SCHOOL_ADMIN, iat: 0, exp: 9999 },
    } as any);
    const { res } = makeRes();
    const next = makeNext();

    await licenseGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 SCHOOL_SUSPENDED when school is suspended', async () => {
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: true,
      schoolCode: 'SCHOOL1',
    } as any);

    const req = makeReq({
      user: { sub: 'u1', schoolId: 'school-1', role: UserRole.TEACHER, iat: 0, exp: 9999 },
    } as any);
    const { res, status, json } = makeRes();
    const next = makeNext();

    await licenseGuard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: 'Your school account has been suspended. Please contact your administrator.',
      code: 'SCHOOL_SUSPENDED',
    });
  });

  it('calls next() when school is active', async () => {
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: false,
      schoolCode: 'SCHOOL1',
    } as any);

    const req = makeReq({
      user: { sub: 'u1', schoolId: 'school-1', role: UserRole.STUDENT, iat: 0, exp: 9999 },
    } as any);
    const { res } = makeRes();
    const next = makeNext();

    await licenseGuard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
