"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const crypto_1 = __importDefault(require("crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const auth_1 = require("../middleware/auth");
const loginRateLimiter_1 = require("../middleware/loginRateLimiter");
const authService_1 = require("../services/authService");
const webauthnService_1 = require("../services/webauthnService");
const index_1 = require("../index");
const notificationService_1 = require("../services/notificationService");
// ─── Validation Schemas ───────────────────────────────────────────────────────
const loginSchema = zod_1.z.object({
    schoolCode: zod_1.z.string().optional().default(''),
    identifier: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
});
const refreshSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1),
});
const logoutSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1),
});
const forgotPasswordSchema = zod_1.z.object({
    schoolCode: zod_1.z.string().min(3),
    identifier: zod_1.z.string().min(1),
});
const resetPasswordSchema = zod_1.z.object({
    token: zod_1.z.string().min(1),
    newPassword: zod_1.z.string().min(8),
});
// ─── Error Code → HTTP Status Mapping ────────────────────────────────────────
function errorCodeToStatus(code) {
    switch (code) {
        case 'INVALID_CREDENTIALS':
            return 401;
        case 'ACCOUNT_LOCKED':
            return 401;
        case 'INVALID_REFRESH_TOKEN':
            return 401;
        case 'REFRESH_TOKEN_EXPIRED':
            return 401;
        case 'USER_NOT_FOUND':
            return 401;
        default:
            return 500;
    }
}
// ─── Router ───────────────────────────────────────────────────────────────────
exports.authRouter = (0, express_1.Router)();
/**
 * POST /api/v1/auth/login
 * Authenticate a user with schoolCode + identifier + password.
 * Requirements: 3.7, 3.8
 */
exports.authRouter.post('/login', loginRateLimiter_1.loginRateLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
            requestId: req.id,
        });
        return;
    }
    const { schoolCode, identifier, password } = parsed.data;
    try {
        const tokenPair = await authService_1.authService.login(schoolCode, identifier, password);
        res.status(200).json(tokenPair);
    }
    catch (err) {
        const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
        const status = errorCodeToStatus(code);
        res.status(status).json({
            error: code === 'ACCOUNT_LOCKED' ? 'Account is locked' : 'Invalid credentials',
            code,
            requestId: req.id,
        });
    }
});
/**
 * POST /api/v1/auth/refresh
 * Exchange a valid refresh token for a new token pair.
 * Requirements: 3.8
 */
exports.authRouter.post('/refresh', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
            requestId: req.id,
        });
        return;
    }
    const { refreshToken } = parsed.data;
    try {
        const tokenPair = await authService_1.authService.refresh(refreshToken);
        res.status(200).json(tokenPair);
    }
    catch (err) {
        const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
        const status = errorCodeToStatus(code);
        res.status(status).json({
            error: 'Invalid or expired refresh token',
            code,
            requestId: req.id,
        });
    }
});
/**
 * POST /api/v1/auth/logout
 * Invalidate a refresh token. Requires authentication.
 * Requirements: 3.7
 */
exports.authRouter.post('/logout', auth_1.authenticate, async (req, res) => {
    const parsed = logoutSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
            requestId: req.id,
        });
        return;
    }
    const { refreshToken } = parsed.data;
    const userId = req.user.sub;
    try {
        await authService_1.authService.logout(userId, refreshToken);
        res.status(204).send();
    }
    catch (err) {
        const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
        res.status(500).json({
            error: 'Logout failed',
            code,
            requestId: req.id,
        });
    }
});
/**
 * POST /api/v1/auth/forgot-password
 * Generate a reset token and send a reset link via email/SMS.
 */
exports.authRouter.post('/forgot-password', async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
            requestId: req.id,
        });
        return;
    }
    const { schoolCode, identifier } = parsed.data;
    try {
        // Find school
        const school = await index_1.prisma.school.findUnique({ where: { schoolCode } });
        if (!school) {
            res.status(200).json({ message: 'If the account exists, a reset link has been sent.' });
            return;
        }
        // Find user by identifier within school
        const user = await index_1.prisma.user.findFirst({
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
        if (!user) {
            res.status(200).json({ message: 'If the account exists, a reset link has been sent.' });
            return;
        }
        // Generate a secure reset token (valid for 1 hour)
        const resetToken = crypto_1.default.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        // Store SHA-256 hash of the token — raw token is never stored
        const resetTokenHash = crypto_1.default.createHash('sha256').update(resetToken).digest('hex');
        await index_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordResetToken: resetTokenHash,
                passwordResetExpires: resetExpires,
            },
        });
        const appUrl = process.env.APP_URL || 'https://app.smart-managment.com';
        const resetLink = `${appUrl}/reset-password?token=${resetToken}`;
        // Send reset link via email if available
        if (user.email) {
            await notificationService_1.notificationService.sendEmail(user.email, 'SAMS Password Reset', `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0d9488;">Reset Your Password</h2>
          <p>You requested a password reset for your SAMS account.</p>
          <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetLink}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
            Reset Password
          </a>
          <p style="color:#666;font-size:13px;">Or copy this link: ${resetLink}</p>
          <p style="color:#999;font-size:12px;">If you didn't request this, ignore this email. Your password won't change.</p>
        </div>
        `);
        }
        // Send reset link via SMS if available
        if (user.phone) {
            await notificationService_1.notificationService.sendSMS(user.phone, `SAMS Password Reset: Click this link to reset your password (expires in 1 hour): ${resetLink}`);
        }
        res.status(200).json({ message: 'If the account exists, a reset link has been sent.' });
    }
    catch (err) {
        console.error('[Auth] Forgot password error:', err);
        res.status(500).json({
            error: 'Failed to process password reset',
            code: 'INTERNAL_ERROR',
            requestId: req.id,
        });
    }
});
/**
 * POST /api/v1/auth/reset-password
 * Validate reset token and set a new password.
 */
exports.authRouter.post('/reset-password', async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: parsed.error.flatten().fieldErrors,
            requestId: req.id,
        });
        return;
    }
    const { token, newPassword } = parsed.data;
    try {
        // Hash the incoming token to compare against the stored hash
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        // Find user with this token hash that hasn't expired
        const user = await index_1.prisma.user.findFirst({
            where: {
                passwordResetToken: tokenHash,
                passwordResetExpires: { gt: new Date() },
            },
        });
        if (!user) {
            res.status(400).json({
                error: 'Reset link is invalid or has expired. Please request a new one.',
                code: 'INVALID_RESET_TOKEN',
                requestId: req.id,
            });
            return;
        }
        // Hash the new password and clear the reset token
        const passwordHash = await bcrypt_1.default.hash(newPassword, 12);
        await index_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                passwordResetToken: null,
                passwordResetExpires: null,
            },
        });
        res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
    }
    catch (err) {
        console.error('[Auth] Reset password error:', err);
        res.status(500).json({
            error: 'Failed to reset password',
            code: 'INTERNAL_ERROR',
            requestId: req.id,
        });
    }
});
// ─── WebAuthn Routes ──────────────────────────────────────────────────────────
/**
 * POST /api/v1/auth/webauthn/register/options
 * Generate WebAuthn registration options for the authenticated teacher.
 * Requires authentication.
 */
exports.authRouter.post('/webauthn/register/options', auth_1.authenticate, async (req, res) => {
    try {
        const options = await webauthnService_1.webauthnService.generateRegistrationOptions(req.user.sub);
        res.status(200).json(options);
    }
    catch (err) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
        }
        else {
            res.status(500).json({ error: 'Failed to generate registration options', code: 'INTERNAL_ERROR' });
        }
    }
});
/**
 * POST /api/v1/auth/webauthn/register/verify
 * Verify and store a WebAuthn credential registration.
 * Requires authentication.
 */
exports.authRouter.post('/webauthn/register/verify', auth_1.authenticate, async (req, res) => {
    const { credentialId, publicKey, clientDataJSON, transports } = req.body;
    if (!credentialId || !publicKey || !clientDataJSON) {
        res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
        return;
    }
    try {
        const result = await webauthnService_1.webauthnService.verifyRegistration(req.user.sub, credentialId, publicKey, clientDataJSON, transports);
        res.status(201).json(result);
    }
    catch (err) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
        }
        else {
            res.status(500).json({ error: 'Failed to verify registration', code: 'INTERNAL_ERROR' });
        }
    }
});
/**
 * POST /api/v1/auth/webauthn/authenticate/options
 * Generate WebAuthn authentication options (no auth required — this is for login).
 */
exports.authRouter.post('/webauthn/authenticate/options', async (req, res) => {
    try {
        const options = await webauthnService_1.webauthnService.generateAuthenticationOptions();
        res.status(200).json(options);
    }
    catch (err) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
        }
        else {
            res.status(500).json({ error: 'Failed to generate authentication options', code: 'INTERNAL_ERROR' });
        }
    }
});
/**
 * POST /api/v1/auth/webauthn/authenticate/verify
 * Verify a WebAuthn authentication assertion and return JWT tokens.
 */
exports.authRouter.post('/webauthn/authenticate/verify', async (req, res) => {
    const { credentialId, authenticatorData, clientDataJSON, signature } = req.body;
    if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
        res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
        return;
    }
    try {
        const { user } = await webauthnService_1.webauthnService.verifyAuthentication(credentialId, authenticatorData, clientDataJSON, signature);
        // Generate JWT tokens for the authenticated user (same as password login)
        const tokenPair = await authService_1.authService.generateTokensForUser(user.id);
        res.status(200).json({
            token: tokenPair.accessToken,
            refreshToken: tokenPair.refreshToken,
            user,
        });
    }
    catch (err) {
        if (err.statusCode) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
        }
        else if (err.message === 'ACCOUNT_LOCKED') {
            res.status(401).json({ error: 'Account is locked', code: 'ACCOUNT_LOCKED' });
        }
        else {
            res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' });
        }
    }
});
//# sourceMappingURL=auth.js.map