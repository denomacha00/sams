import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { licenseService } from '../services/licenseService';
import { biometricService } from '../services/biometricService';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const enrollSchema = z.object({
  studentId: z.string().min(1),
  descriptor: z.array(z.number()).min(1, 'Descriptor must not be empty'),
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
 * POST /api/v1/biometric/enroll
 * Enroll a biometric template for a student.
 * Requires mark:attendance permission (Teacher role).
 * Requirements: 7.4, 7.8
 */
biometricRouter.post(
  '/enroll',
  requirePermission('mark:attendance'),
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
      // Convert the number array to Float32Array
      const descriptor = new Float32Array(parsed.data.descriptor);

      await biometricService.enrollTemplate(
        parsed.data.studentId,
        req.schoolId,
        descriptor,
      );

      res.status(201).json({
        message: 'Biometric template enrolled successfully',
        studentId: parsed.data.studentId,
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
