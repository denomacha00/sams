/**
 * Lightweight application error with a machine-readable code and HTTP status.
 */
export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(code: string, message: string, statusCode?: number);
}
export declare class LicenseService {
    /**
     * Check whether the school has reached its plan tier student limit.
     * Counts all users with role STUDENT in the given school and compares
     * against the tier's maximum. Throws AppError 422 PLAN_LIMIT_REACHED
     * if the limit has been reached.
     *
     * Requirements: 12.1, 12.6
     */
    checkStudentLimit(schoolId: string): Promise<void>;
    /**
     * Check whether the school's plan tier grants access to a specific feature.
     * Returns true if the school's tier is in the feature's allowed tiers list,
     * false otherwise.
     *
     * Requirements: 12.2, 12.3, 12.4, 12.5
     */
    checkFeatureAccess(schoolId: string, feature: 'biometric' | 'ai' | 'api_access' | 'custom_branding'): Promise<boolean>;
    /**
     * Check whether the school's license has expired.
     * If licenseExpiresAt < now, sets isReadOnly=true on the school and
     * notifies the School Admin(s) via NotificationService.
     *
     * Requirements: 12.7
     */
    checkLicenseExpiry(schoolId: string): Promise<void>;
    /**
     * Suspend a school immediately.
     * Sets isSuspended=true, revokes all active AttendanceSessions (isActive=false),
     * and logs the event to AuditService.
     *
     * Requirements: 15.3
     */
    suspendSchool(schoolId: string): Promise<void>;
    /**
     * Extend a school's license to a new expiry date.
     * Updates licenseExpiresAt, clears isReadOnly (restores full access),
     * and logs the event to AuditService.
     *
     * Requirements: 15.4
     */
    extendLicense(schoolId: string, newExpiry: Date): Promise<void>;
}
export declare const licenseService: LicenseService;
//# sourceMappingURL=licenseService.d.ts.map