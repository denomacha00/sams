import { Router, type Request, type Response } from 'express';
import { aiService } from '../services/aiService';
import { AppError } from '../middleware/errors';

// ─── Router ───────────────────────────────────────────────────────────────────

export const aiRouter = Router();

/**
 * POST /api/v1/ai/query
 * Process a text-based AI query.
 * Allows unauthenticated requests but only for about_sams intent.
 * Authenticated users get full AI access.
 * Requirement 14.1
 */
aiRouter.post('/query', async (req: Request, res: Response): Promise<void> => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty "question" field is required.');
    }

    // If user is not authenticated, only answer basic about_sams questions
    if (!req.user) {
      const aboutSamsPatterns = [
        /what is sams/i,
        /about sams/i,
        /tell me about/i,
        /how does sams work/i,
        /sams features/i,
        /what can sams do/i,
        /sams system/i,
        /smart attendance/i,
        /help/i,
      ];

      const isAboutSams = aboutSamsPatterns.some((p) => p.test(question.trim()));

      if (!isAboutSams) {
        res.status(200).json({
          answer: 'Please log in to access full AI assistant features. I can only answer basic questions about SAMS without authentication.\n\nTry asking: "What is SAMS?" or "What can SAMS do?"',
          intent: 'auth_required',
          engine: 'local',
        });
        return;
      }

      // Provide a static about_sams response for unauthenticated users
      res.status(200).json({
        answer: `SAMS (Smart Attendance Management System) is a multi-school enterprise platform for Kenyan institutions.\n\n**Key Features:**\n• QR Code attendance scanning\n• GPS-verified attendance\n• Biometric (fingerprint/face) verification\n• Real-time attendance tracking\n• Risk score analysis for at-risk students\n• AI-powered insights and reports\n• Multi-tenant (supports multiple schools)\n• SMS & email notifications\n• Offline-capable mobile support\n\n**User Roles:**\n• Super Admin — manages all schools\n• School Admin — manages one school\n• HOD — manages a department\n• Teacher — manages classes & sessions\n• Student — scans attendance\n\nFor more details, please log in or contact your school administrator.`,
        intent: 'about_sams',
        engine: 'local',
      });
      return;
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
