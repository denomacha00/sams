import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { aiService } from '../services/aiService';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const querySchema = z.object({
  question: z.string().min(1, 'Question is required').max(1000, 'Question must be 1000 characters or less'),
});

const voiceSchema = z.object({
  transcription: z.string().min(1, 'Transcription is required').max(2000, 'Transcription must be 2000 characters or less'),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const aiRouter = Router();

/**
 * POST /api/v1/ai/query
 * Process a text query through the AI service.
 * Routes to local engine first; falls back to OpenAI for Pro/Enterprise plans.
 *
 * Requirements: 14.1
 */
aiRouter.post('/query', async (req: Request, res: Response): Promise<void> => {
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.errors[0]?.message ?? 'Validation error',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const { question } = parsed.data;
  const user = req.user;

  try {
    const result = await aiService.query(user, question);
    res.json(result);
  } catch (err) {
    console.error('[AI] Query error:', err);
    res.status(500).json({
      answer: 'Sorry, I encountered an error processing your question. Please try again.',
      intent: 'error',
      engine: 'local',
    });
  }
});

/**
 * POST /api/v1/ai/voice
 * Process a voice query (client-side speech-to-text transcription).
 * Accepts the transcribed text and processes it through the AI service.
 *
 * Requirements: 14.1, 14.6
 */
aiRouter.post('/voice', async (req: Request, res: Response): Promise<void> => {
  const parsed = voiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.errors[0]?.message ?? 'Validation error',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const { transcription } = parsed.data;
  const user = req.user;

  try {
    const result = await aiService.voiceQuery(user, transcription);
    res.json(result);
  } catch (err) {
    console.error('[AI] Voice query error:', err);
    res.status(500).json({
      answer: 'Sorry, I encountered an error processing your voice query. Please try again.',
      intent: 'error',
      engine: 'local',
    });
  }
});
