"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const rbac_1 = require("../middleware/rbac");
const knowledgeService_1 = require("../services/knowledgeService");
const errors_1 = require("../middleware/errors");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const createKnowledgeSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200),
    content: zod_1.z.string().min(1),
    category: zod_1.z.string().max(50).optional(),
});
const updateKnowledgeSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200).optional(),
    content: zod_1.z.string().min(1).optional(),
    category: zod_1.z.string().max(50).optional(),
});
// ─── Router ───────────────────────────────────────────────────────────────────
exports.knowledgeRouter = (0, express_1.Router)();
// All routes require 'manage:knowledge' permission (blocks students)
exports.knowledgeRouter.use((0, rbac_1.requirePermission)('manage:knowledge'));
/**
 * GET /api/v1/knowledge
 * List knowledge entries (paginated, role-scoped).
 */
exports.knowledgeRouter.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize) || 20));
        const result = await knowledgeService_1.knowledgeService.list(req.user, page, pageSize);
        res.json(result);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to list knowledge entries');
    }
});
/**
 * POST /api/v1/knowledge
 * Create a new knowledge entry.
 */
exports.knowledgeRouter.post('/', async (req, res) => {
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
        const entry = await knowledgeService_1.knowledgeService.create(req.user, parsed.data);
        res.status(201).json(entry);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to create knowledge entry');
    }
});
/**
 * GET /api/v1/knowledge/:id
 * Get a single knowledge entry.
 */
exports.knowledgeRouter.get('/:id', async (req, res) => {
    try {
        const entry = await knowledgeService_1.knowledgeService.getById(req.user, req.params.id);
        res.json(entry);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to fetch knowledge entry');
    }
});
/**
 * PUT /api/v1/knowledge/:id
 * Update a knowledge entry.
 */
exports.knowledgeRouter.put('/:id', async (req, res) => {
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
        const entry = await knowledgeService_1.knowledgeService.update(req.user, req.params.id, parsed.data);
        res.json(entry);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to update knowledge entry');
    }
});
/**
 * DELETE /api/v1/knowledge/:id
 * Delete a knowledge entry.
 */
exports.knowledgeRouter.delete('/:id', async (req, res) => {
    try {
        await knowledgeService_1.knowledgeService.delete(req.user, req.params.id);
        res.status(204).send();
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to delete knowledge entry');
    }
});
//# sourceMappingURL=knowledge.js.map