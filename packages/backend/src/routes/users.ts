import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@sams/shared';
import { requirePermission } from '../middleware/rbac';
import { userService } from '../services/userService';
import { registrationLinkService } from '../services/registrationLinkService';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createUserSchema = z.object({
  role: z.nativeEnum(UserRole),
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().min(9).max(15).optional(),
  admissionNumber: z.string().optional(),
  password: z.string().min(8),
  departmentId: z.string().optional(),
  classId: z.string().optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(9).max(15).optional(),
  departmentId: z.string().optional(),
  classId: z.string().optional(),
  isLocked: z.boolean().optional(),
});

const generateLinkSchema = z.object({
  classId: z.string().optional(),
  expiryDays: z.number().int().min(7).max(365).optional(),
  maxUses: z.number().int().min(1).optional(),
});

const registerViaLinkSchema = z.object({
  fullName: z.string().min(1).max(200),
  username: z.string().min(3).max(50),
  phone: z.string().min(9).max(15).optional(),
  password: z.string().min(8),
  admissionNumber: z.string().min(1).max(50).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const usersRouter = Router();

/**
 * GET /api/v1/users
 * List users scoped to the authenticated user's school.
 */
usersRouter.get('/', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = {
      role: req.query.role as UserRole | undefined,
      departmentId: req.query.departmentId as string | undefined,
      classId: req.query.classId as string | undefined,
    };

    const users = await userService.listUsers(req.schoolId, filters);
    res.status(200).json(users);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list users');
  }
});

/**
 * POST /api/v1/users
 * Create a new user within the school.
 */
usersRouter.post('/', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await userService.createUser(req.schoolId, parsed.data);
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create user');
  }
});

/**
 * GET /api/v1/users/:id
 * Get a single user by ID.
 */
usersRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await userService.getUser(req.schoolId, req.params.id as string);
    res.status(200).json(user);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to get user');
  }
});

/**
 * PUT /api/v1/users/:id
 * Update a user.
 */
usersRouter.put('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await userService.updateUser(req.schoolId, req.params.id as string, parsed.data as Parameters<typeof userService.updateUser>[2]);
    res.status(200).json(user);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update user');
  }
});

/**
 * DELETE /api/v1/users/:id
 * Delete a user.
 */
usersRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  try {
    await userService.deleteUser(req.schoolId, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete user');
  }
});

// ─── Registration Links ───────────────────────────────────────────────────────

export const registrationLinksRouter = Router();

/**
 * GET /api/v1/registration-links
 * List all registration links for the school.
 */
registrationLinksRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  // This route is under PUBLIC_PATHS so req.user might not be set
  // If no user (public access), return empty
  if (!req.user || !req.schoolId) {
    res.json([]);
    return;
  }
  try {
    const links = await prisma.registrationLink.findMany({
      where: { schoolId: req.schoolId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(links);
  } catch (err) {
    res.json([]);
  }
});

/**
 * POST /api/v1/registration-links
 * Generate a registration link. Requires manage:users permission.
 */
registrationLinksRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Allow SCHOOL_ADMIN, HOD, and TEACHER to generate links
  const allowedRoles = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'];
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  const parsed = generateLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const link = await registrationLinkService.generateLink(
      req.user.sub,
      req.user.role,
      req.schoolId,
      req.user.departmentId,
      parsed.data.classId || undefined,
      { expiryDays: parsed.data.expiryDays, maxUses: parsed.data.maxUses, targetRole: (req.body as any).targetRole || undefined } as any,
    );
    res.status(201).json(link);
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('[RegistrationLinks] Error:', err);
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to generate registration link');
  }
});

/**
 * GET /api/v1/registration-links/:token
 * Resolve a registration link (public, no auth).
 */
registrationLinksRouter.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const link = await registrationLinkService.resolveLink(req.params.token as string);
    
    // Fetch school and class names for the frontend display
    const school = await prisma.school.findUnique({
      where: { id: link.schoolId },
      select: { name: true, schoolCode: true },
    });
    
    let className: string | undefined;
    let departmentName: string | undefined;
    
    if (link.classId) {
      const classRecord = await prisma.class.findUnique({
        where: { id: link.classId },
        select: { name: true, department: { select: { name: true } } },
      });
      className = classRecord?.name;
      departmentName = classRecord?.department?.name;
    }
    
    res.status(200).json({
      ...link,
      schoolName: school?.name,
      schoolCode: school?.schoolCode,
      className,
      departmentName,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to resolve registration link');
  }
});

/**
 * DELETE /api/v1/registration-links/:id
 * Delete a registration link.
 */
registrationLinksRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.schoolId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  try {
    const id = String(req.params.id);
    const link = await prisma.registrationLink.findUnique({ where: { id } });
    if (!link || link.schoolId !== req.schoolId) {
      res.status(404).json({ error: 'Link not found', code: 'NOT_FOUND' });
      return;
    }
    await prisma.registrationLink.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete link', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/v1/registration-links/:token/register
 * Self-register via a registration link (public, no auth).
 */
registrationLinksRouter.post('/:token/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = registerViaLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await registrationLinkService.registerViaLink(
      req.params.token as string,
      parsed.data,
    );
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to register via link');
  }
});
