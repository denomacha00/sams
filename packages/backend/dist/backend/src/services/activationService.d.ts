export declare class ActivationError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(code: string, message: string, statusCode: number);
}
export interface ActivationInput {
    licenseKey: string;
    schoolCode: string;
    adminFullName: string;
    adminEmail: string;
    adminPassword: string;
}
export interface ActivationResult {
    schoolId: string;
    schoolCode: string;
}
export declare class ActivationService {
    /**
     * Activates a school using a license key.
     *
     * Steps:
     *  1. Validate key format with regex
     *  2. Decode key (HMAC verification)
     *  3. Check expiry
     *  4. Compute SHA-256 hash of the key and look up LicenseKey record directly
     *  5. Check schoolCode uniqueness
     *  6. Transactionally create School, User (SCHOOL_ADMIN), and mark LicenseKey used
     *  7. Log LICENSE_ACTIVATION audit event
     *
     * The raw license key is NEVER included in any response, log, or error.
     */
    activate(input: ActivationInput): Promise<ActivationResult>;
}
export declare const activationService: ActivationService;
//# sourceMappingURL=activationService.d.ts.map