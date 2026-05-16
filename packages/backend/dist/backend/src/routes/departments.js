"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classesRouter = exports.departmentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const rbac_1 = require("../middleware/rbac");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
const createDeptSchema = zod_1.z.object({ name: zod_1.z.string().min(1).max(200) });
const createClassSchema = zod_1.z.object({ name: zod_1.z.string().min(1).max(200), capacity: zod_1.z.number().int().min(1).optional(), departmentId: zod_1.z.string().min(1) });
exports.departmentsRouter = (0, express_1.Router)();
exports.classesRouter = (0, express_1.Router)();
// ─── Departments ──────────────────────────────────────────────────────────────
exports.departmentsRouter.get('/', async (req, res) => {
    const departments = await index_1.prisma.department.findMany({ where: { schoolId: req.schoolId }, include: { classes: true } });
    res.json(departments);
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
    const id = String(req.params.id);
    const dept = await index_1.prisma.department.findUnique({ where: { id } });
    if (!dept || dept.schoolId !== req.schoolId) {
        res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        return;
    }
    const updated = await index_1.prisma.department.update({ where: { id }, data: { name: parsed.data.name } });
    res.json(updated);
});
exports.departmentsRouter.delete('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const id = String(req.params.id);
    const dept = await index_1.prisma.department.findUnique({ where: { id } });
    if (!dept || dept.schoolId !== req.schoolId) {
        res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        return;
    }
    await index_1.prisma.class.deleteMany({ where: { departmentId: id } });
    await index_1.prisma.department.delete({ where: { id } });
    res.status(204).send();
});
exports.departmentsRouter.get('/:id/classes', async (req, res) => {
    const id = String(req.params.id);
    const classes = await index_1.prisma.class.findMany({ where: { departmentId: id, schoolId: req.schoolId } });
    res.json(classes);
});
// ─── Classes ──────────────────────────────────────────────────────────────────
exports.classesRouter.get('/', async (req, res) => {
    const classes = await index_1.prisma.class.findMany({ where: { schoolId: req.schoolId }, include: { department: true } });
    res.json(classes);
});
exports.classesRouter.post('/', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const parsed = createClassSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
        return;
    }
    try {
        const cls = await index_1.prisma.class.create({ data: { schoolId: req.schoolId, departmentId: parsed.data.departmentId, name: parsed.data.name, capacity: parsed.data.capacity || 50 } });
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
    const id = String(req.params.id);
    const cls = await index_1.prisma.class.findUnique({ where: { id } });
    if (!cls || cls.schoolId !== req.schoolId) {
        res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        return;
    }
    const { name, capacity, departmentId } = req.body;
    const updated = await index_1.prisma.class.update({ where: { id }, data: { ...(name && { name }), ...(capacity && { capacity }), ...(departmentId && { departmentId }) } });
    res.json(updated);
});
exports.classesRouter.delete('/:id', (0, rbac_1.requirePermission)('manage:users'), async (req, res) => {
    const id = String(req.params.id);
    const cls = await index_1.prisma.class.findUnique({ where: { id } });
    if (!cls || cls.schoolId !== req.schoolId) {
        res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        return;
    }
    await index_1.prisma.class.delete({ where: { id } });
    res.status(204).send();
});
//# sourceMappingURL=departments.js.map