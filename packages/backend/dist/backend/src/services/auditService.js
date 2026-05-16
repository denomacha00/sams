"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditService = exports.AuditService = void 0;
const index_1 = require("../index");
// ─── Audit Service ────────────────────────────────────────────────────────────
class AuditService {
    /**
     * Insert an immutable AuditLog record.
     * sequenceNum is auto-incremented by the database.
     * This is the only write operation — there is no update or delete.
     */
    async log(event) {
        await index_1.prisma.auditLog.create({
            data: {
                eventType: event.eventType,
                actorId: event.actorId ?? null,
                actorRole: event.actorRole ?? null,
                schoolId: event.schoolId ?? null,
                resourceSnapshot: event.resourceSnapshot,
            },
        });
    }
    /**
     * Query AuditLog records with optional filters.
     * Results are ordered by sequenceNum ASC (chronological, tamper-evident order).
     * Supports pagination via limit and offset.
     */
    async query(filters) {
        const { schoolId, eventType, dateFrom, dateTo, limit, offset } = filters;
        const results = await index_1.prisma.auditLog.findMany({
            where: {
                ...(schoolId !== undefined && { schoolId }),
                ...(eventType !== undefined && { eventType: eventType }),
                ...(dateFrom !== undefined || dateTo !== undefined
                    ? {
                        createdAt: {
                            ...(dateFrom !== undefined && { gte: dateFrom }),
                            ...(dateTo !== undefined && { lte: dateTo }),
                        },
                    }
                    : {}),
            },
            orderBy: {
                sequenceNum: 'asc',
            },
            ...(limit !== undefined && { take: limit }),
            ...(offset !== undefined && { skip: offset }),
        });
        return results;
    }
}
exports.AuditService = AuditService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.auditService = new AuditService();
//# sourceMappingURL=auditService.js.map