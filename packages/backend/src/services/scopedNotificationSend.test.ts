import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';

const { prismaMock, resolveTeacherClassIdMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn() },
    class: { findUnique: vi.fn() },
    notification: { createMany: vi.fn() },
  },
  resolveTeacherClassIdMock: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../lib/socket', () => ({
  getSocketIO: () => ({ to: () => ({ emit: vi.fn() }) }),
}));
vi.mock('../lib/teacherScope', () => ({
  resolveTeacherClassId: resolveTeacherClassIdMock,
}));

import {
  ScopedNotificationError,
  sendScopedNotification,
  assertAiNotificationChannels,
} from './scopedNotificationSend';

describe('scopedNotificationSend RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', phone: null }]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 });
  });

  it('denies STUDENT from sending', async () => {
    await expect(
      sendScopedNotification(
        { sub: 's1', role: UserRole.STUDENT, schoolId: 'school-1' },
        { scope: 'class', targetId: 'c1', message: 'hi', channels: ['inapp'] },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows TEACHER class in-app to own class only', async () => {
    resolveTeacherClassIdMock.mockResolvedValue('class-1');
    const result = await sendScopedNotification(
      {
        sub: 't1',
        role: UserRole.TEACHER,
        schoolId: 'school-1',
        classId: 'class-1',
      },
      {
        scope: 'class',
        targetId: 'class-1',
        message: 'Hello class',
        channels: ['inapp'],
      },
    );
    expect(result.success).toBe(true);
    expect(result.recipientCount).toBe(1);
  });

  it('denies TEACHER school scope', async () => {
    resolveTeacherClassIdMock.mockResolvedValue('class-1');
    await expect(
      sendScopedNotification(
        { sub: 't1', role: UserRole.TEACHER, schoolId: 'school-1', classId: 'class-1' },
        { scope: 'school', message: 'hi', channels: ['inapp'] },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('only send to their class') });
  });

  it('denies TEACHER wrong class id', async () => {
    resolveTeacherClassIdMock.mockResolvedValue('class-1');
    await expect(
      sendScopedNotification(
        { sub: 't1', role: UserRole.TEACHER, schoolId: 'school-1', classId: 'class-1' },
        { scope: 'class', targetId: 'other-class', message: 'hi', channels: ['inapp'] },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies HOD school-wide scope', async () => {
    await expect(
      sendScopedNotification(
        {
          sub: 'h1',
          role: UserRole.HOD,
          schoolId: 'school-1',
          departmentId: 'dept-1',
        },
        { scope: 'school', message: 'hi', channels: ['inapp'] },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('department') });
  });

  it('allows HOD department scope for own department', async () => {
    const result = await sendScopedNotification(
      {
        sub: 'h1',
        role: UserRole.HOD,
        schoolId: 'school-1',
        departmentId: 'dept-1',
      },
      {
        scope: 'department',
        targetId: 'dept-1',
        targetRole: 'STUDENT',
        message: 'Meeting',
        channels: ['inapp'],
      },
    );
    expect(result.success).toBe(true);
  });

  it('denies HOD another department', async () => {
    await expect(
      sendScopedNotification(
        {
          sub: 'h1',
          role: UserRole.HOD,
          schoolId: 'school-1',
          departmentId: 'dept-1',
        },
        { scope: 'department', targetId: 'dept-2', message: 'hi', channels: ['inapp'] },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows SCHOOL_ADMIN school scope', async () => {
    const result = await sendScopedNotification(
      { sub: 'a1', role: UserRole.SCHOOL_ADMIN, schoolId: 'school-1' },
      { scope: 'school', message: 'Holiday', channels: ['inapp'] },
    );
    expect(result.success).toBe(true);
  });

  it('assertAiNotificationChannels blocks SMS', () => {
    expect(() => assertAiNotificationChannels(['sms'])).toThrow(ScopedNotificationError);
  });
});
