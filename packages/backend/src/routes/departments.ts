import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';

const createDeptSchema = z.object({ name: z.string().min(1).max(200) });
const updateClassSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  capacity: z.number().int().min(1).optional(),
  departmentId: z.string().min(1).optional(),
});
const createClassSchema = z.object({
  name: z.string().min(1).max(200),
  capacity: z.number().int().min(1).optional(),
  departmentId: z.string().min(1),
});

export const departmentsRouter = Router();
export const classesRouter = Router();

// ─── Departments ──────────────────────────────────────────────────────────────

departmentsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      where: { schoolId: req.schoolId },
      include: { classes: true },
    });

    const hodUsers = await prisma.user.findMany({
      where: { schoolId: req.schoolId, role: 'HOD' },
      select: { id: true, fullName: true, departmentId: true },
    });

    const hodByDept = new Map<string, { id: string; name: string }>(
      hodUsers.map((u) => [u.departmentId as string, { id: u.id, name: u.fullName }]),
    );

    const enriched = departments.map((d) => {
      const hod = hodByDept.get(d.id);
      return { ...d, hodId: hod?.id ?? null, hodName: hod?.name ?? null };
    });

    res.json(enriched);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list departments');
  }
});

departmentsRouter.post('/', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createDeptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
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
  try {
    const id = String(req.params.id);
    const dept = await prisma.department.findUnique({ where: { id } });
    if (!dept || dept.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    const updated = await prisma.department.update({ where: { id }, data: { name: parsed.data.name } });
    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update department');
  }
});

departmentsRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const dept = await prisma.department.findUnique({ where: { id } });
    if (!dept || dept.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }
    await prisma.class.deleteMany({ where: { departmentId: id } });
    await prisma.department.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete department');
  }
});

departmentsRouter.get('/:id/teachers', async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list teachers');
  }
});

departmentsRouter.get('/:id/classes', async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list classes');
  }
});

// ─── Classes ──────────────────────────────────────────────────────────────────

classesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
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
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to list classes');
  }
});

classesRouter.post('/', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = createClassSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const cls = await prisma.class.create({
      data: {
        schoolId: req.schoolId,
        departmentId: parsed.data.departmentId,
        name: parsed.data.name,
        capacity: parsed.data.capacity || 50,
      },
    });
    res.status(201).json(cls);
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ error: 'Class already exists', code: 'DUPLICATE' }); return; }
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create class');
  }
});

classesRouter.put('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  const parsed = updateClassSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const id = String(req.params.id);
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls || cls.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }

    // HOD scope: cannot move class to another department
    if (req.user.role === 'HOD') {
      if (cls.departmentId !== req.user.departmentId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }
      if (parsed.data.departmentId && parsed.data.departmentId !== req.user.departmentId) {
        res.status(403).json({ error: 'Forbidden: HODs cannot move classes to another department', code: 'FORBIDDEN' });
        return;
      }
    }

    const updated = await prisma.class.update({
      where: { id },
      data: {
        ...(parsed.data.name && { name: parsed.data.name }),
        ...(parsed.data.capacity && { capacity: parsed.data.capacity }),
        ...(parsed.data.departmentId && { departmentId: parsed.data.departmentId }),
      },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update class');
  }
});

classesRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls || cls.schoolId !== req.schoolId) { res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }); return; }

    // HOD scope: can only delete classes in their own department
    if (req.user.role === 'HOD' && cls.departmentId !== req.user.departmentId) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    await prisma.class.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to delete class');
  }
});

classesRouter.post('/:id/assign-teacher', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;

    if (user.role === 'TEACHER' || user.role === 'STUDENT') {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }

    const { teacherId } = req.body;
    if (!teacherId) {
      res.status(400).json({ error: 'teacherId is required', code: 'VALIDATION_ERROR' });
      return;
    }

    const cls = await prisma.class.findUnique({ where: { id: String(req.params.id) } });
    if (!cls || cls.schoolId !== req.schoolId) {
      res.status(404).json({ error: 'Class not found', code: 'NOT_FOUND' });
      return;
    }

    const teacher = await prisma.user.findUnique({ where: { id: String(teacherId) } });
    if (!teacher || teacher.schoolId !== req.schoolId || teacher.role !== 'TEACHER') {
      res.status(404).json({ error: 'Teacher not found', code: 'NOT_FOUND' });
      return;
    }

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

    const updated = await prisma.class.update({
      where: { id: cls.id },
      data: { classTeacherId: String(teacherId) },
      include: { classTeacher: { select: { fullName: true } } },
    });

    res.json({ ...updated, classTeacherName: updated.classTeacher?.fullName ?? null });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to assign class teacher');
  }
});
