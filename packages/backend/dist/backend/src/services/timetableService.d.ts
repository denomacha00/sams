export interface CreateTimetableEntryData {
    classId: string;
    teacherId: string;
    subject: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
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
export declare class TimetableService {
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
    createEntry(schoolId: string, data: CreateTimetableEntryData): Promise<{
        id: string;
        schoolId: string;
        createdAt: Date;
        subject: string;
        updatedAt: Date;
        classId: string;
        teacherId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        room: string | null;
    }>;
    /**
     * Update an existing timetable entry.
     * Fetches the entry, asserts school ownership, re-runs overlap check
     * excluding self, then updates.
     *
     * Requirements: 17.4
     */
    updateEntry(schoolId: string, entryId: string, data: UpdateTimetableEntryData): Promise<{
        id: string;
        schoolId: string;
        createdAt: Date;
        subject: string;
        updatedAt: Date;
        classId: string;
        teacherId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        room: string | null;
    }>;
    /**
     * Delete a timetable entry. Asserts school ownership.
     * Does not cascade to attendance sessions.
     *
     * Requirements: 17.5
     */
    deleteEntry(schoolId: string, entryId: string): Promise<void>;
    /**
     * List timetable entries scoped to a school with optional filters.
     *
     * Requirements: 17.1
     */
    listEntries(schoolId: string, filters?: ListTimetableFilters): Promise<({
        class: {
            name: string;
        };
        teacher: {
            fullName: string;
        };
    } & {
        id: string;
        schoolId: string;
        createdAt: Date;
        subject: string;
        updatedAt: Date;
        classId: string;
        teacherId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        room: string | null;
    })[]>;
    /**
     * Validate that required timetable entry fields are present and valid.
     */
    private _validateEntryData;
    /**
     * Check for timetable overlaps on the same day with the same teacher, class, or room.
     * Time overlap: existingStart < newEnd AND existingEnd > newStart
     *
     * @param excludeId - Entry ID to exclude from the check (for updates)
     */
    private _checkOverlaps;
}
export declare const timetableService: TimetableService;
//# sourceMappingURL=timetableService.d.ts.map