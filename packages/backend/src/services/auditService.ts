import { AuditLog, AuditEventType, UserRole, Prisma } from '@prisma/client';
import { prisma } from '../index';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AuditEvent {
  eventType: AuditEventType;
  actorId?: string;
  actorRole?: UserRole;
  schoolId?: string;
  resourceSnapshot: Record<string, unknown>;
}

export interface AuditFilters {
  schoolId?: string;
  eventType?: AuditEventType;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
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
        eventType: event.eventType,
        actorId: event.actorId ?? null,
        actorRole: event.actorRole ?? null,
        schoolId: event.schoolId ?? null,
        resourceSnapshot: event.resourceSnapshot as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Query AuditLog records with optional filters.
   * Results are ordered by sequenceNum ASC (chronological, tamper-evident order).
   * Supports pagination via limit and offset.
   */
  async query(filters: AuditFilters): Promise<AuditLog[]> {
    const { schoolId, eventType, dateFrom, dateTo, limit, offset } = filters;

    return prisma.auditLog.findMany({
      where: {
        ...(schoolId !== undefined && { schoolId }),
        ...(eventType !== undefined && { eventType }),
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
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const auditService = new AuditService();
