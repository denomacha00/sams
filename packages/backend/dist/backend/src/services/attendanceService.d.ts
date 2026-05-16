import { OfflineAttendanceRecord, SyncResult } from '@sams/shared';
export declare class AttendanceService {
    /**
     * Generate a shareable attendance link for an active session.
     * Creates a JWT with type 'LINK', stores it on the session record,
     * and returns the full shareable URL.
     */
    generateAttendanceLink(sessionId: string, schoolId: string, expiryMinutes?: number): Promise<{
        linkToken: string;
        linkUrl: string;
        expiresAt: string;
        sessionId: string;
    }>;
    /**
     * Record attendance via link token.
     * Validates the link JWT (type: 'LINK'), checks GPS proximity,
     * prevents duplicates, classifies status, and creates the record.
     */
    recordLinkAttendance(studentId: string, schoolId: string, linkToken: string, gpsCoords: {
        lat: number;
        lng: number;
    }): Promise<{
        studentId: string;
        id: string;
        schoolId: string;
        createdAt: Date;
        note: string | null;
        updatedAt: Date;
        method: string;
        status: import(".prisma/client").$Enums.AttendanceStatus;
        sessionId: string;
        scannedAt: Date;
        syncedAt: Date | null;
    }>;
    /**
     * Record attendance via QR code scan.
     * Validates the QR JWT, checks GPS proximity, prevents duplicates,
     * classifies status, and creates the record.
     */
    recordQRScan(studentId: string, schoolId: string, qrToken: string, gpsCoords: {
        lat: number;
        lng: number;
    }): Promise<{
        studentId: string;
        id: string;
        schoolId: string;
        createdAt: Date;
        note: string | null;
        updatedAt: Date;
        method: string;
        status: import(".prisma/client").$Enums.AttendanceStatus;
        sessionId: string;
        scannedAt: Date;
        syncedAt: Date | null;
    }>;
    /**
     * Record attendance manually by a teacher.
     * Validates status and note length, handles duplicates by updating.
     */
    recordManual(teacherId: string, schoolId: string, studentId: string, sessionId: string, status: string, note?: string): Promise<{
        studentId: string;
        id: string;
        schoolId: string;
        createdAt: Date;
        note: string | null;
        updatedAt: Date;
        method: string;
        status: import(".prisma/client").$Enums.AttendanceStatus;
        sessionId: string;
        scannedAt: Date;
        syncedAt: Date | null;
    }>;
    /**
     * Record attendance via biometric verification.
     * Checks confidence threshold before creating the record.
     */
    recordBiometric(teacherId: string, schoolId: string, sessionId: string, studentId: string, confidence: number): Promise<{
        studentId: string;
        id: string;
        schoolId: string;
        createdAt: Date;
        note: string | null;
        updatedAt: Date;
        method: string;
        status: import(".prisma/client").$Enums.AttendanceStatus;
        sessionId: string;
        scannedAt: Date;
        syncedAt: Date | null;
    }>;
    /**
     * Update an existing attendance record.
     * Validates school ownership, stores previous status, and logs to audit.
     */
    updateRecord(teacherId: string, schoolId: string, recordId: string, status: string, note?: string): Promise<{
        studentId: string;
        id: string;
        schoolId: string;
        createdAt: Date;
        note: string | null;
        updatedAt: Date;
        method: string;
        status: import(".prisma/client").$Enums.AttendanceStatus;
        sessionId: string;
        scannedAt: Date;
        syncedAt: Date | null;
    }>;
    /**
     * Sync offline attendance records.
     * For each record: check if a server record exists for the same session+student.
     * Conflict resolution: server timestamp > offline → keep server; else → upsert offline.
     * Logs every conflict to AuditService.
     */
    syncOfflineRecords(schoolId: string, records: OfflineAttendanceRecord[]): Promise<SyncResult>;
}
export declare const attendanceService: AttendanceService;
//# sourceMappingURL=attendanceService.d.ts.map