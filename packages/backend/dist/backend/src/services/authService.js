"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cuid2_1 = require("@paralleldrive/cuid2");
const index_1 = require("../index");
const auditService_1 = require("./auditService");
const notificationService_1 = require("./notificationService");
// ─── Constants ────────────────────────────────────────────────────────────────
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes in ms
const BCRYPT_ROUNDS = 12;
// ─── Auth Service ─────────────────────────────────────────────────────────────
class AuthService {
    /**
     * Authenticate a user by schoolCode + identifier (email or admissionNumber) + password.
     *
     * Flow:
     * 1. Find school by schoolCode
     * 2. Find user by email OR admissionNumber within that school
     * 3. Check isLocked
     * 4. Enforce 5-attempt / 15-min lockout window
     * 5. Compare bcrypt password hash
     * 6. On success: generate token pair, store hashed refresh token, log USER_LOGIN, reset failed count
     * 7. On failure: increment failed count, lock account if threshold reached
     *
     * Requirements: 3.1, 3.6, 3.7, 3.8, 19.2, 19.5
     */
    async login(schoolCode, identifier, password) {
        let user = null;
        if (schoolCode) {
            // If school code provided, scope to that school
            const school = await index_1.prisma.school.findUnique({
                where: { schoolCode },
            });
            if (!school) {
                throw new Error('INVALID_CREDENTIALS');
            }
            user = await index_1.prisma.user.findFirst({
                where: {
                    schoolId: school.id,
                    OR: [
                        { email: identifier },
                        { admissionNumber: identifier },
                        { username: identifier },
                        { phone: identifier },
                    ],
                },
            });
        }
        else {
            // No school code — search across ALL schools by unique identifier
            user = await index_1.prisma.user.findFirst({
                where: {
                    OR: [
                        { email: identifier },
                        { admissionNumber: identifier },
                        { username: identifier },
                        { phone: identifier },
                    ],
                },
            });
        }
        if (!user) {
            throw new Error('INVALID_CREDENTIALS');
        }
        // 3. Check isLocked
        if (user.isLocked) {
            throw new Error('ACCOUNT_LOCKED');
        }
        // 4. Enforce 5-attempt / 15-min lockout window
        const now = new Date();
        const windowStart = user.failedLoginWindowStart;
        const withinWindow = windowStart !== null &&
            now.getTime() - windowStart.getTime() < LOCKOUT_WINDOW_MS;
        if (withinWindow && user.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
            // Lock the account
            await this.lockAccount(user.id);
            throw new Error('ACCOUNT_LOCKED');
        }
        // 5. Compare bcrypt password hash
        const passwordMatch = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!passwordMatch) {
            // Increment failed login count
            const newCount = withinWindow ? user.failedLoginCount + 1 : 1;
            const newWindowStart = withinWindow ? windowStart : now;
            await index_1.prisma.user.update({
                where: { id: user.id },
                data: {
                    failedLoginCount: newCount,
                    failedLoginWindowStart: newWindowStart,
                },
            });
            // Lock account if threshold reached
            if (newCount >= MAX_FAILED_ATTEMPTS) {
                await this.lockAccount(user.id);
                throw new Error('ACCOUNT_LOCKED');
            }
            throw new Error('INVALID_CREDENTIALS');
        }
        // 6. Password correct — generate token pair
        const tokenPair = this._generateTokenPair(user);
        // Hash the refresh token before storing
        const refreshTokenHash = await bcrypt_1.default.hash(tokenPair.refreshToken, BCRYPT_ROUNDS);
        // Store hashed refresh token in RefreshToken table
        await index_1.prisma.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: refreshTokenHash,
                expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
            },
        });
        // Update lastLoginAt and reset failed login count
        await index_1.prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginAt: now,
                failedLoginCount: 0,
                failedLoginWindowStart: null,
            },
        });
        // Log USER_LOGIN to AuditLog
        await auditService_1.auditService.log({
            eventType: 'USER_LOGIN',
            actorId: user.id,
            actorRole: user.role,
            schoolId: user.schoolId,
            resourceSnapshot: {
                userId: user.id,
                email: user.email,
                admissionNumber: user.admissionNumber,
                role: user.role,
                loginAt: now.toISOString(),
            },
        });
        return tokenPair;
    }
    /**
     * Exchange a valid refresh token for a new token pair (rotation).
     * Verifies JWT signature, looks up hashed token in DB, deletes old token,
     * inserts new token.
     *
     * Requirements: 3.8
     */
    async refresh(refreshToken) {
        const refreshSecret = process.env.JWT_REFRESH_SECRET;
        if (!refreshSecret) {
            throw new Error('JWT_REFRESH_SECRET not configured');
        }
        // Verify JWT signature and expiry
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(refreshToken, refreshSecret);
        }
        catch {
            throw new Error('INVALID_REFRESH_TOKEN');
        }
        const { sub: userId } = payload;
        // Look up all refresh tokens for this user and find the matching one
        const storedTokens = await index_1.prisma.refreshToken.findMany({
            where: { userId },
        });
        let matchedToken = null;
        for (const stored of storedTokens) {
            const isMatch = await bcrypt_1.default.compare(refreshToken, stored.tokenHash);
            if (isMatch) {
                matchedToken = stored;
                break;
            }
        }
        if (!matchedToken) {
            throw new Error('INVALID_REFRESH_TOKEN');
        }
        // Check token expiry in DB
        if (matchedToken.expiresAt < new Date()) {
            await index_1.prisma.refreshToken.delete({ where: { id: matchedToken.id } });
            throw new Error('REFRESH_TOKEN_EXPIRED');
        }
        // Fetch the user to build the new access token payload
        const user = await index_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }
        if (user.isLocked) {
            throw new Error('ACCOUNT_LOCKED');
        }
        // Generate new token pair
        const newTokenPair = this._generateTokenPair(user);
        // Hash new refresh token
        const newRefreshTokenHash = await bcrypt_1.default.hash(newTokenPair.refreshToken, BCRYPT_ROUNDS);
        // Rotate: delete old token, insert new token (atomic-ish via transaction)
        await index_1.prisma.$transaction([
            index_1.prisma.refreshToken.delete({ where: { id: matchedToken.id } }),
            index_1.prisma.refreshToken.create({
                data: {
                    userId: user.id,
                    tokenHash: newRefreshTokenHash,
                    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
                },
            }),
        ]);
        return newTokenPair;
    }
    /**
     * Invalidate a refresh token and log USER_LOGOUT.
     *
     * Requirements: 3.7
     */
    async logout(userId, refreshToken) {
        // Find all refresh tokens for this user and delete the matching one
        const storedTokens = await index_1.prisma.refreshToken.findMany({
            where: { userId },
        });
        for (const stored of storedTokens) {
            const isMatch = await bcrypt_1.default.compare(refreshToken, stored.tokenHash);
            if (isMatch) {
                await index_1.prisma.refreshToken.delete({ where: { id: stored.id } });
                break;
            }
        }
        // Fetch user for audit log context
        const user = await index_1.prisma.user.findUnique({ where: { id: userId } });
        // Log USER_LOGOUT to AuditLog
        await auditService_1.auditService.log({
            eventType: 'USER_LOGOUT',
            actorId: userId,
            actorRole: user?.role,
            schoolId: user?.schoolId,
            resourceSnapshot: {
                userId,
                logoutAt: new Date().toISOString(),
            },
        });
    }
    /**
     * Lock a user account and notify the School Admin via NotificationService.
     *
     * Requirements: 19.5
     */
    async lockAccount(userId) {
        const user = await index_1.prisma.user.update({
            where: { id: userId },
            data: { isLocked: true },
            include: { school: true },
        });
        // Find the School Admin(s) for this school to notify
        const schoolAdmins = await index_1.prisma.user.findMany({
            where: {
                schoolId: user.schoolId,
                role: 'SCHOOL_ADMIN',
            },
        });
        const lockedUserLabel = user.email ?? user.admissionNumber ?? userId;
        for (const admin of schoolAdmins) {
            // Send in-app notification
            await notificationService_1.notificationService.sendInApp(admin.id, {
                title: 'Account Locked',
                message: `User account "${lockedUserLabel}" has been locked after ${MAX_FAILED_ATTEMPTS} failed login attempts.`,
                type: 'ACCOUNT_LOCKED',
            });
            // Send email notification if admin has an email
            if (admin.email) {
                await notificationService_1.notificationService.sendEmail(admin.email, 'SAMS: User Account Locked', `<p>The account for <strong>${lockedUserLabel}</strong> has been automatically locked after ${MAX_FAILED_ATTEMPTS} consecutive failed login attempts.</p>
           <p>Please review and unlock the account if appropriate.</p>`);
            }
        }
    }
    // ─── Private Helpers ────────────────────────────────────────────────────────
    /**
     * Generate tokens for a user by ID (used by WebAuthn login flow).
     * Stores the refresh token and updates lastLoginAt.
     */
    async generateTokensForUser(userId) {
        const user = await index_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new Error('USER_NOT_FOUND');
        if (user.isLocked)
            throw new Error('ACCOUNT_LOCKED');
        const tokenPair = this._generateTokenPair(user);
        // Hash and store refresh token
        const refreshTokenHash = await bcrypt_1.default.hash(tokenPair.refreshToken, BCRYPT_ROUNDS);
        await index_1.prisma.refreshToken.create({
            data: {
                userId: user.id,
                tokenHash: refreshTokenHash,
                expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
            },
        });
        // Update lastLoginAt
        await index_1.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date(), failedLoginCount: 0, failedLoginWindowStart: null },
        });
        // Log USER_LOGIN
        await auditService_1.auditService.log({
            eventType: 'USER_LOGIN',
            actorId: user.id,
            actorRole: user.role,
            schoolId: user.schoolId,
            resourceSnapshot: {
                userId: user.id,
                method: 'webauthn',
                loginAt: new Date().toISOString(),
            },
        });
        return tokenPair;
    }
    /**
     * Generate a JWT access token and refresh token for the given user.
     */
    _generateTokenPair(user) {
        const accessSecret = process.env.JWT_SECRET;
        const refreshSecret = process.env.JWT_REFRESH_SECRET;
        if (!accessSecret)
            throw new Error('JWT_SECRET not configured');
        if (!refreshSecret)
            throw new Error('JWT_REFRESH_SECRET not configured');
        // Access token payload
        const accessPayload = {
            sub: user.id,
            schoolId: user.schoolId,
            role: user.role,
            ...(user.departmentId !== null && { departmentId: user.departmentId }),
            ...(user.classId !== null && { classId: user.classId }),
        };
        // Refresh token payload — minimal, just sub + unique jti
        const refreshPayload = {
            sub: user.id,
            jti: (0, cuid2_1.createId)(),
        };
        const accessToken = jsonwebtoken_1.default.sign(accessPayload, accessSecret, {
            expiresIn: ACCESS_TOKEN_EXPIRY,
        });
        const refreshToken = jsonwebtoken_1.default.sign(refreshPayload, refreshSecret, {
            expiresIn: REFRESH_TOKEN_EXPIRY,
        });
        return { accessToken, refreshToken };
    }
}
exports.AuthService = AuthService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.authService = new AuthService();
//# sourceMappingURL=authService.js.map