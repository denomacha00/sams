export interface QRTokenPayload {
    sessionId: string;
    nonce: string;
    iat: number;
    exp: number;
}
export declare class SessionService {
    /**
     * Start a new attendance session for a teacher.
     * Validates that the timetable entry belongs to the teacher, creates the
     * session with an initial QR token, and returns the session record.
     */
    startSession(teacherId: string, schoolId: string, timetableEntryId: string, location: {
        lat: number;
        lng: number;
    }): Promise<{
        id: string;
        schoolId: string;
        subject: string;
        classId: string;
        isActive: boolean;
        lateThresholdMin: number;
        locationLat: number | null;
        locationLng: number | null;
        locationRadiusM: number;
        currentQRToken: string | null;
        qrRefreshedAt: Date | null;
        currentLinkToken: string | null;
        linkExpiresAt: Date | null;
        startedAt: Date;
        endedAt: Date | null;
        teacherId: string;
        timetableEntryId: string | null;
    }>;
    /**
     * End an active attendance session.
     * Verifies the teacher owns the session before deactivating it.
     */
    endSession(sessionId: string, teacherId: string): Promise<void>;
    /**
     * Generate a new QR code JWT for a session.
     * Returns the signed token string.
     */
    generateQRCode(sessionId: string): string;
    /**
     * Refresh the QR code for a session — generates a new token and persists it.
     */
    refreshQRCode(sessionId: string): Promise<string>;
    /**
     * Get the current active QR token for a session, or null if session is
     * inactive or not found.
     */
    getActiveQR(sessionId: string): Promise<string | null>;
}
export declare const sessionService: SessionService;
//# sourceMappingURL=sessionService.d.ts.map