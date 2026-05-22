"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classesRouter = exports.departmentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const rbac_1 = require("../middleware/rbac");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
const createDeptSchema = zod_1.z.object({ name: zod_1.z.string().min(1).max(200) });
const updateClassSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200).optional(),
    capacity: zod_1.z.number().int().min(1).optional(),
    departmentId: zod_1.z.string().min(1).optional(),
});
const createClassSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
    capacity: zod_1.z.number().int().min(1).optional(),
    departmentId: zod_1.z.string().min(1),
});
exports.departmentsRouter = (0, express_1.Router)();
exports.classesRouter = (0, express_1.Router)();
// ─── Departments ──────────────────────────────────────────────────────────────
exports.departmentsRouter.get('/', async (req, res) => {
    try {
        const departments = await index_1.prisma.department.findMany({
            where: { schoolId: req.schoolId },
            include: { classes: true },
        });
        const hodUsers = await index_1.prisma.user.findMany({
            where: { schoolId: req.schoolId, role: 'HOD' },
            select: { id: true, fullName: true, departmentId: true },
        });
        const hodByDept = new Map(hodUsers.map((u) => [u.departmentId, { id: u.id, name: u.fullName }]));
        const enriched = departments.map((d) => {
            const hod = hodByDept.get(d.id);
            return { ...d, hodId: hod?.id ?? null, hodName: hod?.name ?? null };
        });
        res.json(enriched);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list departments');
    }
});
exports.departmentsRouter.post('/', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = createDeptSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
        return;
    }
    try {
        const dept = await index_1.prisma.department.create({ data: { schoolId: req.schoolId, name: parsed.data.name } });
        res.status(201).json(dept);
    }
    catch (err) {
        if (err.code === 'P2002') {
            res.status(409).json({ error: 'Department already exists', code: 'DUPLICATE' });
            return;
        }
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to create department');
    }
});
exports.departmentsRouter.put('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = createDeptSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
        return;
    }
    try {
        const id = String(req.params.id);
        const dept = await index_1.prisma.department.findUnique({ where: { id } });
        if (!dept || dept.schoolId !== req.schoolId) {
            res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
            return;
        }
        const updated = await index_1.prisma.department.update({ where: { id }, data: { name: parsed.data.name } });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update department');
    }
});
exports.departmentsRouter.delete('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    try {
        const id = String(req.params.id);
        const dept = await index_1.prisma.department.findUnique({ where: { id } });
        if (!dept || dept.schoolId !== req.schoolId) {
            res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
            return;
        }
        await index_1.prisma.class.deleteMany({ where: { departmentId: id } });
        await index_1.prisma.department.delete({ where: { id } });
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete department');
    }
});
exports.departmentsRouter.get('/:id/teachers', async (req, res) => {
    try {
        const user = req.user;
        if (user.role === 'TEACHER' || user.role === 'STUDENT') {
            res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
            return;
        }
        const deptId = String(req.params.id);
        const dept = await index_1.prisma.department.findUnique({ where: { id: deptId } });
        if (!dept || dept.schoolId !== req.schoolId) {
            res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
            return;
        }
        if (user.role === 'HOD' && user.departmentId !== deptId) {
            res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
            return;
        }
        const teachers = await index_1.prisma.user.findMany({
            where: { schoolId: req.schoolId, departmentId: deptId, role: 'TEACHER' },
            select: { id: true, fullName: true, email: true, phone: true },
        });
        res.json(teachers);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list teachers');
    }
});
exports.departmentsRouter.get('/:id/classes', async (req, res) => {
    try {
        const id = String(req.params.id);
        const classes = await index_1.prisma.class.findMany({
            where: { departmentId: id, schoolId: req.schoolId },
            include: { classTeacher: { select: { fullName: true } } },
        });
        const enriched = classes.map((c) => ({
            ...c,
            classTeacherName: c.classTeacher?.fullName ?? null,
        }));
        res.json(enriched);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list classes');
    }
});
// ─── Classes ──────────────────────────────────────────────────────────────────
exports.classesRouter.get('/', async (req, res) => {
    try {
        const classes = await index_1.prisma.class.findMany({
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
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list classes');
    }
});
exports.classesRouter.post('/', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = createClassSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
        return;
    }
    try {
        const cls = await index_1.prisma.class.create({
            data: {
                schoolId: req.schoolId,
                departmentId: parsed.data.departmentId,
                name: parsed.data.name,
                capacity: parsed.data.capacity || 50,
            },
        });
        res.status(201).json(cls);
    }
    catch (err) {
        if (err.code === 'P2002') {
            res.status(409).json({ error: 'Class already exists', code: 'DUPLICATE' });
            return;
        }
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to create class');
    }
});
exports.classesRouter.put('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = updateClassSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
        return;
    }
    try {
        const id = String(req.params.id);
        const cls = await index_1.prisma.class.findUnique({ where: { id } });
        if (!cls || cls.schoolId !== req.schoolId) {
            res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
            return;
        }
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
        const updated = await index_1.prisma.class.update({
            where: { id },
            data: {
                ...(parsed.data.name && { name: parsed.data.name }),
                ...(parsed.data.capacity && { capacity: parsed.data.capacity }),
                ...(parsed.data.departmentId && { departmentId: parsed.data.departmentId }),
            },
        });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update class');
    }
});
exports.classesRouter.delete('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    try {
        const id = String(req.params.id);
        const cls = await index_1.prisma.class.findUnique({ where: { id } });
        if (!cls || cls.schoolId !== req.schoolId) {
            res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
            return;
        }
        // HOD scope: can only delete classes in their own department
        if (req.user.role === 'HOD' && cls.departmentId !== req.user.departmentId) {
            res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
            return;
        }
        await index_1.prisma.class.delete({ where: { id } });
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete class');
    }
});
exports.classesRouter.post('/:id/assign-teacher', async (req, res) => {
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
        const cls = await index_1.prisma.class.findUnique({ where: { id: String(req.params.id) } });
        if (!cls || cls.schoolId !== req.schoolId) {
            res.status(404).json({ error: 'Class not found', code: 'NOT_FOUND' });
            return;
        }
        const teacher = await index_1.prisma.user.findUnique({ where: { id: String(teacherId) } });
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
        const updated = await index_1.prisma.class.update({
            where: { id: cls.id },
            data: { classTeacherId: String(teacherId) },
            include: { classTeacher: { select: { fullName: true } } },
        });
        res.json({ ...updated, classTeacherName: updated.classTeacher?.fullName ?? null });
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to assign class teacher');
    }
});
//# sourceMappingURL=departments.js.map