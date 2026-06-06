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

function csvEscape(value: unknown): string {
  const normalized = value instanceof Date ? value.toISOString() : String(value ?? '');
  return `"${normalized.replace(/"/g, '""')}"`;
}

/**
 * GET /api/v1/knowledge/export
 * Export scoped knowledge entries as CSV. Read-only export is available to all roles.
 */
knowledgeRouter.get('/export', requirePermission('view:reports'), async (req: Request, res: Response): Promise<void> => {
  try {
    const entries = await knowledgeService.listAll(req.user);
    const rows = [
      ['Title', 'Category', 'Scope', 'Creator', 'Creator Role', 'Created At', 'Updated At', 'Content'],
      ...entries.map((entry) => [
        entry.title,
        entry.category,
        entry.scopeLevel,
        entry.creatorName,
        entry.creatorRole,
        entry.createdAt,
        entry.updatedAt,
        entry.content,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sams-knowledge-export.csv"');
    res.send(csv);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to export knowledge entries');
  }
});

// Management routes require 'manage:knowledge' permission (blocks students from edits)
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
