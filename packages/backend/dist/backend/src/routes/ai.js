"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRouter = void 0;
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const multer_1 = __importDefault(require("multer"));
const shared_1 = require("@sams/shared");
const aiService_1 = require("../services/aiService");
const openaiEngine_1 = require("../services/ai/openaiEngine");
const conversationMemoryService_1 = require("../services/conversationMemoryService");
const errors_1 = require("../middleware/errors");
// Multer config for multi-image uploads (max 4 images, 5MB each)
const aiUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 4 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/'))
            cb(null, true);
        else
            cb(new Error('Only image files are allowed'));
    },
});
exports.aiRouter = (0, express_1.Router)();
// ─── Optional Auth Middleware ─────────────────────────────────────────────────
// Tries to parse the JWT token if present, but doesn't reject if missing.
// This allows the AI route to work for both authenticated and unauthenticated users.
exports.aiRouter.use((req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }
    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return next();
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, secret);
        if (typeof payload.sub === 'string' &&
            typeof payload.schoolId === 'string' &&
            Object.values(shared_1.UserRole).includes(payload.role)) {
            req.user = {
                sub: payload.sub,
                schoolId: payload.schoolId,
                role: payload.role,
                departmentId: payload.departmentId,
                classId: payload.classId,
                iat: payload.iat,
                exp: payload.exp,
            };
        }
    }
    catch {
        // Token invalid/expired — continue as unauthenticated
    }
    next();
});
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
// ─── Conversation Management Endpoints ────────────────────────────────────────
/**
 * GET /api/v1/ai/conversations
 * List conversation threads for the authenticated user (paginated).
 */
exports.aiRouter.get('/conversations', async (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const result = await conversationMemoryService_1.conversationMemoryService.getThreads(req.user.sub, req.user.schoolId, page, pageSize);
    res.json(result);
});
/**
 * GET /api/v1/ai/conversations/:threadId
 * Get decrypted records for a specific thread (paginated).
 */
exports.aiRouter.get('/conversations/:threadId', async (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const threadId = req.params.threadId;
    const page = parseInt(req.query.page || '1') || 1;
    const pageSize = parseInt(req.query.pageSize || '100') || 100;
    try {
        const result = await conversationMemoryService_1.conversationMemoryService.getThreadRecords(req.user.sub, req.user.schoolId, threadId, page, pageSize);
        res.json(result);
    }
    catch (err) {
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
exports.aiRouter.post('/conversations', async (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const { title } = req.body;
    if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) {
        res.status(400).json({ error: 'Title must be 1-200 characters' });
        return;
    }
    const thread = await conversationMemoryService_1.conversationMemoryService.createThread(req.user.sub, req.user.schoolId, title.trim());
    res.status(201).json({ thread });
});
/**
 * DELETE /api/v1/ai/conversations/:threadId
 * Delete a thread and all its records.
 */
exports.aiRouter.delete('/conversations/:threadId', async (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const threadId = req.params.threadId;
    try {
        await conversationMemoryService_1.conversationMemoryService.deleteThread(req.user.sub, req.user.schoolId, threadId);
        res.json({ message: 'Thread deleted successfully' });
    }
    catch (err) {
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
exports.aiRouter.delete('/conversations', async (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    await conversationMemoryService_1.conversationMemoryService.deleteAllUserData(req.user.sub, req.user.schoolId);
    res.json({ message: 'All conversation data deleted' });
});
// ─── AI Query Endpoints ───────────────────────────────────────────────────────
/**
 * POST /api/v1/ai/query
 * - Authenticated users: full access to all AI features
 * - Unauthenticated users: can ask general knowledge + about SAMS, but NOT school data
 */
exports.aiRouter.post('/query', async (req, res) => {
    try {
        const { question, threadId, confirmAction, pendingAction } = req.body;
        if (!question || typeof question !== 'string' || !question.trim()) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'A non-empty "question" field is required.');
        }
        // Authenticated user — full access
        if (req.user) {
            const result = await aiService_1.aiService.query(req.user, question.trim(), { threadId, confirmAction, pendingAction });
            const response = { ...result };
            res.status(200).json(response);
            return;
        }
        // Unauthenticated user — check if it's a data query
        const { detectIntent } = require('../services/ai/localEngine');
        const intent = detectIntent(question.trim());
        const lowerQuestion = question.trim().toLowerCase();
        // Block SAMS data queries for unauthenticated users (intent-based + keyword-based)
        const isDataQuery = DATA_INTENTS.includes(intent) ||
            SAMS_DATA_KEYWORDS.some((kw) => lowerQuestion.includes(kw));
        if (isDataQuery) {
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
            role: 'STUDENT',
            iat: 0,
            exp: 0,
        };
        // For about_sams, use local engine ONLY if no history (first message)
        const history = req.body.history;
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
                role: 'STUDENT',
                iat: 0,
                exp: 0,
            };
            if (history && history.length > 0) {
                const { openaiQueryWithHistory } = require('../services/ai/openaiEngine');
                const formattedHistory = history.slice(-10).map((m) => ({
                    role: m.role,
                    content: m.content,
                }));
                const result = await openaiQueryWithHistory(guestUserRestricted, question.trim(), formattedHistory);
                res.status(200).json(result);
            }
            else {
                const result = await (0, openaiEngine_1.openaiQuery)(guestUserRestricted, question.trim());
                res.status(200).json(result);
            }
        }
        catch {
            res.status(200).json({
                answer: 'I can answer general questions and questions about SAMS. For school-specific data, please log in first.',
                intent: 'fallback',
                engine: 'local',
            });
        }
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to process AI query');
    }
});
/**
 * POST /api/v1/ai/voice
 * Process a voice transcription query.
 */
exports.aiRouter.post('/voice', async (req, res) => {
    try {
        const { transcription, question } = req.body;
        const text = transcription || question;
        if (!text || typeof text !== 'string' || !text.trim()) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'A non-empty transcription or question is required.');
        }
        const user = req.user || {
            sub: 'guest',
            schoolId: 'guest',
            role: 'STUDENT',
            iat: 0,
            exp: 0,
        };
        const result = await aiService_1.aiService.voiceQuery(user, text.trim());
        res.status(200).json(result);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to process voice query');
    }
});
// ─── Image Vision Endpoint ────────────────────────────────────────────────────
/**
 * POST /api/v1/ai/query-with-image
 * Accepts up to 4 image uploads + question, sends to vision model for analysis.
 */
exports.aiRouter.post('/query-with-image', aiUpload.array('images', 4), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'At least one image file is required.');
        }
        const question = req.body.question || 'What is in this image?';
        // Convert images to base64 content parts
        const imageContent = files.map((file) => ({
            type: 'image_url',
            image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
        }));
        // Call vision model
        const OpenAI = (await Promise.resolve().then(() => __importStar(require('openai')))).default;
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new errors_1.AppError(500, 'CONFIG_ERROR', 'AI API key not configured');
        }
        const client = new OpenAI({
            apiKey,
            baseURL: process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1',
            timeout: 60000, // 60 second timeout for vision
        });
        const response = await client.chat.completions.create({
            model: process.env.VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: question },
                        ...imageContent,
                    ],
                },
            ],
            max_tokens: 1024,
        });
        const answer = response.choices[0]?.message?.content || 'I could not analyze the image(s).';
        res.status(200).json({
            answer,
            intent: 'image_analysis',
            engine: 'openai',
        });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        console.error('[AI] Image query error:', err.message || err);
        res.status(200).json({
            answer: 'I could not analyze the image. This may be due to the image being too large or the vision service being temporarily unavailable. Try a smaller image or try again later.',
            intent: 'image_analysis_error',
            engine: 'local',
        });
    }
});
// ─── Image Generation Endpoint ────────────────────────────────────────────────
/**
 * POST /api/v1/ai/generate-image
 * Generates an image from a text prompt using Pollinations AI (free).
 */
exports.aiRouter.post('/generate-image', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'A non-empty "prompt" field is required.');
        }
        const encodedPrompt = encodeURIComponent(prompt.trim());
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true`;
        res.status(200).json({
            imageUrl,
            prompt: prompt.trim(),
            intent: 'image_generation',
            engine: 'pollinations',
        });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to generate image');
    }
});
//# sourceMappingURL=ai.js.map