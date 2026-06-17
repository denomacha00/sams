import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { UserRole } from '@prisma/client';

const param = (req: Request, name: string): string => {
  const v = req.params[name];
  if (Array.isArray(v)) return v[0];
  return v ?? '';
};

const router = Router();

// All guardian routes require auth
router.use(authenticate);

/** GET /api/v1/guardians/wards — Get linked students for current GUARDIAN user */
router.get('/wards', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user.role !== 'GUARDIAN') {
      throw new AppError(403, 'FORBIDDEN', 'Only guardians can access this endpoint');
    }
    const links = await prisma.guardian.findMany({
      where: { guardianId: req.user.sub },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            admissionNumber: true,
            class: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(links);
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/guardians/link — School admin links guardian to student */
router.post('/link', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user.role !== 'SCHOOL_ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Only school admins can link guardians');
    }
    const { guardianId, studentId, relation } = req.body;
    if (!guardianId || !studentId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'guardianId and studentId are required');
    }

    // Verify both users exist in the same school
    const [guardian, student] = await Promise.all([
      prisma.user.findUnique({ where: { id: guardianId }, select: { schoolId: true, role: true } }),
      prisma.user.findUnique({ where: { id: studentId }, select: { schoolId: true, role: true } }),
    ]);

    if (!guardian || !student) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Guardian or student not found');
    }
    if (guardian.schoolId !== req.user.schoolId || student.schoolId !== req.user.schoolId) {
      throw new AppError(403, 'CROSS_SCHOOL', 'Cannot link users from different schools');
    }
    if (guardian.role !== 'GUARDIAN') {
      throw new AppError(400, 'INVALID_ROLE', 'User is not a guardian');
    }
    if (student.role !== 'STUDENT') {
      throw new AppError(400, 'INVALID_ROLE', 'User is not a student');
    }

    // Check if link already exists
    const existing = await prisma.guardian.findUnique({
      where: { guardianId_studentId: { guardianId, studentId } },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', 'This guardian is already linked to this student');
    }

    const link = await prisma.guardian.create({
      data: { schoolId: req.user.schoolId, guardianId, studentId, relation: relation ?? null },
    });

    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/v1/guardians/:id — School admin removes a guardian link */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user.role !== 'SCHOOL_ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Only school admins can remove guardian links');
    }
    const link = await prisma.guardian.findUnique({
      where: { id: req.params.id },
      select: { schoolId: true },
    });
    if (!link) {
      throw new AppError(404, 'NOT_FOUND', 'Guardian link not found');
    }
    if (link.schoolId !== req.user.schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }
    await prisma.guardian.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/guardians/student/:studentId — Get guardians for a student */
router.get('/student/:studentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!['SCHOOL_ADMIN', 'HOD'].includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }
    const links = await prisma.guardian.findMany({
      where: {
        studentId: req.params.studentId,
        schoolId: req.user.schoolId,
      },
      include: {
        guardian: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
      },
    });
    res.json(links);
  } catch (err) {
    next(err);
  }
});

export const guardiansRouter = router;
