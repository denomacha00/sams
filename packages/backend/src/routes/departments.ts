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
  const departments = await prisma.department.findMany({
    where: { schoolId: req.schoolId },
    include: {
      classes: true,
    },
  });

  // Enrich with HOD info — find users with role HOD for each department
  const hodUsers = await prisma.user.findMany({
    where: { schoolId: req.schoolId, role: 'HOD' },
    select: { id: true, fullName: true, departmentId: true },
  });

  const hodByDept = new Map(hodUsers.map((u) => [u.departmentId, { id: u.id, name: u.fullName }]));

  const enriched = departments.map((d) => {
    const hod = hodByDept.get(d.id);
    return {
      ...d,
      hodId: hod?.id ?? null,
      hodName: hod?.name ?? null,
    };
  });

  res.json(enriched);
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
  const id = String(req.params.id);
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept || dept.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  const updated = await prisma.department.update({ where: { id }, data: { name: parsed.data.name } });
  res.json(updated);
});

departmentsRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept || dept.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  await prisma.class.deleteMany({ where: { departmentId: id } });
  await prisma.department.delete({ where: { id } });
  res.status(204).send();
});

departmentsRouter.get('/:id/teachers', async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  if (user.role === 'TEACHER' || user.role === 'STUDENT') {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  const deptId = String(req.params.id);
  const dept = await prisma.department.findUnique({ where: { id: deptId } });
  if (!dept || dept.schoolId !== req.schoolId) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  if (user.role === 'HOD' && user.departmentId !== deptId) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  const teachers = await prisma.user.findMany({
    where: { schoolId: req.schoolId, departmentId: deptId, role: 'TEACHER' },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  res.json(teachers);
});

departmentsRouter.get('/:id/classes', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const classes = await prisma.class.findMany({
    where: { departmentId: id, schoolId: req.schoolId },
    include: { classTeacher: { select: { fullName: true } } },
  });
  const enriched = classes.map((c) => ({
    ...c,
    classTeacherName: c.classTeacher?.fullName ?? null,
  }));
  res.json(enriched);
});

// ─── Classes ──────────────────────────────────────────────────────────────────

classesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const classes = await prisma.class.findMany({
    where: { schoolId: req.schoolId },
    include: {
      department: true,
      classTeacher: { select: { fullName: true } },
    },
  });
  const enriched = classes.map((c) => ({
    ...c,
    classTeacherName: c.classTeacher?.fullName ?? null,
  }));
  res.json(enriched);
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
  const id = String(req.params.id);
  const cls = await prisma.class.findUnique({ where: { id } });
  if (!cls || cls.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  const { name, capacity, departmentId } = req.body;
  const updated = await prisma.class.update({ where: { id }, data: { ...(name && { name }), ...(capacity && { capacity }), ...(departmentId && { departmentId }) } });
  res.json(updated);
});

classesRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const cls = await prisma.class.findUnique({ where: { id } });
  if (!cls || cls.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
  await prisma.class.delete({ where: { id } });
  res.status(204).send();
});

classesRouter.post('/:id/assign-teacher', async (req: Request, res: Response): Promise<void> => {
  const user = req.user;

  // Reject TEACHER and STUDENT callers
  if (user.role === 'TEACHER' || user.role === 'STUDENT') {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }

  // Validate teacherId present in body
  const { teacherId } = req.body;
  if (!teacherId) {
    res.status(400).json({ error: 'teacherId is required', code: 'VALIDATION_ERROR' });
    return;
  }

  // Look up the class; return 404 if not in req.schoolId
  const cls = await prisma.class.findUnique({ where: { id: String(req.params.id) } });
  if (!cls || cls.schoolId !== req.schoolId) {
    res.status(404).json({ error: 'Class not found', code: 'NOT_FOUND' });
    return;
  }

  // Look up the teacher; return 404 if not in req.schoolId or not role TEACHER
  const teacher = await prisma.user.findUnique({ where: { id: String(teacherId) } });
  if (!teacher || teacher.schoolId !== req.schoolId || teacher.role !== 'TEACHER') {
    res.status(404).json({ error: 'Teacher not found', code: 'NOT_FOUND' });
    return;
  }

  // For HOD: enforce department scope
  if (user.role === 'HOD') {
    if (cls.departmentId !== user.departmentId) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
    if (teacher.departmentId !== user.departmentId) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
  }

  // Assign the class teacher
  const updated = await prisma.class.update({
    where: { id: cls.id },
    data: { classTeacherId: String(teacherId) },
    include: { classTeacher: { select: { fullName: true } } },
  });

  res.json({
    ...updated,
    classTeacherName: updated.classTeacher?.fullName ?? null,
  });
});
