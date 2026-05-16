export interface AuditEvent {
    eventType: string;
    actorId?: string;
    actorRole?: string;
    schoolId?: string;
    resourceSnapshot: Record<string, unknown>;
}
export interface AuditFilters {
    schoolId?: string;
    eventType?: string;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
}
interface AuditLogRecord {
    id: string;
    sequenceNum: bigint;
    schoolId: string | null;
    actorId: string | null;
    actorRole: string | null;
    eventType: string;
    resourceSnapshot: unknown;
    createdAt: Date;
}
export declare class AuditService {
    /**
     * Insert an immutable AuditLog record.
     * sequenceNum is auto-incremented by the database.
     * This is the only write operation — there is no update or delete.
     */
    log(event: AuditEvent): Promise<void>;
    /**
     * Query AuditLog records with optional filters.
     * Results are ordered by sequenceNum ASC (chronological, tamper-evident order).
     * Supports pagination via limit and offset.
     */
    query(filters: AuditFilters): Promise<AuditLogRecord[]>;
}
export declare const auditService: AuditService;
export {};
//# sourceMappingURL=auditService.d.ts.map