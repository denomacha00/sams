"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activationService = exports.ActivationService = exports.ActivationError = void 0;
const crypto_1 = require("crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const shared_1 = require("@sams/shared");
const index_1 = require("../index");
const auditService_1 = require("./auditService");
// ─── Constants ────────────────────────────────────────────────────────────────
const BCRYPT_COST = 12;
const LICENSE_KEY_FORMAT = /^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/;
// ─── Error Codes ──────────────────────────────────────────────────────────────
class ActivationError extends Error {
    code;
    statusCode;
    constructor(code, message, statusCode) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = 'ActivationError';
    }
}
exports.ActivationError = ActivationError;
// ─── Activation Service ───────────────────────────────────────────────────────
class ActivationService {
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
    async activate(input) {
        const { licenseKey, schoolCode, adminFullName, adminEmail, adminPassword } = input;
        // ── Step 1: Validate key format ──────────────────────────────────────────
        if (!LICENSE_KEY_FORMAT.test(licenseKey)) {
            throw new ActivationError('INVALID_LICENSE_FORMAT', 'The license key format is invalid.', 400);
        }
        // ── Step 2: Decode key (HMAC verification) ───────────────────────────────
        const secret = process.env.LICENSE_SECRET;
        if (!secret) {
            throw new Error('LICENSE_SECRET environment variable is not configured.');
        }
        const payload = (0, shared_1.decodeLicenseKey)(licenseKey, secret);
        if (payload === null) {
            throw new ActivationError('INVALID_LICENSE', 'The license key is invalid or has been tampered with.', 400);
        }
        // ── Step 3: Check expiry ─────────────────────────────────────────────────
        const now = new Date();
        if (payload.expiresAt < now) {
            throw new ActivationError('LICENSE_EXPIRED', 'The license key has expired.', 400);
        }
        // ── Step 4: SHA-256 hash lookup (single query, no loop) ──────────────────
        const keyHash = (0, crypto_1.createHash)('sha256').update(licenseKey).digest('hex');
        const matchedLicenseKey = await index_1.prisma.licenseKey.findFirst({
            where: { keyHash },
        });
        if (!matchedLicenseKey) {
            throw new ActivationError('INVALID_LICENSE', 'The license key is invalid or has been tampered with.', 400);
        }
        if (matchedLicenseKey.usedAt !== null) {
            throw new ActivationError('LICENSE_USED', 'This license key has already been used.', 409);
        }
        // ── Step 5: Check schoolCode uniqueness ──────────────────────────────────
        const existingSchool = await index_1.prisma.school.findUnique({
            where: { schoolCode },
        });
        if (existingSchool !== null) {
            throw new ActivationError('SCHOOL_CODE_TAKEN', 'The school code is already in use. Please choose a different one.', 409);
        }
        // ── Step 6: Transactional creation ───────────────────────────────────────
        const passwordHash = await bcrypt_1.default.hash(adminPassword, BCRYPT_COST);
        const { school, adminUser } = await index_1.prisma.$transaction(async (tx) => {
            // Create School record
            const school = await tx.school.create({
                data: {
                    name: payload.schoolName,
                    schoolCode,
                    planTier: payload.planTier,
                    licenseExpiresAt: payload.expiresAt,
                },
            });
            // Create SCHOOL_ADMIN user
            const adminUser = await tx.user.create({
                data: {
                    schoolId: school.id,
                    role: 'SCHOOL_ADMIN',
                    fullName: adminFullName,
                    email: adminEmail,
                    passwordHash,
                },
            });
            // Mark LicenseKey as used
            await tx.licenseKey.update({
                where: { id: matchedLicenseKey.id },
                data: {
                    usedAt: now,
                    usedBySchoolId: school.id,
                },
            });
            return { school, adminUser };
        });
        // ── Step 7: Audit log ────────────────────────────────────────────────────
        // Raw license key is intentionally excluded from the snapshot.
        await auditService_1.auditService.log({
            eventType: 'LICENSE_ACTIVATION',
            actorId: adminUser.id,
            actorRole: 'SCHOOL_ADMIN',
            schoolId: school.id,
            resourceSnapshot: {
                schoolId: school.id,
                schoolCode: school.schoolCode,
                schoolName: school.name,
                planTier: school.planTier,
                licenseExpiresAt: school.licenseExpiresAt.toISOString(),
                adminUserId: adminUser.id,
                adminEmail: adminUser.email,
                // Raw license key deliberately omitted (Requirement 19.7)
            },
        });
        return {
            schoolId: school.id,
            schoolCode: school.schoolCode,
        };
    }
}
exports.ActivationService = ActivationService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.activationService = new ActivationService();
//# sourceMappingURL=activationService.js.map