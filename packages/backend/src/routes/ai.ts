import { Router, type Request, type Response } from 'express';
import { aiService } from '../services/aiService';
import { openaiQuery } from '../services/ai/openaiEngine';
import { AppError } from '../middleware/errors';

export const aiRouter = Router();

// SAMS data intents that require authentication
const DATA_INTENTS = [
  'attendance_percentage', 'absent_students', 'risk_scores', 'top_students',
  'class_comparison', 'generate_timetable', 'remake_timetable', 'view_timetable',
  'student_count', 'session_status', 'system_stats',
];

/**
 * POST /api/v1/ai/query
 * - Authenticated users: full access to all AI features
 * - Unauthenticated users: can ask general knowledge + about SAMS, but NOT school data
 */
aiRouter.post('/query', async (req: Request, res: Response): Promise<void> => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty "question" field is required.');
    }

    // Authenticated user — full access
    if (req.user) {
      const result = await aiService.query(req.user, question.trim());
      res.status(200).json(result);
      return;
    }

    // Unauthenticated user — check if it's a data query
    const { detectIntent } = require('../services/ai/localEngine');
    const intent = detectIntent(question.trim());

    // Block SAMS data queries for unauthenticated users
    if (DATA_INTENTS.includes(intent)) {
      res.status(200).json({
        answer: 'Please log in to access school data like attendance, timetables, and reports. I can answer general questions without login.\n\nTry asking: "What is SAMS?" or "What is photosynthesis?"',
        intent: 'auth_required',
        engine: 'local',
      });
      return;
    }

    // Allow: about_sams, super_admin_help, unknown (goes to Groq for general knowledge)
    const guestUser = {
      sub: 'guest',
      schoolId: 'guest',
      role: 'STUDENT' as any,
      iat: 0,
      exp: 0,
    };

    // For about_sams, use local engine
    if (intent === 'about_sams' || intent === 'super_admin_help') {
      const { localQuery } = require('../services/ai/localEngine');
      const result = await localQuery(guestUser, question.trim());
      res.status(200).json(result);
      return;
    }

    // For general knowledge questions, go directly to Groq/OpenRouter
    try {
      const result = await openaiQuery(guestUser, question.trim());
      res.status(200).json(result);
    } catch {
      res.status(200).json({
        answer: 'I can answer general questions and questions about SAMS. For school-specific data, please log in first.',
        intent: 'fallback',
        engine: 'local',
      });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to process AI query');
  }
});

/**
 * POST /api/v1/ai/voice
 * Process a voice transcription query.
 */
aiRouter.post('/voice', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transcription, question } = req.body;
    const text = transcription || question;

    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty transcription or question is required.');
    }

    const user = req.user || {
      sub: 'guest',
      schoolId: 'guest',
      role: 'STUDENT' as any,
      iat: 0,
      exp: 0,
    };

    const result = await aiService.voiceQuery(user, text.trim());
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to process voice query');
  }
});
