"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeService = exports.KnowledgeService = void 0;
const cuid2_1 = require("@paralleldrive/cuid2");
const shared_1 = require("@sams/shared");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
// ─── Knowledge Service ────────────────────────────────────────────────────────
class KnowledgeService {
    /**
     * Determine scope level from field presence.
     * classId set → 'class', departmentId set → 'department', else → 'school'
     */
    getScopeLevel(entry) {
        if (entry.classId)
            return 'class';
        if (entry.departmentId)
            return 'department';
        return 'school';
    }
    /**
     * Validate knowledge input fields.
     * Throws AppError 400 on invalid input.
     */
    validateInput(input, isUpdate = false) {
        if (!isUpdate || input.title !== undefined) {
            if (!input.title || input.title.length === 0 || input.title.length > 200) {
                throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Title must be 1-200 characters');
            }
        }
        if (!isUpdate || input.content !== undefined) {
            if (!input.content || input.content.length === 0) {
                throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Content is required');
            }
        }
        if (input.category !== undefined && input.category.length > 50) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Category must be at most 50 characters');
        }
    }
    /**
     * Map a raw DB entry (with createdBy include) to the response shape.
     */
    toResponse(entry) {
        return {
            id: entry.id,
            title: entry.title,
            content: entry.content,
            category: entry.category,
            schoolId: entry.schoolId,
            departmentId: entry.departmentId,
            classId: entry.classId,
            createdById: entry.createdById,
            creatorName: entry.createdBy.fullName,
            creatorRole: entry.createdBy.role,
            scopeLevel: this.getScopeLevel(entry),
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
        };
    }
    /**
     * Create a knowledge entry with role-based scope assignment.
     * - SCHOOL_ADMIN: schoolId=user.schoolId, departmentId=null, classId=null
     * - HOD: schoolId=user.schoolId, departmentId=user.departmentId, classId=null
     * - TEACHER: schoolId=user.schoolId, departmentId=user.departmentId, classId=user.classId
     * - STUDENT: throws 403
     */
    async create(user, input) {
        if (user.role === shared_1.UserRole.STUDENT) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access denied');
        }
        this.validateInput(input);
        let departmentId = null;
        let classId = null;
        switch (user.role) {
            case shared_1.UserRole.SCHOOL_ADMIN:
                // School-wide scope
                departmentId = null;
                classId = null;
                break;
            case shared_1.UserRole.HOD:
                departmentId = user.departmentId ?? null;
                classId = null;
                break;
            case shared_1.UserRole.TEACHER:
                departmentId = user.departmentId ?? null;
                classId = user.classId ?? null;
                break;
        }
        const entry = await index_1.prisma.aIKnowledge.create({
            data: {
                id: (0, cuid2_1.createId)(),
                title: input.title,
                content: input.content,
                category: input.category ?? 'general',
                schoolId: user.schoolId,
                departmentId,
                classId,
                createdById: user.sub,
            },
            include: {
                createdBy: { select: { fullName: true, role: true } },
            },
        });
        return this.toResponse(entry);
    }
    /**
     * Update a knowledge entry.
     * Allowed if user is the creator OR SCHOOL_ADMIN in the same school.
     * Cross-school access returns 404 to avoid leaking existence.
     */
    async update(user, entryId, input) {
        const entry = await index_1.prisma.aIKnowledge.findUnique({
            where: { id: entryId },
        });
        if (!entry) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Knowledge entry not found');
        }
        // Cross-school: return 404 to avoid leaking existence
        if (entry.schoolId !== user.schoolId) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Knowledge entry not found');
        }
        // Authorization: creator or SCHOOL_ADMIN
        if (entry.createdById !== user.sub && user.role !== shared_1.UserRole.SCHOOL_ADMIN) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Only the creator or school admin can modify this entry');
        }
        // Validate input fields that are provided
        if (input.title !== undefined) {
            if (!input.title || input.title.length === 0 || input.title.length > 200) {
                throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Title must be 1-200 characters');
            }
        }
        if (input.content !== undefined) {
            if (!input.content || input.content.length === 0) {
                throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Content is required');
            }
        }
        if (input.category !== undefined && input.category.length > 50) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Category must be at most 50 characters');
        }
        const updated = await index_1.prisma.aIKnowledge.update({
            where: { id: entryId },
            data: {
                ...(input.title !== undefined && { title: input.title }),
                ...(input.content !== undefined && { content: input.content }),
                ...(input.category !== undefined && { category: input.category }),
            },
            include: {
                createdBy: { select: { fullName: true, role: true } },
            },
        });
        return this.toResponse(updated);
    }
    /**
     * Delete a knowledge entry.
     * Allowed if user is the creator OR SCHOOL_ADMIN in the same school.
     * Cross-school access returns 404 to avoid leaking existence.
     */
    async delete(user, entryId) {
        const entry = await index_1.prisma.aIKnowledge.findUnique({
            where: { id: entryId },
        });
        if (!entry) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Knowledge entry not found');
        }
        // Cross-school: return 404 to avoid leaking existence
        if (entry.schoolId !== user.schoolId) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Knowledge entry not found');
        }
        // Authorization: creator or SCHOOL_ADMIN
        if (entry.createdById !== user.sub && user.role !== shared_1.UserRole.SCHOOL_ADMIN) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Only the creator or school admin can modify this entry');
        }
        await index_1.prisma.aIKnowledge.delete({
            where: { id: entryId },
        });
    }
    /**
     * List knowledge entries scoped to user's role with pagination.
     * - SCHOOL_ADMIN: all entries in their school
     * - HOD: school-wide + department entries
     * - TEACHER: school-wide + department + class entries
     * Includes creator name and role.
     */
    async list(user, page, pageSize) {
        const where = this.buildScopeFilter(user);
        const [entries, total] = await Promise.all([
            index_1.prisma.aIKnowledge.findMany({
                where,
                include: {
                    createdBy: { select: { fullName: true, role: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            index_1.prisma.aIKnowledge.count({ where }),
        ]);
        return {
            entries: entries.map((e) => this.toResponse(e)),
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        };
    }
    /**
     * Get a single knowledge entry by ID (school-scoped).
     * Returns 404 if not found or belongs to a different school.
     */
    async getById(user, entryId) {
        const entry = await index_1.prisma.aIKnowledge.findUnique({
            where: { id: entryId },
            include: {
                createdBy: { select: { fullName: true, role: true } },
            },
        });
        if (!entry) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Knowledge entry not found');
        }
        // Cross-school: return 404 to avoid leaking existence
        if (entry.schoolId !== user.schoolId) {
            throw new errors_1.AppError(404, 'NOT_FOUND', 'Knowledge entry not found');
        }
        return this.toResponse(entry);
    }
    /**
     * Retrieve all applicable knowledge entries for AI context injection.
     * - SCHOOL_ADMIN: all entries in school
     * - HOD: school-wide + department entries
     * - TEACHER/STUDENT: school-wide + department + class entries
     * Returns only { title, content, category } for prompt injection.
     */
    async getForAIContext(user) {
        const where = this.buildAIScopeFilter(user);
        return index_1.prisma.aIKnowledge.findMany({
            where,
            select: { title: true, content: true, category: true },
            orderBy: { createdAt: 'desc' },
        });
    }
    /**
     * Build Prisma where clause for list operations based on user role.
     */
    buildScopeFilter(user) {
        const baseFilter = {
            schoolId: user.schoolId,
        };
        switch (user.role) {
            case shared_1.UserRole.SCHOOL_ADMIN:
                // All entries in the school — no additional filter
                break;
            case shared_1.UserRole.HOD:
                // School-wide + department entries
                baseFilter.OR = [
                    { departmentId: null, classId: null },
                    { departmentId: user.departmentId },
                ];
                break;
            case shared_1.UserRole.TEACHER:
                // School-wide + department + class entries
                baseFilter.OR = [
                    { departmentId: null, classId: null },
                    { departmentId: user.departmentId, classId: null },
                    { classId: user.classId },
                ];
                break;
            default:
                // Fallback: only school-wide
                baseFilter.OR = [{ departmentId: null, classId: null }];
                break;
        }
        return baseFilter;
    }
    /**
     * Build Prisma where clause for AI context retrieval based on user role.
     */
    buildAIScopeFilter(user) {
        const baseFilter = {
            schoolId: user.schoolId,
        };
        switch (user.role) {
            case shared_1.UserRole.SCHOOL_ADMIN:
                // All entries in the school
                break;
            case shared_1.UserRole.HOD:
                // School-wide + department entries
                baseFilter.OR = [
                    { departmentId: null, classId: null },
                    { departmentId: user.departmentId },
                ];
                break;
            case shared_1.UserRole.TEACHER:
            case shared_1.UserRole.STUDENT:
                // School-wide + department + class entries
                baseFilter.OR = [
                    { departmentId: null, classId: null },
                    { departmentId: user.departmentId, classId: null },
                    { classId: user.classId },
                ];
                break;
            default:
                break;
        }
        return baseFilter;
    }
}
exports.KnowledgeService = KnowledgeService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.knowledgeService = new KnowledgeService();
//# sourceMappingURL=knowledgeService.js.map