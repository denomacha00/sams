"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timetableRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const rbac_1 = require("../middleware/rbac");
const timetableService_1 = require("../services/timetableService");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const createTimetableSchema = zod_1.z.object({
    classId: zod_1.z.string().min(1),
    teacherId: zod_1.z.string().min(1),
    subject: zod_1.z.string().min(1).max(200),
    dayOfWeek: zod_1.z.number().int().min(0).max(6),
    startTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
    endTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
    room: zod_1.z.string().max(100).optional(),
});
const updateTimetableSchema = zod_1.z.object({
    classId: zod_1.z.string().min(1).optional(),
    teacherId: zod_1.z.string().min(1).optional(),
    subject: zod_1.z.string().min(1).max(200).optional(),
    dayOfWeek: zod_1.z.number().int().min(0).max(6).optional(),
    startTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
    endTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional(),
    room: zod_1.z.string().max(100).optional(),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.timetableRouter = (0, express_1.Router)();
/**
 * GET /api/v1/timetable
 * List timetable entries scoped to the school.
 */
exports.timetableRouter.get('/', async (req, res) => {
    try {
        const filters = {
            classId: req.query.classId,
            teacherId: req.query.teacherId,
            dayOfWeek: req.query.dayOfWeek !== undefined ? Number(req.query.dayOfWeek) : undefined,
        };
        const entries = await timetableService_1.timetableService.listEntries(req.schoolId, filters);
        res.status(200).json(entries);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list timetable entries');
    }
});
/**
 * POST /api/v1/timetable
 * Create a new timetable entry.
 */
exports.timetableRouter.post('/', (0, rbac_1.requirePermission)('manage:timetable'), async (req, res) => {
    const parsed = createTimetableSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const entry = await timetableService_1.timetableService.createEntry(req.schoolId, parsed.data);
        res.status(201).json(entry);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        console.error('[Timetable] Create error:', err);
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to create timetable entry. Make sure the teacher and class exist.');
    }
});
/**
 * PUT /api/v1/timetable/:id
 * Update a timetable entry.
 */
exports.timetableRouter.put('/:id', (0, rbac_1.requirePermission)('manage:timetable'), async (req, res) => {
    const parsed = updateTimetableSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }
    try {
        const entry = await timetableService_1.timetableService.updateEntry(req.schoolId, req.params.id, parsed.data);
        res.status(200).json(entry);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update timetable entry');
    }
});
/**
 * DELETE /api/v1/timetable/:id
 * Delete a timetable entry.
 */
exports.timetableRouter.delete('/:id', (0, rbac_1.requirePermission)('manage:timetable'), async (req, res) => {
    try {
        await timetableService_1.timetableService.deleteEntry(req.schoolId, req.params.id);
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete timetable entry');
    }
});
//# sourceMappingURL=timetable.js.map