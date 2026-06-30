import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import multer, { type Multer } from 'multer';
import { type AccessTokenPayload, UserRole } from '@sams/shared';
import { aiService } from '../services/aiService';
import { openaiQuery } from '../services/ai/openaiEngine';
import { conversationMemoryService } from '../services/conversationMemoryService';
import { AppError } from '../middleware/errors';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  formatProviderError,
  getMissingAIKeyMessage,
  hasAtomesusAIKey,
  hasFallbackAIKey,
  hasPrimaryAIKey,
  getVisionClientConfigs,
  runVisionChatCompletion,
} from '../services/ai/aiProviderConfig';
import { isConversationMemoryEnabled } from '../services/ai/roleActionsPrompt';

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

/** Return multer failures as chat-shaped JSON (200) instead of a bare 500. */
function aiUploadMiddleware(
  upload: Multer,
  field: string,
  maxCount: number,
): RequestHandler {
  return (req, res, next) => {
    upload.array(field, maxCount)(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      const code = (err as { code?: string }).code;
      let answer = 'Image upload failed. Please try again.';
      if (code === 'LIMIT_FILE_SIZE') {
        answer = 'Each image must be 5 MB or smaller.';
      } else if (code === 'LIMIT_FILE_COUNT') {
        answer = 'You can upload up to 4 images at once.';
      } else if (code === 'LIMIT_UNEXPECTED_FILE') {
        answer = 'Unexpected file field. Use the image upload button only.';
      } else if (err instanceof Error && err.message.includes('Only image')) {
        answer = 'Only image files are allowed (JPEG, PNG, WebP, etc.).';
      }
      res.status(200).json({
        answer,
        intent: 'image_analysis_error',
        engine: 'local',
      });
    });
  };
}

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
aiRouter.get('/conversations', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 50;
  const result = await conversationMemoryService.getThreads(req.user.sub, req.user.schoolId, page, pageSize);
  res.json(result);
}));

/**
 * GET /api/v1/ai/conversations/:threadId
 * Get decrypted records for a specific thread (paginated).
 */
aiRouter.get('/conversations/:threadId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
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
}));

/**
 * POST /api/v1/ai/conversations
 * Create a new conversation thread.
 */
aiRouter.post('/conversations', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  const { title } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) {
    res.status(400).json({ error: 'Title must be 1-200 characters' });
    return;
  }
  const thread = await conversationMemoryService.createThread(req.user.sub, req.user.schoolId, title.trim());
  res.status(201).json({ thread });
}));

/**
 * DELETE /api/v1/ai/conversations/:threadId
 * Delete a thread and all its records.
 */
aiRouter.delete('/conversations/:threadId', asyncHandler(async (req: Request, res: Response): Promise<void> => {
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
}));

/**
 * DELETE /api/v1/ai/conversations
 * Delete all conversation data for the authenticated user.
 */
aiRouter.delete('/conversations', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  await conversationMemoryService.deleteAllUserData(req.user.sub, req.user.schoolId);
  res.json({ message: 'All conversation data deleted' });
}));

// ─── Streaming SSE Endpoint ─────────────────────────────────────────────────

/**
 * POST /api/v1/ai/stream
 * Server-Sent Events endpoint for streaming AI responses word-by-word.
 * Same auth/fallback logic as /api/v1/ai/query but streams tokens via SSE.
 */
aiRouter.post('/stream', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { question, threadId, history: clientHistory } = req.body;

  if (!question || typeof question !== 'string' || !question.trim()) {
    res.status(400).json({ error: 'A non-empty "question" field is required.' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Build guest user if not authenticated
  let user = req.user;
  if (!user) {
    if (req.aiAuthRejected) {
      res.write(`data: ${JSON.stringify({ error: 'Session expired. Sign in again.', code: 'SESSION_EXPIRED' })}\n\n`);
      res.end();
      return;
    }
    user = {
      sub: 'guest',
      schoolId: 'none',
      role: 'STUDENT' as any,
      iat: 0,
      exp: 0,
    };
  }

  // Check for data queries without auth
  if (req.user === undefined && user.sub === 'guest') {
    const { detectIntent } = require('../services/ai/localEngine');
    const { isSamsDataQuestion } = require('../routes/ai');
    const intent = detectIntent(question.trim());
    if (isSamsDataQuestion(question.trim(), intent)) {
      res.write(`data: ${JSON.stringify({ text: 'Sign in to access school data like attendance, timetables, and reports. I can answer general questions without login.\n\nTry asking: "What is SAMS?" or "What is photosynthesis?"' })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }
  }

  // Load history
  const formattedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (Array.isArray(clientHistory)) {
    formattedHistory.push(
      ...clientHistory
        .slice(-10)
        .filter((m: any) => m?.role && m?.content)
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 2000) })),
    );
  }

  // Load conversation memory
  if (user.sub !== 'guest' && threadId) {
    try {
      const { conversationMemoryService } = await import('../services/conversationMemoryService');
      const context = await conversationMemoryService.getContextWindow(
        user.sub,
        user.schoolId,
        threadId,
        20,
      );
      if (context.records.length > 0) {
        const stored = context.records.map((r: any) => [
          { role: 'user' as const, content: String(r.message).slice(0, 2000) },
          { role: 'assistant' as const, content: String(r.response).slice(0, 2000) },
        ]).flat().filter(Boolean);
        // Merge with client history, preferring client hints for freshness
        const seen = new Set(formattedHistory.map((m) => `${m.role}:${m.content}`));
        for (const msg of stored) {
          const key = `${msg.role}:${msg.content}`;
          if (!seen.has(key)) {
            formattedHistory.push(msg);
            seen.add(key);
          }
        }
      }
    } catch {
      // memory unavailable — proceed without history
    }
  }

  // Send a start event
  res.write(`data: ${JSON.stringify({ start: true })}\n\n`);

  try {
    const { streamFromProvider } = await import('../services/ai/streamEngine');

    // Stream the response
    const result = await streamFromProvider(
      user,
      question.trim(),
      formattedHistory.slice(-20),
      (chunk: { text: string }) => {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      },
    );

    // Persist to conversation memory for authenticated users
    if (user.sub !== 'guest') {
      try {
        const { conversationMemoryService } = await import('../services/conversationMemoryService');
        const resolvedThreadId = threadId
          || await conversationMemoryService.resolveThread(user.sub, user.schoolId);
        await conversationMemoryService.persistRecord(
          user.sub,
          user.schoolId,
          resolvedThreadId,
          question.trim().slice(0, 2000),
          result.answer.slice(0, 10000),
        );
      } catch (memErr) {
        console.error('[AI/Stream] Failed to persist conversation:', memErr);
      }
    }

    // Send intent + done
    res.write(`data: ${JSON.stringify({ intent: result.intent, engine: result.engine, done: true })}\n\n`);
  } catch (err) {
    console.error('[AI/Stream] Error:', err);
    res.write(`data: ${JSON.stringify({ text: "I'm having trouble connecting. Please try again.", error: true, done: true })}\n\n`);
  }

  res.end();
}));

// ─── AI Query Endpoints ───────────────────────────────────────────────────────

/**
 * POST /api/v1/ai/query
 * - Authenticated users: full access to all AI features
 * - Unauthenticated users: can ask general knowledge + about SAMS, but NOT school data
 */
aiRouter.post('/query', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const { question, threadId, confirmAction, pendingAction, history: clientHistory } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-empty "question" field is required.');
    }

    // Authenticated user — full access
    if (req.user) {
      try {
        const result = await aiService.query(req.user, question.trim(), { threadId, confirmAction, pendingAction, history: clientHistory });
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
}));

/**
 * POST /api/v1/ai/voice
 * Process a voice transcription query.
 */
aiRouter.post('/voice', asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

  try {
    const result = await aiService.voiceQuery(user, text.trim());
    res.status(200).json(result);
  } catch (voiceErr) {
    console.error('[AI] Voice query error:', (voiceErr as Error).message);
    res.status(200).json({
      answer: formatProviderError(voiceErr),
      intent: 'ai_error',
      engine: 'openai',
    });
  }
}));

// ─── Image Vision Endpoint ────────────────────────────────────────────────────

/**
 * POST /api/v1/ai/query-with-image
 * Accepts up to 4 image uploads + question, sends to vision model for analysis.
 */
aiRouter.post('/query-with-image', aiUploadMiddleware(aiUpload, 'images', 4), asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req as any).files as Express.Multer.File[];
    if (!files || files.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'At least one image file is required.');
    }
    const question = (req.body.question as string) || 'What is in this image?';
    const requestedThreadId = typeof req.body.threadId === 'string' ? req.body.threadId : undefined;
    let resolvedThreadId: string | undefined;
    if (req.user && isConversationMemoryEnabled()) {
      try {
        resolvedThreadId = await conversationMemoryService.resolveThread(
          req.user.sub,
          req.user.schoolId,
          requestedThreadId,
        );
      } catch (memoryErr) {
        console.error('[AI/Vision] Thread resolution failed:', memoryErr);
        resolvedThreadId = requestedThreadId;
      }
    }

    // Convert images to base64 content parts
    const imageContent = files.map((file) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
    }));

    if (!hasPrimaryAIKey() && !hasFallbackAIKey() && !hasAtomesusAIKey()) {
      throw new AppError(503, 'CONFIG_ERROR', getMissingAIKeyMessage());
    }

    const visionConfigs = getVisionClientConfigs({ timeoutMs: 60000 });
    if (visionConfigs.length === 0) {
      throw new AppError(
        503,
        'CONFIG_ERROR',
        'Image analysis requires OpenRouter/OpenAI with VISION_MODEL, or Atomesus with ATOMESUS_VISION_MODEL set to an image-capable model.',
      );
    }

    const answer = await runVisionChatCompletion(
      [{ type: 'text', text: question }, ...imageContent],
      { timeoutMs: 60000 },
    );

    if (req.user && resolvedThreadId) {
      try {
        await conversationMemoryService.persistRecord(
          req.user.sub,
          req.user.schoolId,
          resolvedThreadId,
          `[Image upload: ${files.length} file(s)] ${question}`.slice(0, 2000),
          answer.slice(0, 10000),
        );
      } catch (memoryErr) {
        console.error('[AI/Vision] Failed to persist conversation record:', memoryErr);
      }
    }

    res.status(200).json({
      answer,
      intent: 'image_analysis',
      engine: 'openai',
      threadId: resolvedThreadId,
    });
  } catch (err) {
    if (err instanceof AppError) {
      const intent =
        err.code === 'CONFIG_ERROR' ? 'ai_not_configured' : 'image_analysis_error';
      res.status(200).json({
        answer: err.message,
        intent,
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
}));

// ─── Image Generation Endpoint ────────────────────────────────────────────────

/**
 * POST /api/v1/ai/generate-image
 * Generates an image from a text prompt using Pollinations AI (free).
 */
aiRouter.post('/generate-image', asyncHandler(async (req: Request, res: Response): Promise<void> => {
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
}));
