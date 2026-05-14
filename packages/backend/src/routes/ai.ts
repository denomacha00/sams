import { Router, type Request, type Response } from 'express';
import { aiService } from '../services/aiService';
import { AppError } from '../middleware/errors';

// ─── Router ───────────────────────────────────────────────────────────────────

export const aiRouter = Router();

/**
 * POST /api/v1/ai/query
 * Process a text-based AI query.
 * Requires authentication (handled by global middleware).
 * Requirement 14.1
 */
aiRouter.post('/query', async (req: Request, res: Response): Promise<void> => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty "question" field is required.');
    }

    const result = await aiService.query(req.user, question.trim());
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to process AI query');
  }
});

/**
 * POST /api/v1/ai/voice
 * Process a voice transcription query.
 * The client performs speech-to-text and sends the text here.
 * Requirement 14.6
 */
aiRouter.post('/voice', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transcription, question } = req.body;
    const text = transcription || question;

    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty transcription or question is required.');
    }

    const result = await aiService.voiceQuery(req.user, text.trim());
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to process voice query');
  }
});
