import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';

const createDeptSchema = z.object({ name: z.string().min(1).max(200) });
const createClassSchema = z.object({ name: z.string().min(1).max(200), capacity: z.number().int().min(1).optional(), departmentId: z.string().min(1) });

export const departmentsRouter = Router();
export const classesRouter = Router();

// ─── Departments ──────────────────────────────────────────────────────────────

departmentsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const departments = await prisma.department.findMany({ where: { schoolId: req.schoolId }, include: { classes: true } });
  res.json(departments);
});

departmentsRouter.post('/', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createDeptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }); return; }
  try {
    const dept = await prisma.department.create({ data: { schoolId: req.schoolId, name: parsed.data.name } });
    res.status(201).json(dept);
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ error: 'Department already exists', code: 'DUPLICATE' }); return; }
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create department');
  }
});

departmentsRouter.put('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createDeptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR' }); return; }
  const id = req.params.id as string;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept || dept.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  const updated = await prisma.department.update({ where: { id }, data: { name: parsed.data.name } });
  res.json(updated);
});

departmentsRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept || dept.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  await prisma.class.deleteMany({ where: { departmentId: id } });
  await prisma.department.delete({ where: { id } });
  res.status(204).send();
});

departmentsRouter.get('/:id/classes', async (req: Request, res: Response): Promise<void> => {
  const classes = await prisma.class.findMany({ where: { departmentId: req.params.id as string, schoolId: req.schoolId } });
  res.json(classes);
});

// ─── Classes ──────────────────────────────────────────────────────────────────

classesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const classes = await prisma.class.findMany({ where: { schoolId: req.schoolId }, include: { department: true } });
  res.json(classes);
});

classesRouter.post('/', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createClassSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }); return; }
  try {
    const cls = await prisma.class.create({ data: { schoolId: req.schoolId, departmentId: parsed.data.departmentId, name: parsed.data.name, capacity: parsed.data.capacity || 50 } });
    res.status(201).json(cls);
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ error: 'Class already exists', code: 'DUPLICATE' }); return; }
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create class');
  }
});

classesRouter.put('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const cls = await prisma.class.findUnique({ where: { id } });
  if (!cls || cls.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  const { name, capacity, departmentId } = req.body;
  const updated = await prisma.class.update({ where: { id }, data: { ...(name && { name }), ...(capacity && { capacity }), ...(departmentId && { departmentId }) } });
  res.json(updated);
});

classesRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const cls = await prisma.class.findUnique({ where: { id } });
  if (!cls || cls.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  await prisma.class.delete({ where: { id } });
  res.status(204).send();
});
