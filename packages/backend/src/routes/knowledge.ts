import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { knowledgeService } from '../services/knowledgeService';
import { AppError } from '../middleware/errors';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createKnowledgeSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  category: z.string().max(50).optional(),
});

const updateKnowledgeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  category: z.string().max(50).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const knowledgeRouter = Router();

// All routes require 'manage:knowledge' permission (blocks students)
knowledgeRouter.use(requirePermission('manage:knowledge'));

/**
 * GET /api/v1/knowledge
 * List knowledge entries (paginated, role-scoped).
 */
knowledgeRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string) || 20));

    const result = await knowledgeService.list(req.user, page, pageSize);
    res.json(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list knowledge entries');
  }
});

/**
 * POST /api/v1/knowledge
 * Create a new knowledge entry.
 */
knowledgeRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = createKnowledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const entry = await knowledgeService.create(req.user, parsed.data);
    res.status(201).json(entry);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create knowledge entry');
  }
});

/**
 * GET /api/v1/knowledge/:id
 * Get a single knowledge entry.
 */
knowledgeRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const entry = await knowledgeService.getById(req.user, req.params.id as string);
    res.json(entry);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to fetch knowledge entry');
  }
});

/**
 * PUT /api/v1/knowledge/:id
 * Update a knowledge entry.
 */
knowledgeRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = updateKnowledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const entry = await knowledgeService.update(req.user, req.params.id as string, parsed.data);
    res.json(entry);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update knowledge entry');
  }
});

/**
 * DELETE /api/v1/knowledge/:id
 * Delete a knowledge entry.
 */
knowledgeRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await knowledgeService.delete(req.user, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete knowledge entry');
  }
});
