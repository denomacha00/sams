import { prisma } from '../index';

// ─── Interfaces ───────────────────────────────────────────────────────────────

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

// ─── Audit Service ────────────────────────────────────────────────────────────

export class AuditService {
  /**
   * Insert an immutable AuditLog record.
   * sequenceNum is auto-incremented by the database.
   * This is the only write operation — there is no update or delete.
   */
  async log(event: AuditEvent): Promise<void> {
    await prisma.auditLog.create({
      data: {
        eventType: event.eventType as any,
        actorId: event.actorId ?? null,
        actorRole: event.actorRole as any ?? null,
        schoolId: event.schoolId ?? null,
        resourceSnapshot: event.resourceSnapshot as any,
      },
    });
  }

  /**
   * Query AuditLog records with optional filters.
   * Results are ordered by sequenceNum ASC (chronological, tamper-evident order).
   * Supports pagination via limit and offset.
   */
  async query(filters: AuditFilters): Promise<AuditLogRecord[]> {
    const { schoolId, eventType, dateFrom, dateTo, limit, offset } = filters;

    const results = await prisma.auditLog.findMany({
      where: {
        ...(schoolId !== undefined && { schoolId }),
        ...(eventType !== undefined && { eventType: eventType as any }),
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

    return results as unknown as AuditLogRecord[];
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const auditService = new AuditService();
