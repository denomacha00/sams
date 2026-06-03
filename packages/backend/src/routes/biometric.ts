import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { licenseService } from '../services/licenseService';
import { biometricService } from '../services/biometricService';
import { attendanceService } from '../services/attendanceService';
import { prisma } from '../lib/prisma';
import { resolveTeacherClassId } from '../lib/teacherScope';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const enrollSchema = z.object({
  studentId: z.string().min(1).optional(),
  descriptor: z.array(z.number()).min(1, 'Descriptor must not be empty'),
});

const matchSchema = z.object({
  descriptor: z.array(z.number()).min(1, 'Descriptor must not be empty'),
  classId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const biometricRouter = Router();

/**
 * Middleware: Gate all biometric routes behind Pro/Enterprise plan access.
 * Requirements: 7.1, 12.4
 */
biometricRouter.use(async (req: Request, res: Response, next) => {
  try {
    const hasAccess = await licenseService.checkFeatureAccess(req.schoolId, 'biometric');
    if (!hasAccess) {
      throw new AppError(
        403,
        'FEATURE_NOT_AVAILABLE',
        'Biometric features require a Professional or Enterprise plan',
      );
    }
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      next(new AppError(500, 'INTERNAL_ERROR', 'Failed to check feature access'));
    }
  }
});

/**
 * GET /api/v1/biometric/templates/check-access
 * Plan gate probe for enroll UI (returns 200 when biometric feature is enabled).
 */
biometricRouter.get('/templates/check-access', (_req: Request, res: Response): void => {
  res.status(200).json({ accessible: true });
});

/**
 * POST /api/v1/biometric/match
 * Match a face descriptor against class templates and record attendance.
 */
biometricRouter.post(
  '/match',
  requirePermission('mark:attendance'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = matchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const classId =
        parsed.data.classId ??
        (await resolveTeacherClassId(req.user.sub, req.user.classId));
      if (!classId) {
        throw new AppError(400, 'NO_CLASS', 'No class assigned for biometric attendance');
      }

      const descriptor = new Float32Array(parsed.data.descriptor);
      const match = await biometricService.matchDescriptor(
        descriptor,
        classId,
        req.schoolId,
      );

      if (!match.matched) {
        res.status(200).json({
          match: false,
          matched: false,
          confidence: match.confidence,
          studentId: match.studentId || null,
          studentName: null,
        });
        return;
      }

      let sessionId = parsed.data.sessionId;
      if (!sessionId) {
        const activeSession = await prisma.attendanceSession.findFirst({
          where: {
            schoolId: req.schoolId,
            classId,
            teacherId: req.user.sub,
            isActive: true,
          },
          select: { id: true },
          orderBy: { startedAt: 'desc' },
        });
        if (!activeSession) {
          throw new AppError(
            400,
            'NO_ACTIVE_SESSION',
            'Start an attendance session before scanning faces',
          );
        }
        sessionId = activeSession.id;
      }

      const student = await prisma.user.findFirst({
        where: { id: match.studentId, schoolId: req.schoolId },
        select: { fullName: true },
      });

      const record = await attendanceService.recordBiometric(
        req.user.sub,
        req.schoolId,
        sessionId,
        match.studentId,
        match.confidence,
      );

      res.status(201).json({
        match: true,
        matched: true,
        confidence: match.confidence,
        studentId: match.studentId,
        studentName: student?.fullName ?? 'Student',
        sessionId,
        record,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to match biometric face');
    }
  },
);

/**
 * POST /api/v1/biometric/enroll
 * Enroll a biometric template for a student.
 * Requires mark:attendance permission (Teacher role).
 * Requirements: 7.4, 7.8
 */
biometricRouter.post(
  '/enroll',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const requestedStudentId = parsed.data.studentId ?? req.user.sub;
      const canManageOthers = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'].includes(req.user.role);
      const isSelfEnrollment = requestedStudentId === req.user.sub;

      if (!isSelfEnrollment && !canManageOthers) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'You can only enroll your own biometric profile',
        );
      }

      // Convert the number array to Float32Array
      const descriptor = new Float32Array(parsed.data.descriptor);

      await biometricService.enrollTemplate(
        requestedStudentId,
        req.schoolId,
        descriptor,
      );

      res.status(201).json({
        message: 'Biometric template enrolled successfully',
        studentId: requestedStudentId,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to enroll biometric template');
    }
  },
);

/**
 * GET /api/v1/biometric/templates/:classId
 * Get encrypted biometric templates for a class (for offline caching).
 * Requires mark:attendance permission (Teacher role).
 * Requirements: 7.4, 12.4
 */
biometricRouter.get(
  '/templates/:classId',
  requirePermission('mark:attendance'),
  async (req: Request, res: Response): Promise<void> => {
    const classId = req.params.classId as string;

    if (!classId) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: { classId: ['classId parameter is required'] },
      });
      return;
    }

    try {
      const templates = await biometricService.getEncryptedTemplates(classId, req.schoolId);

      // Convert Buffers to base64 for JSON transport
      const response = templates.map((t) => ({
        id: t.id,
        studentId: t.studentId,
        encryptedData: t.encryptedData.toString('base64'),
        iv: t.iv.toString('base64'),
        authTag: t.authTag.toString('base64'),
      }));

      res.status(200).json(response);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get biometric templates');
    }
  },
);
