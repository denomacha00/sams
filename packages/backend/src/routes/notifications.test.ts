import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { UserRole } from '@sams/shared';

vi.mock('../lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    department: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../lib/socket', () => ({
  getSocketIO: () => ({
    to: () => ({ emit: vi.fn() }),
  }),
}));

vi.mock('../lib/teacherScope', () => ({
  resolveTeacherClassId: vi.fn(),
}));

import { notificationsRouter } from './notifications';
import { prisma } from '../lib/prisma';
import { resolveTeacherClassId } from '../lib/teacherScope';
import { AppError } from '../middleware/errors';

function createTestApp(user: {
  sub: string;
  schoolId: string;
  role: UserRole;
  departmentId?: string;
  classId?: string;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { ...user, iat: 0, exp: 0 };
    req.schoolId = user.schoolId;
    next();
  });
  app.use('/notifications', notificationsRouter);
  app.use((err: unknown, _req: unknown, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode || 500).json({ error: e.message || 'Internal error', code: 'INTERNAL_ERROR' });
  });
  return app;
}

describe('POST /notifications/send — teacher scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveTeacherClassId as ReturnType<typeof vi.fn>).mockResolvedValue('class-1');
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'student-1', phone: null },
      { id: 'student-2', phone: null },
    ]);
    (prisma.notification.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });
  });

  it('allows teacher to send in-app message to their class students', async () => {
    const request = (await import('supertest')).default;
    const app = createTestApp({
      sub: 'teacher-1',
      schoolId: 'school-1',
      role: UserRole.TEACHER,
      classId: 'class-1',
    });

    const res = await request(app)
      .post('/notifications/send')
      .send({
        scope: 'class',
        targetId: 'class-1',
        targetRole: 'STUDENT',
        message: 'Hello class',
        channels: ['inapp'],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recipientCount).toBe(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classId: 'class-1',
          role: 'STUDENT',
        }),
      }),
    );
  });

  it('denies teacher sending to another class', async () => {
    const request = (await import('supertest')).default;
    const app = createTestApp({
      sub: 'teacher-1',
      schoolId: 'school-1',
      role: UserRole.TEACHER,
    });

    const res = await request(app)
      .post('/notifications/send')
      .send({
        scope: 'class',
        targetId: 'class-other',
        message: 'Hello',
        channels: ['inapp'],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/own class/i);
  });

  it('GET /sent returns batches grouped by senderId', async () => {
    const request = (await import('supertest')).default;
    const app = createTestApp({
      sub: 'teacher-1',
      schoolId: 'school-1',
      role: UserRole.TEACHER,
      classId: 'class-1',
    });

    const now = new Date();
    (prisma.notification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'n1',
        senderId: 'teacher-1',
        batchId: 'batch-a',
        title: 'Class message',
        message: 'Hello',
        createdAt: now,
        scope: 'class',
        targetId: 'class-1',
        targetRole: 'STUDENT',
      },
      {
        id: 'n2',
        senderId: 'teacher-1',
        batchId: 'batch-a',
        title: 'Class message',
        message: 'Hello',
        createdAt: now,
        scope: 'class',
        targetId: 'class-1',
        targetRole: 'STUDENT',
      },
    ]);
    (prisma.notification.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (prisma.class.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Form 1A' });

    const res = await request(app).get('/notifications/sent');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].recipientCount).toBe(2);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { senderId: 'teacher-1' } }),
    );
  });

  it('defaults targetId from resolved teacher class when omitted', async () => {
    const request = (await import('supertest')).default;
    const app = createTestApp({
      sub: 'teacher-1',
      schoolId: 'school-1',
      role: UserRole.TEACHER,
    });

    const res = await request(app)
      .post('/notifications/send')
      .send({
        scope: 'class',
        message: 'Reminder',
        channels: ['inapp'],
      });

    expect(res.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classId: 'class-1' }),
      }),
    );
  });
});
