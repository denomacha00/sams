import { prisma } from '../index';
import { AppError } from '../middleware/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateTimetableEntryData {
  classId: string;
  teacherId: string;
  subject: string;
  dayOfWeek: number;   // 0=Monday … 6=Sunday
  startTime: string;   // "HH:MM" 24-hour
  endTime: string;     // "HH:MM" 24-hour
  room?: string;
}

export interface UpdateTimetableEntryData {
  classId?: string;
  teacherId?: string;
  subject?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  room?: string;
}

export interface ListTimetableFilters {
  classId?: string;
  teacherId?: string;
  dayOfWeek?: number;
}

// ─── Timetable Service ────────────────────────────────────────────────────────

export class TimetableService {
  /**
   * Create a new timetable entry.
   * Validates required fields and detects time overlaps for the same day
   * with the same teacher, class, or room.
   * Throws AppError 409 TIMETABLE_CONFLICT if an overlap is detected.
   *
   * Time overlap logic: existingStart < newEnd AND existingEnd > newStart
   *
   * Requirements: 17.1, 17.2
   */
  async createEntry(schoolId: string, data: CreateTimetableEntryData) {
    // Validate required fields
    this._validateEntryData(data);

    // Check for overlaps
    await this._checkOverlaps(schoolId, data.dayOfWeek, data.startTime, data.endTime, {
      teacherId: data.teacherId,
      classId: data.classId,
      room: data.room,
    });

    const entry = await prisma.timetableEntry.create({
      data: {
        schoolId,
        classId: data.classId,
        teacherId: data.teacherId,
        subject: data.subject,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        room: data.room ?? null,
      },
    });

    return entry;
  }

  /**
   * Update an existing timetable entry.
   * Fetches the entry, asserts school ownership, re-runs overlap check
   * excluding self, then updates.
   *
   * Requirements: 17.4
   */
  async updateEntry(schoolId: string, entryId: string, data: UpdateTimetableEntryData) {
    const entry = await prisma.timetableEntry.findUnique({ where: { id: entryId } });

    if (!entry) {
      throw new AppError(404, 'ENTRY_NOT_FOUND', 'Timetable entry not found');
    }

    if (entry.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    // Merge existing data with updates for overlap check
    const merged = {
      classId: data.classId ?? entry.classId,
      teacherId: data.teacherId ?? entry.teacherId,
      subject: data.subject ?? entry.subject,
      dayOfWeek: data.dayOfWeek ?? entry.dayOfWeek,
      startTime: data.startTime ?? entry.startTime,
      endTime: data.endTime ?? entry.endTime,
      room: data.room !== undefined ? data.room : entry.room,
    };

    // Re-run overlap check excluding self
    await this._checkOverlaps(schoolId, merged.dayOfWeek, merged.startTime, merged.endTime, {
      teacherId: merged.teacherId,
      classId: merged.classId,
      room: merged.room ?? undefined,
    }, entryId);

    const updated = await prisma.timetableEntry.update({
      where: { id: entryId },
      data: {
        ...(data.classId !== undefined && { classId: data.classId }),
        ...(data.teacherId !== undefined && { teacherId: data.teacherId }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.dayOfWeek !== undefined && { dayOfWeek: data.dayOfWeek }),
        ...(data.startTime !== undefined && { startTime: data.startTime }),
        ...(data.endTime !== undefined && { endTime: data.endTime }),
        ...(data.room !== undefined && { room: data.room }),
      },
    });

    return updated;
  }

  /**
   * Delete a timetable entry. Asserts school ownership.
   * Does not cascade to attendance sessions.
   *
   * Requirements: 17.5
   */
  async deleteEntry(schoolId: string, entryId: string): Promise<void> {
    const entry = await prisma.timetableEntry.findUnique({ where: { id: entryId } });

    if (!entry) {
      throw new AppError(404, 'ENTRY_NOT_FOUND', 'Timetable entry not found');
    }

    if (entry.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    await prisma.timetableEntry.delete({ where: { id: entryId } });
  }

  /**
   * List timetable entries scoped to a school with optional filters.
   *
   * Requirements: 17.1
   */
  async listEntries(schoolId: string, filters?: ListTimetableFilters) {
    const where: Record<string, unknown> = { schoolId };

    if (filters?.classId) {
      where.classId = filters.classId;
    }
    if (filters?.teacherId) {
      where.teacherId = filters.teacherId;
    }
    if (filters?.dayOfWeek !== undefined) {
      where.dayOfWeek = filters.dayOfWeek;
    }

    const entries = await prisma.timetableEntry.findMany({ where });

    return entries;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Validate that required timetable entry fields are present and valid.
   */
  private _validateEntryData(data: CreateTimetableEntryData): void {
    if (!data.classId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'classId is required');
    }
    if (!data.teacherId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'teacherId is required');
    }
    if (!data.subject) {
      throw new AppError(400, 'VALIDATION_ERROR', 'subject is required');
    }
    if (data.dayOfWeek < 0 || data.dayOfWeek > 6) {
      throw new AppError(400, 'VALIDATION_ERROR', 'dayOfWeek must be between 0 and 6');
    }
    if (!data.startTime || !data.endTime) {
      throw new AppError(400, 'VALIDATION_ERROR', 'startTime and endTime are required');
    }
    if (data.startTime >= data.endTime) {
      throw new AppError(400, 'VALIDATION_ERROR', 'startTime must be before endTime');
    }
  }

  /**
   * Check for timetable overlaps on the same day with the same teacher, class, or room.
   * Time overlap: existingStart < newEnd AND existingEnd > newStart
   *
   * @param excludeId - Entry ID to exclude from the check (for updates)
   */
  private async _checkOverlaps(
    schoolId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    targets: { teacherId: string; classId: string; room?: string },
    excludeId?: string,
  ): Promise<void> {
    // Build the base query: same school, same day
    const baseWhere: Record<string, unknown> = {
      schoolId,
      dayOfWeek,
      // Time overlap: existingStart < newEnd AND existingEnd > newStart
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    };

    // Exclude self when updating
    if (excludeId) {
      baseWhere.id = { not: excludeId };
    }

    // Check teacher conflict
    const teacherConflict = await prisma.timetableEntry.findFirst({
      where: {
        ...baseWhere,
        teacherId: targets.teacherId,
      },
    });

    if (teacherConflict) {
      throw new AppError(
        409,
        'TIMETABLE_CONFLICT',
        `Teacher already has a class scheduled at this time (${teacherConflict.subject}, ${teacherConflict.startTime}-${teacherConflict.endTime})`,
      );
    }

    // Check class conflict
    const classConflict = await prisma.timetableEntry.findFirst({
      where: {
        ...baseWhere,
        classId: targets.classId,
      },
    });

    if (classConflict) {
      throw new AppError(
        409,
        'TIMETABLE_CONFLICT',
        `Class already has a lesson scheduled at this time (${classConflict.subject}, ${classConflict.startTime}-${classConflict.endTime})`,
      );
    }

    // Check room conflict (only if room is specified)
    if (targets.room) {
      const roomConflict = await prisma.timetableEntry.findFirst({
        where: {
          ...baseWhere,
          room: targets.room,
        },
      });

      if (roomConflict) {
        throw new AppError(
          409,
          'TIMETABLE_CONFLICT',
          `Room "${targets.room}" is already booked at this time (${roomConflict.subject}, ${roomConflict.startTime}-${roomConflict.endTime})`,
        );
      }
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const timetableService = new TimetableService();
