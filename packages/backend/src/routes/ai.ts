import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { aiService } from '../services/aiService';
import { openaiQuery } from '../services/ai/openaiEngine';
import { conversationMemoryService } from '../services/conversationMemoryService';
import { AppError } from '../middleware/errors';
import {
  formatProviderError,
  getMissingAIKeyMessage,
  hasPrimaryAIKey,
  runVisionChatCompletion,
} from '../services/ai/aiProviderConfig';

// Multer config for multi-image uploads (max 4 images, 5MB each)
const aiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

export const aiRouter = Router();

// ─── Optional Auth Middleware ─────────────────────────────────────────────────
// Tries to parse the JWT token if present, but doesn't reject if missing.
// This allows the AI route to work for both authenticated and unauthenticated users.
export function optionalAiAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    req.aiAuthRejected = true;
    return next();
  }

  try {
    const payload = jwt.verify(token, secret) as AccessTokenPayload;
    if (
      typeof payload.sub === 'string' &&
      typeof payload.schoolId === 'string' &&
      Object.values(UserRole).includes(payload.role)
    ) {
      req.user = {
        sub: payload.sub,
        schoolId: payload.schoolId,
        role: payload.role,
        departmentId: payload.departmentId,
        classId: payload.classId,
        iat: payload.iat,
        exp: payload.exp,
      };
    } else {
      req.aiAuthRejected = true;
    }
  } catch {
    req.aiAuthRejected = true;
  }

  next();
}

aiRouter.use(optionalAiAuth);

// SAMS data intents that require authentication
const DATA_INTENTS = [
  'attendance_percentage', 'absent_students', 'risk_scores', 'top_students',
  'class_comparison', 'generate_timetable', 'remake_timetable', 'view_timetable',
  'student_count', 'session_status', 'system_stats',
];

// Keywords that indicate a SAMS data query (even if intent detection misses it)
const SAMS_DATA_KEYWORDS = [
  'my report', 'my attendance', 'class report', 'my class', 'my students',
  'my timetable', 'my schedule', 'my grades', 'my score', 'risk score',
  'absent', 'present', 'late', 'session', 'department report',
  'school report', 'how many students', 'attendance rate',
];

/** True when a question needs a logged-in user (attendance, timetables, etc.). */
export function isSamsDataQuestion(question: string, intent: string): boolean {
  const lowerQuestion = question.trim().toLowerCase();
  return (
    DATA_INTENTS.includes(intent) ||
    SAMS_DATA_KEYWORDS.some((kw) => lowerQuestion.includes(kw))
  );
}

// ─── Conversation Management Endpoints ────────────────────────────────────────

/**
 * GET /api/v1/ai/conversations
 * List conversation threads for the authenticated user (paginated).
 */
aiRouter.get('/conversations', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 50;
  const result = await conversationMemoryService.getThreads(req.user.sub, req.user.schoolId, page, pageSize);
  res.json(result);
});

/**
 * GET /api/v1/ai/conversations/:threadId
 * Get decrypted records for a specific thread (paginated).
 */
aiRouter.get('/conversations/:threadId', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const threadId = req.params.threadId as string;
  const page = parseInt(req.query.page as string || '1') || 1;
  const pageSize = parseInt(req.query.pageSize as string || '100') || 100;
  try {
    const result = await conversationMemoryService.getThreadRecords(req.user.sub, req.user.schoolId, threadId, page, pageSize);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Thread not found') {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    throw err;
  }
});

/**
 * POST /api/v1/ai/conversations
 * Create a new conversation thread.
 */
aiRouter.post('/conversations', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) {
    res.status(400).json({ error: 'Title must be 1-200 characters' });
    return;
  }
  const thread = await conversationMemoryService.createThread(req.user.sub, req.user.schoolId, title.trim());
  res.status(201).json({ thread });
});

/**
 * DELETE /api/v1/ai/conversations/:threadId
 * Delete a thread and all its records.
 */
aiRouter.delete('/conversations/:threadId', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const threadId = req.params.threadId as string;
  try {
    await conversationMemoryService.deleteThread(req.user.sub, req.user.schoolId, threadId);
    res.json({ message: 'Thread deleted successfully' });
  } catch (err) {
    if (err instanceof Error && err.message === 'Thread not found') {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    throw err;
  }
});

/**
 * DELETE /api/v1/ai/conversations
 * Delete all conversation data for the authenticated user.
 */
aiRouter.delete('/conversations', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  await conversationMemoryService.deleteAllUserData(req.user.sub, req.user.schoolId);
  res.json({ message: 'All conversation data deleted' });
});

// ─── AI Query Endpoints ───────────────────────────────────────────────────────

/**
 * POST /api/v1/ai/query
 * - Authenticated users: full access to all AI features
 * - Unauthenticated users: can ask general knowledge + about SAMS, but NOT school data
 */
aiRouter.post('/query', async (req: Request, res: Response): Promise<void> => {
  try {
    const { question, threadId, confirmAction, pendingAction } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty "question" field is required.');
    }

    // Authenticated user — full access
    if (req.user) {
      try {
        const result = await aiService.query(req.user, question.trim(), { threadId, confirmAction, pendingAction });
        const response: Record<string, unknown> = { ...result };
        res.status(200).json(response);
      } catch (aiErr) {
        console.error('[AI] Query error for authenticated user:', (aiErr as Error).message);
        res.status(200).json({
          answer: formatProviderError(aiErr),
          intent: 'ai_error',
          engine: 'openai',
        });
      }
      return;
    }

    // Bearer sent but JWT invalid/expired — return 401 so the client refresh flow runs
    if (req.aiAuthRejected) {
      res.status(401).json({
        error:
          'Your session has expired or is invalid. Sign in again to use school data and AI features.',
        code: 'SESSION_EXPIRED',
        intent: 'session_expired',
      });
      return;
    }

    // Unauthenticated user — check if it's a data query
    const { detectIntent } = require('../services/ai/localEngine');
    const intent = detectIntent(question.trim());
    // Block SAMS data queries for unauthenticated users (intent-based + keyword-based)
    if (isSamsDataQuestion(question.trim(), intent)) {
      res.status(200).json({
        answer:
          'Sign in to access school data like attendance, timetables, and reports. I can answer general questions without login.\n\nIf you are already signed in, sign out and sign in again, or refresh the page.\n\nTry asking: "What is SAMS?" or "What is photosynthesis?"',
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

    // For about_sams, use local engine ONLY if no history (first message)
    const history = req.body.history as Array<{ role: string; content: string }> | undefined;
    const hasHistory = history && history.length > 1;

    if (!hasHistory && (intent === 'about_sams' || intent === 'super_admin_help')) {
      const { localQuery } = require('../services/ai/localEngine');
      const result = await localQuery(guestUser, question.trim());
      res.status(200).json(result);
      return;
    }

    // For all other guest messages, go to Groq WITH conversation history
    try {
      const guestUserRestricted = {
        sub: 'guest',
        schoolId: 'none',
        role: 'STUDENT' as any,
        iat: 0,
        exp: 0,
      };

      if (history && history.length > 0) {
        const { openaiQueryWithHistory } = require('../services/ai/openaiEngine');
        const formattedHistory = history.slice(-10).map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        const result = await openaiQueryWithHistory(guestUserRestricted, question.trim(), formattedHistory);
        res.status(200).json(result);
      } else {
        const result = await openaiQuery(guestUserRestricted, question.trim());
        res.status(200).json(result);
      }
    } catch (guestErr) {
      res.status(200).json({
        answer: formatProviderError(guestErr),
        intent: 'ai_error',
        engine: 'openai',
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

// ─── Image Vision Endpoint ────────────────────────────────────────────────────

/**
 * POST /api/v1/ai/query-with-image
 * Accepts up to 4 image uploads + question, sends to vision model for analysis.
 */
aiRouter.post('/query-with-image', aiUpload.array('images', 4), async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req as any).files as Express.Multer.File[];
    if (!files || files.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'At least one image file is required.');
    }
    const question = (req.body.question as string) || 'What is in this image?';

    // Convert images to base64 content parts
    const imageContent = files.map((file) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
    }));

    if (!hasPrimaryAIKey()) {
      throw new AppError(503, 'CONFIG_ERROR', getMissingAIKeyMessage());
    }

    const answer = await runVisionChatCompletion(
      [{ type: 'text', text: question }, ...imageContent],
      { timeoutMs: 60000 },
    );

    res.status(200).json({
      answer,
      intent: 'image_analysis',
      engine: 'openai',
    });
  } catch (err) {
    if (err instanceof AppError) {
      res.status(200).json({
        answer: err.message,
        intent: 'ai_not_configured',
        engine: 'local',
      });
      return;
    }
    console.error('[AI] Image query error:', (err as Error).message || err);
    res.status(200).json({
      answer: formatProviderError(err),
      intent: 'image_analysis_error',
      engine: 'openai',
    });
  }
});

// ─── Image Generation Endpoint ────────────────────────────────────────────────

/**
 * POST /api/v1/ai/generate-image
 * Generates an image from a text prompt using Pollinations AI (free).
 */
aiRouter.post('/generate-image', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty "prompt" field is required.');
    }

    const encodedPrompt = encodeURIComponent(prompt.trim());
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;

    res.status(200).json({
      imageUrl,
      prompt: prompt.trim(),
      intent: 'image_generation',
      engine: 'pollinations',
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to generate image');
  }
});
