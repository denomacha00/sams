"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timetableService = exports.TimetableService = void 0;
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
// ─── Timetable Service ────────────────────────────────────────────────────────
class TimetableService {
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
    async createEntry(schoolId, data) {
        // Validate required fields
        this._validateEntryData(data);
        // Check for overlaps
        await this._checkOverlaps(schoolId, data.dayOfWeek, data.startTime, data.endTime, {
            teacherId: data.teacherId,
            classId: data.classId,
            room: data.room,
        });
        const entry = await index_1.prisma.timetableEntry.create({
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
    async updateEntry(schoolId, entryId, data) {
        const entry = await index_1.prisma.timetableEntry.findUnique({ where: { id: entryId } });
        if (!entry) {
            throw new errors_1.AppError(404, 'ENTRY_NOT_FOUND', 'Timetable entry not found');
        }
        if (entry.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
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
        const updated = await index_1.prisma.timetableEntry.update({
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
    async deleteEntry(schoolId, entryId) {
        const entry = await index_1.prisma.timetableEntry.findUnique({ where: { id: entryId } });
        if (!entry) {
            throw new errors_1.AppError(404, 'ENTRY_NOT_FOUND', 'Timetable entry not found');
        }
        if (entry.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
        }
        await index_1.prisma.timetableEntry.delete({ where: { id: entryId } });
    }
    /**
     * List timetable entries scoped to a school with optional filters.
     *
     * Requirements: 17.1
     */
    async listEntries(schoolId, filters) {
        const where = { schoolId };
        if (filters?.classId) {
            where.classId = filters.classId;
        }
        if (filters?.teacherId) {
            where.teacherId = filters.teacherId;
        }
        if (filters?.dayOfWeek !== undefined) {
            where.dayOfWeek = filters.dayOfWeek;
        }
        const entries = await index_1.prisma.timetableEntry.findMany({
            where,
            include: {
                class: { select: { name: true } },
                teacher: { select: { fullName: true } },
            },
        });
        return entries;
    }
    // ─── Private Helpers ────────────────────────────────────────────────────────
    /**
     * Validate that required timetable entry fields are present and valid.
     */
    _validateEntryData(data) {
        if (!data.classId) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'classId is required');
        }
        if (!data.teacherId) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'teacherId is required');
        }
        if (!data.subject) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'subject is required');
        }
        if (data.dayOfWeek < 0 || data.dayOfWeek > 6) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'dayOfWeek must be between 0 and 6');
        }
        if (!data.startTime || !data.endTime) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'startTime and endTime are required');
        }
        if (data.startTime >= data.endTime) {
            throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'startTime must be before endTime');
        }
    }
    /**
     * Check for timetable overlaps on the same day with the same teacher, class, or room.
     * Time overlap: existingStart < newEnd AND existingEnd > newStart
     *
     * @param excludeId - Entry ID to exclude from the check (for updates)
     */
    async _checkOverlaps(schoolId, dayOfWeek, startTime, endTime, targets, excludeId) {
        // Build the base query: same school, same day
        const baseWhere = {
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
        const teacherConflict = await index_1.prisma.timetableEntry.findFirst({
            where: {
                ...baseWhere,
                teacherId: targets.teacherId,
            },
        });
        if (teacherConflict) {
            throw new errors_1.AppError(409, 'TIMETABLE_CONFLICT', `Teacher already has a class scheduled at this time (${teacherConflict.subject}, ${teacherConflict.startTime}-${teacherConflict.endTime})`);
        }
        // Check class conflict
        const classConflict = await index_1.prisma.timetableEntry.findFirst({
            where: {
                ...baseWhere,
                classId: targets.classId,
            },
        });
        if (classConflict) {
            throw new errors_1.AppError(409, 'TIMETABLE_CONFLICT', `Class already has a lesson scheduled at this time (${classConflict.subject}, ${classConflict.startTime}-${classConflict.endTime})`);
        }
        // Check room conflict (only if room is specified)
        if (targets.room) {
            const roomConflict = await index_1.prisma.timetableEntry.findFirst({
                where: {
                    ...baseWhere,
                    room: targets.room,
                },
            });
            if (roomConflict) {
                throw new errors_1.AppError(409, 'TIMETABLE_CONFLICT', `Room "${targets.room}" is already booked at this time (${roomConflict.subject}, ${roomConflict.startTime}-${roomConflict.endTime})`);
            }
        }
    }
}
exports.TimetableService = TimetableService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.timetableService = new TimetableService();
//# sourceMappingURL=timetableService.js.map