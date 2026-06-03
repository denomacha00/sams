import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { aiRouter } from './ai';

vi.mock('../services/ai/aiProviderConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ai/aiProviderConfig')>();
  return {
    ...actual,
    runVisionChatCompletion: vi.fn().mockResolvedValue('A red apple on a table.'),
    getVisionClientConfigs: vi.fn().mockReturnValue([
      { client: {}, model: 'test/vision', label: 'fallback' as const },
    ]),
  };
});

function createVisionApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);
  return app;
}

describe('POST /ai/query-with-image', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'gsk_test';
    process.env.OPENAI_FALLBACK_KEY = 'sk-or-test';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_FALLBACK_KEY;
  });

  it('returns vision analysis without Authorization header', async () => {
    const app = createVisionApp();
    const res = await request(app)
      .post('/ai/query-with-image')
      .field('question', 'What is in this image?')
      .attach('images', Buffer.from('fake-png'), {
        filename: 'test.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('image_analysis');
    expect(res.body.answer).toContain('apple');
  });

  it('returns chat-shaped error when file is too large', async () => {
    const app = createVisionApp();
    const big = Buffer.alloc(6 * 1024 * 1024);
    const res = await request(app)
      .post('/ai/query-with-image')
      .field('question', 'Describe this')
      .attach('images', big, { filename: 'big.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('upload_error');
    expect(res.body.answer).not.toContain('5 MB');
  });
});
