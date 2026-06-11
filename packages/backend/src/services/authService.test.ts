import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authService } from './authService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    school: { findUnique: vi.fn() },
    refreshToken: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

vi.mock('./auditService', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./notificationService', () => ({
  notificationService: {
    sendInApp: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

describe('authService school suspension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validateLoginCredentials throws SCHOOL_SUSPENDED when school is suspended', async () => {
    const passwordHash = await bcrypt.hash('password123', 12);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-1',
      schoolId: 'school-1',
      role: 'TEACHER',
      isLocked: false,
      failedLoginCount: 0,
      failedLoginWindowStart: null,
      passwordHash,
      departmentId: null,
      classId: null,
    } as any);
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: true,
      schoolCode: 'SCHOOL1',
    } as any);

    await expect(
      authService.validateLoginCredentials('', 'teacher1', 'password123'),
    ).rejects.toThrow('SCHOOL_SUSPENDED');
  });

  it('refresh throws SCHOOL_SUSPENDED when school is suspended', async () => {
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    const refreshToken = jwt.sign({ sub: 'user-1', jti: 'jti-1' }, 'test-refresh-secret');

    vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([
      {
        id: 'rt-1',
        tokenHash: await bcrypt.hash(refreshToken, 12),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ] as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      schoolId: 'school-1',
      role: 'TEACHER',
      isLocked: false,
      departmentId: null,
      classId: null,
    } as any);
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: true,
      schoolCode: 'SCHOOL1',
    } as any);

    await expect(authService.refresh(refreshToken)).rejects.toThrow('SCHOOL_SUSPENDED');
  });

  it('generateTokensForUser throws SCHOOL_SUSPENDED when school is suspended', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      schoolId: 'school-1',
      role: 'TEACHER',
      isLocked: false,
      departmentId: null,
      classId: null,
    } as any);
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: true,
      schoolCode: 'SCHOOL1',
    } as any);

    await expect(authService.generateTokensForUser('user-1')).rejects.toThrow('SCHOOL_SUSPENDED');
  });

  it('uses a temporary cooldown instead of permanently locking after repeated bad passwords', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-1',
      schoolId: 'school-1',
      role: 'TEACHER',
      isLocked: false,
      failedLoginCount: 14,
      failedLoginWindowStart: new Date(),
      passwordHash,
      departmentId: null,
      classId: null,
    } as any);
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: false,
      schoolCode: 'SCHOOL1',
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await expect(
      authService.validateLoginCredentials('', 'teacher1', 'wrong-password'),
    ).rejects.toThrow('LOGIN_COOLDOWN');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          failedLoginCount: 15,
        }),
      }),
    );
    expect(prisma.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isLocked: true }),
      }),
    );
  });

  it('clears an old locked flag when the correct password is supplied', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 12);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-1',
      schoolId: 'school-1',
      role: 'TEACHER',
      isLocked: true,
      failedLoginCount: 4,
      failedLoginWindowStart: new Date(),
      passwordHash,
      departmentId: null,
      classId: null,
    } as any);
    vi.mocked(prisma.school.findUnique).mockResolvedValue({
      isSuspended: false,
      schoolCode: 'SCHOOL1',
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    await expect(
      authService.validateLoginCredentials('', 'teacher1', 'correct-password'),
    ).resolves.toMatchObject({ id: 'user-1' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        isLocked: false,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
      },
    });
  });

  it('scopes identifier lookup to school code when one is supplied', async () => {
    const passwordHash = await bcrypt.hash('password123', 12);
    vi.mocked(prisma.school.findUnique)
      .mockResolvedValueOnce({ id: 'school-1' } as any)
      .mockResolvedValueOnce({ isSuspended: false, schoolCode: 'SCHOOL1' } as any);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: 'user-1',
        schoolId: 'school-1',
        role: 'STUDENT',
        isLocked: false,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        passwordHash,
        departmentId: null,
        classId: null,
      },
    ] as any);

    await expect(
      authService.validateLoginCredentials('school1', 'student@example.com', 'password123'),
    ).resolves.toMatchObject({ id: 'user-1' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ schoolId: 'school-1' }),
      }),
    );
  });

  it('maps SUPERADMIN login code to the platform school', async () => {
    const passwordHash = await bcrypt.hash('password123', 12);
    vi.mocked(prisma.school.findUnique)
      .mockResolvedValueOnce({ id: 'platform-school' } as any)
      .mockResolvedValueOnce({ isSuspended: false, schoolCode: 'SAMS_PLATFORM' } as any);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: 'super-1',
        schoolId: 'platform-school',
        role: 'SUPER_ADMIN',
        isLocked: false,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        passwordHash,
        departmentId: null,
        classId: null,
      },
    ] as any);

    await expect(
      authService.validateLoginCredentials('SUPERADMIN', 'admin@smart-managment.com', 'password123'),
    ).resolves.toMatchObject({ id: 'super-1', role: 'SUPER_ADMIN' });

    expect(prisma.school.findUnique).toHaveBeenNthCalledWith(1, {
      where: { schoolCode: 'SAMS_PLATFORM' },
      select: { id: true },
    });
  });
});
