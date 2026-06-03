import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@sams/shared';
import { aiRouter, optionalAiAuth, isSamsDataQuestion } from './ai';

vi.mock('../services/aiService', () => ({
  aiService: {
    query: vi.fn().mockResolvedValue({ answer: 'authenticated answer', intent: 'unknown', engine: 'openai' }),
    voiceQuery: vi.fn(),
  },
}));

vi.mock('../services/ai/localEngine', () => ({
  detectIntent: vi.fn().mockReturnValue('attendance_percentage'),
  localQuery: vi.fn(),
}));

vi.mock('../services/ai/openaiEngine', () => ({
  openaiQuery: vi.fn(),
  openaiQueryWithHistory: vi.fn(),
}));

vi.mock('../services/conversationMemoryService', () => ({
  conversationMemoryService: {
    getThreads: vi.fn(),
    getThreadRecords: vi.fn(),
    createThread: vi.fn(),
    deleteThread: vi.fn(),
    deleteAllUserData: vi.fn(),
  },
}));

function createAiApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);
  app.use(
    (
      err: { statusCode?: number; message?: string; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.statusCode ?? 500).json({ error: err.message, code: err.code });
    },
  );
  return app;
}

describe('AI optional auth', () => {
  const secret = 'test-jwt-secret-for-ai-auth';

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('returns 401 when Bearer token is expired (not guest fallback)', async () => {
    const expired = jwt.sign(
      { sub: 'user-1', schoolId: 'school-1', role: UserRole.TEACHER },
      secret,
      { expiresIn: '-1s' },
    );

    const app = createAiApp();
    const res = await request(app)
      .post('/ai/query')
      .set('Authorization', `Bearer ${expired}`)
      .send({ question: 'What is my attendance rate?' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    expect(res.body.intent).toBe('session_expired');
  });

  it('marks aiAuthRejected when JWT signature is invalid', async () => {
    const req = {
      headers: { authorization: 'Bearer not-a-real-jwt' },
    } as express.Request;
    const next = vi.fn();

    optionalAiAuth(req, {} as express.Response, next);

    expect(req.aiAuthRejected).toBe(true);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('detects school data questions for guest blocking', () => {
    expect(isSamsDataQuestion('What is my attendance rate?', 'attendance_percentage')).toBe(true);
    expect(isSamsDataQuestion('What is photosynthesis?', 'unknown')).toBe(false);
  });
});
