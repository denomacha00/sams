import { type Request, type Response, type NextFunction } from 'express';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';

const PLATFORM_SCHOOL_CODE = 'SAMS_PLATFORM';

/**
 * Blocks authenticated requests when the user's school is suspended.
 * SUPER_ADMIN and the platform school are exempt.
 */
export async function licenseGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  if (user.role === UserRole.SUPER_ADMIN) {
    next();
    return;
  }

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { isSuspended: true, schoolCode: true },
  });

  if (!school) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  if (school.schoolCode === PLATFORM_SCHOOL_CODE) {
    next();
    return;
  }

  if (school.isSuspended) {
    res.status(403).json({
      error: 'Your school account has been suspended. Please contact your administrator.',
      code: 'SCHOOL_SUSPENDED',
    });
    return;
  }

  next();
}
