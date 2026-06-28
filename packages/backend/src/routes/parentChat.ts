import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../middleware/errors';
import {
  getParentTeachers,
  parentSendToTeacher,
  teacherReplyToParent,
  getTeacherParentConversations,
  getParentTeacherThread,
} from '../services/parentChatService';

// ─── Router ───────────────────────────────────────────────────────────────────

export const parentChatRouter = Router();

/**
 * GET /api/v1/parent-chat/teachers
 * Guardians: list all teachers of linked children (to start a conversation).
 */
parentChatRouter.get('/teachers', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'GUARDIAN') {
    throw new AppError(403, 'FORBIDDEN', 'Only guardians can list teachers');
  }

  const teachers = await getParentTeachers(req.user.sub, req.schoolId);
  res.status(200).json(teachers);
});

/**
 * GET /api/v1/parent-chat/thread/:parentId
 * Teachers: view conversation thread with a specific parent.
 */
parentChatRouter.get('/thread/:otherId', async (req: Request, res: Response): Promise<void> => {
  const otherId = String(req.params.otherId);
  const userId = req.user.sub;

  const isGuardian = req.user.role === 'GUARDIAN';
  const isTeacher = req.user.role === 'TEACHER';

  if (!isGuardian && !isTeacher) {
    throw new AppError(403, 'FORBIDDEN', 'Not allowed');
  }

  // For teacher: otherId is the parentId. For guardian: otherId is the teacherId.
  const thread = await getParentTeacherThread(req.schoolId, userId, otherId);
  res.status(200).json(thread);
});

/**
 * POST /api/v1/parent-chat/send
 * Guardians: send message to a teacher.
 */
parentChatRouter.post('/send', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'GUARDIAN') {
    throw new AppError(403, 'FORBIDDEN', 'Only guardians can send parent-teacher messages');
  }

  const { teacherId, message, childId } = req.body;
  if (!teacherId || !message?.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'teacherId and message are required');
  }

  const result = await parentSendToTeacher(req.user.sub, req.schoolId, teacherId, message.trim(), childId);
  if (!result.success) {
    throw new AppError(400, 'SEND_FAILED', result.error ?? 'Failed to send');
  }

  res.status(200).json({ success: true });
});

/**
 * POST /api/v1/parent-chat/reply
 * Teachers: reply to a parent.
 */
parentChatRouter.post('/reply', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'TEACHER') {
    throw new AppError(403, 'FORBIDDEN', 'Only teachers can reply');
  }

  const { parentId, message } = req.body;
  if (!parentId || !message?.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'parentId and message are required');
  }

  const result = await teacherReplyToParent(req.user.sub, req.schoolId, parentId, message.trim());
  if (!result.success) {
    throw new AppError(400, 'SEND_FAILED', result.error ?? 'Failed to reply');
  }

  res.status(200).json({ success: true });
});

/**
 * GET /api/v1/parent-chat/conversations
 * Teachers: list all parent conversations.
 */
parentChatRouter.get('/conversations', async (req: Request, res: Response): Promise<void> => {
  if (req.user.role !== 'TEACHER') {
    throw new AppError(403, 'FORBIDDEN', 'Only teachers can view parent conversations');
  }

  const conversations = await getTeacherParentConversations(req.user.sub, req.schoolId);
  res.status(200).json(conversations);
});
