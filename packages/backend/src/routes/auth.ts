import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticate } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/loginRateLimiter';
import { otpResendRateLimiter } from '../middleware/otpResendRateLimiter';
import { authService } from '../services/authService';
import { webauthnService } from '../services/webauthnService';
import { prisma } from '../index';
import { notificationService } from '../services/notificationService';
import {
  assertOtpResendAllowed,
  createOtp,
  createOtpChallenge,
  deliverOtp,
  isOtpLoginEnabled,
  isOtpPasswordResetEnabled,
  recordOtpResend,
  verifyOtp,
  verifyOtpChallenge,
} from '../services/otpService';
import { isEmailConfigured } from '../config/email';
import { isSmsConfigured } from '../config/africasTalking';
import { identifierMatchConditions } from '../utils/userIdentifier';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const loginSchema = z.object({
  schoolCode: z.string().optional().default(''),
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  schoolCode: z.string().min(3),
  identifier: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const verifyOtpSchema = z.object({
  otpChallenge: z.string().min(1),
  code: z.string().min(4).max(10),
});

const resendLoginOtpSchema = z.object({
  otpChallenge: z.string().min(1),
});

const forgotPasswordOtpSchema = z.object({
  schoolCode: z.string().min(3),
  identifier: z.string().min(1),
});

const resetPasswordOtpSchema = z.object({
  schoolCode: z.string().min(3),
  identifier: z.string().min(1),
  code: z.string().min(4).max(10),
  newPassword: z.string().min(8),
});

// ─── Error Code → HTTP Status Mapping ────────────────────────────────────────

function errorCodeToStatus(code: string): number {
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

export const authRouter = Router();

/**
 * POST /api/v1/auth/login
 * Authenticate with identifier (username, email, phone, or ADM) + password.
 * School code is optional and not required for sign-in.
 */
authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
    if (process.env.LOGIN_DEBUG === 'true') {
      console.log('[LOGIN_DEBUG]', {
        identifier,
        schoolCode: schoolCode || '(empty)',
        otpLoginEnabled: isOtpLoginEnabled(),
        requestId: req.id,
      });
    }

    if (isOtpLoginEnabled()) {
      const user = await authService.validateLoginCredentials(schoolCode, identifier, password);

      if (!user.email && !user.phone) {
        res.status(400).json({
          error: 'No email or phone on file for OTP verification. Contact your school admin.',
          code: 'OTP_CONTACT_MISSING',
          requestId: req.id,
        });
        return;
      }

      if (!isEmailConfigured() && !isSmsConfigured()) {
        res.status(503).json({
          error: 'OTP login is enabled but email/SMS is not configured on the server.',
          code: 'OTP_NOT_CONFIGURED',
          requestId: req.id,
        });
        return;
      }

      try {
        await assertOtpResendAllowed(user.id, 'login');
      } catch (cooldownErr) {
        const retryAfter = (cooldownErr as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60;
        res.status(429).json({
          error: `Please wait ${retryAfter} seconds before requesting another code.`,
          code: 'OTP_RESEND_COOLDOWN',
          retryAfterSeconds: retryAfter,
          requestId: req.id,
        });
        return;
      }

      const code = await createOtp(user.id, 'login');
      const delivery = await deliverOtp(user, code, 'login');

      if (!delivery.email && !delivery.sms) {
        res.status(502).json({
          error: formatOtpDeliveryError(delivery),
          code: 'OTP_DELIVERY_FAILED',
          smsError: delivery.smsError,
          emailError: delivery.emailError,
          sandbox: delivery.sandbox,
          requestId: req.id,
        });
        return;
      }

      await recordOtpResend(user.id, 'login');
      const otpChallenge = createOtpChallenge(user.id, 'login');
      res.status(200).json({
        requiresOtp: true,
        otpChallenge,
        delivery: {
          email: delivery.email ? user.email : null,
          phone: delivery.sms ? user.phone : null,
        },
      });
      return;
    }

    const tokenPair = await authService.login(schoolCode, identifier, password);
    res.status(200).json(tokenPair);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    if (process.env.LOGIN_DEBUG === 'true') {
      console.log('[LOGIN_DEBUG] failed', { identifier, code, requestId: req.id });
    }
    const status = errorCodeToStatus(code);
    res.status(status).json({
      error: code === 'ACCOUNT_LOCKED' ? 'Account is locked' : 'Invalid credentials',
      code,
      requestId: req.id,
    });
  }
});

function formatOtpDeliveryError(delivery: Awaited<ReturnType<typeof deliverOtp>>): string {
  const parts: string[] = [];
  if (delivery.smsError) parts.push(`SMS: ${delivery.smsError}`);
  if (delivery.emailError) parts.push(`Email: ${delivery.emailError}`);
  let msg = parts.length > 0 ? parts.join('. ') : 'Could not send verification code.';
  if (delivery.sandbox) {
    msg +=
      ' In sandbox mode, add your phone at account.africastalking.com → SMS → phone numbers, then try again.';
  } else if (!isEmailConfigured()) {
    msg += ' Ensure your account has a valid phone number and SMS balance is available.';
  }
  return msg;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `***${digits.slice(-4)}`;
}

/**
 * POST /api/v1/auth/resend-login-otp
 * Resend login OTP using an existing challenge (no password re-entry).
 */
authRouter.post('/resend-login-otp', otpResendRateLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!isOtpLoginEnabled()) {
    res.status(404).json({ error: 'OTP login is disabled', code: 'NOT_ENABLED', requestId: req.id });
    return;
  }

  const parsed = resendLoginOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
      requestId: req.id,
    });
    return;
  }

  try {
    const userId = verifyOtpChallenge(parsed.data.otpChallenge, 'login');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(401).json({ error: 'Invalid verification session', code: 'INVALID_OTP_CHALLENGE', requestId: req.id });
      return;
    }

    if (!user.email && !user.phone) {
      res.status(400).json({
        error: 'No email or phone on file for OTP verification.',
        code: 'OTP_CONTACT_MISSING',
        requestId: req.id,
      });
      return;
    }

    if (!isEmailConfigured() && !isSmsConfigured()) {
      res.status(503).json({
        error: 'OTP login is enabled but email/SMS is not configured on the server.',
        code: 'OTP_NOT_CONFIGURED',
        requestId: req.id,
      });
      return;
    }

    await assertOtpResendAllowed(user.id, 'login');

    const code = await createOtp(user.id, 'login');
    const delivery = await deliverOtp(user, code, 'login');

    if (!delivery.email && !delivery.sms) {
      res.status(502).json({
        error: formatOtpDeliveryError(delivery),
        code: 'OTP_DELIVERY_FAILED',
        smsError: delivery.smsError,
        emailError: delivery.emailError,
        sandbox: delivery.sandbox,
        requestId: req.id,
      });
      return;
    }

    await recordOtpResend(user.id, 'login');
    const otpChallenge = createOtpChallenge(user.id, 'login');
    res.status(200).json({
      otpChallenge,
      delivery: {
        email: delivery.email ? user.email : null,
        phone: delivery.sms ? user.phone : null,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'OTP_RESEND_COOLDOWN') {
      const retryAfter = (err as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60;
      res.status(429).json({
        error: `Please wait ${retryAfter} seconds before requesting another code.`,
        code: 'OTP_RESEND_COOLDOWN',
        retryAfterSeconds: retryAfter,
        requestId: req.id,
      });
      return;
    }
    const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    res.status(401).json({
      error: 'Could not resend verification code',
      code: code === 'INVALID_OTP_CHALLENGE' ? 'INVALID_OTP_CHALLENGE' : code,
      requestId: req.id,
    });
  }
});

/**
 * POST /api/v1/auth/verify-otp
 * Step 2 of OTP login — verify code and receive JWT tokens.
 */
authRouter.post('/verify-otp', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
      requestId: req.id,
    });
    return;
  }

  try {
    const userId = verifyOtpChallenge(parsed.data.otpChallenge, 'login');
    const valid = await verifyOtp(userId, 'login', parsed.data.code);
    if (!valid) {
      res.status(401).json({
        error: 'Invalid or expired verification code',
        code: 'INVALID_OTP',
        requestId: req.id,
      });
      return;
    }

    const tokenPair = await authService.generateTokensForUser(userId);
    res.status(200).json(tokenPair);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    res.status(401).json({
      error: 'Verification failed',
      code: code === 'INVALID_OTP_CHALLENGE' ? 'INVALID_OTP_CHALLENGE' : code,
      requestId: req.id,
    });
  }
});

/**
 * POST /api/v1/auth/forgot-password-otp
 * Send a 6-digit reset code via email and/or SMS.
 */
authRouter.post('/forgot-password-otp', otpResendRateLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!isOtpPasswordResetEnabled()) {
    res.status(404).json({ error: 'OTP password reset is disabled', code: 'NOT_ENABLED' });
    return;
  }

  const parsed = forgotPasswordOtpSchema.safeParse(req.body);
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
    const school = await prisma.school.findUnique({ where: { schoolCode } });
    if (!school) {
      res.status(404).json({
        error: `No school found with code "${schoolCode}". Check the school code and try again.`,
        code: 'SCHOOL_NOT_FOUND',
        requestId: req.id,
      });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        schoolId: school.id,
        OR: identifierMatchConditions(identifier),
      },
    });

    if (!user) {
      res.status(404).json({
        error: 'No account found with that username, email, phone, or admission number in this school.',
        code: 'USER_NOT_FOUND',
        requestId: req.id,
      });
      return;
    }

    if (!user.phone && !user.email) {
      res.status(400).json({
        error: 'This account has no phone or email on file. Contact your school admin to add one.',
        code: 'NO_CONTACT_ON_FILE',
        requestId: req.id,
      });
      return;
    }

    if (!isEmailConfigured() && !user.phone) {
      res.status(400).json({
        error:
          'This account has no phone number on file. SMS reset codes require a phone — ask your school admin to add your number to your profile.',
        code: 'NO_PHONE_ON_FILE',
        requestId: req.id,
      });
      return;
    }

    if (!isEmailConfigured() && !isSmsConfigured()) {
      res.status(503).json({
        error: 'SMS and email are not configured on the server yet. Contact your school administrator.',
        code: 'OTP_NOT_CONFIGURED',
        requestId: req.id,
      });
      return;
    }

    try {
      await assertOtpResendAllowed(user.id, 'password_reset');
    } catch (cooldownErr) {
      const retryAfter = (cooldownErr as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 60;
      res.status(429).json({
        error: `Please wait ${retryAfter} seconds before requesting another code.`,
        code: 'OTP_RESEND_COOLDOWN',
        retryAfterSeconds: retryAfter,
        requestId: req.id,
      });
      return;
    }

    const code = await createOtp(user.id, 'password_reset');
    const delivery = await deliverOtp(user, code, 'password_reset');

    if (!delivery.email && !delivery.sms) {
      res.status(502).json({
        error: formatOtpDeliveryError(delivery),
        code: 'OTP_DELIVERY_FAILED',
        smsError: delivery.smsError,
        emailError: delivery.emailError,
        sandbox: delivery.sandbox,
        requestId: req.id,
      });
      return;
    }

    await recordOtpResend(user.id, 'password_reset');

    res.status(200).json({
      message: 'Verification code sent.',
      sentVia: {
        sms: delivery.sms,
        email: delivery.email,
      },
      maskedPhone: user.phone ? maskPhone(user.phone) : undefined,
      hint: delivery.sandbox
        ? 'Sandbox SMS only delivers to numbers registered at account.africastalking.com → SMS → phone numbers.'
        : !isEmailConfigured()
          ? 'Code sent by SMS to the phone number on your account.'
          : undefined,
    });
  } catch (err) {
    console.error('[Auth] Forgot password OTP error:', err);
    res.status(500).json({
      error: 'Failed to send verification code',
      code: 'INTERNAL_ERROR',
      requestId: req.id,
    });
  }
});

/**
 * POST /api/v1/auth/reset-password-otp
 * Reset password using OTP code instead of email link.
 */
authRouter.post('/reset-password-otp', async (req: Request, res: Response): Promise<void> => {
  const parsed = resetPasswordOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
      requestId: req.id,
    });
    return;
  }

  const { schoolCode, identifier, code, newPassword } = parsed.data;

  try {
    const school = await prisma.school.findUnique({ where: { schoolCode } });
    if (!school) {
      res.status(404).json({
        error: `No school found with code "${schoolCode}".`,
        code: 'SCHOOL_NOT_FOUND',
        requestId: req.id,
      });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        schoolId: school.id,
        OR: identifierMatchConditions(identifier),
      },
    });

    if (!user) {
      res.status(404).json({
        error: 'No account found with those details in this school.',
        code: 'USER_NOT_FOUND',
        requestId: req.id,
      });
      return;
    }

    const valid = await verifyOtp(user.id, 'password_reset', code);
    if (!valid) {
      res.status(400).json({ error: 'Invalid or expired verification code', code: 'INVALID_OTP', requestId: req.id });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[Auth] Reset password OTP error:', err);
    res.status(500).json({
      error: 'Failed to reset password',
      code: 'INTERNAL_ERROR',
      requestId: req.id,
    });
  }
});

/**
 * POST /api/v1/auth/refresh
 * Exchange a valid refresh token for a new token pair.
 * Requirements: 3.8
 */
authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
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
    const tokenPair = await authService.refresh(refreshToken);
    res.status(200).json(tokenPair);
  } catch (err) {
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
authRouter.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
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
    await authService.logout(userId, refreshToken);
    res.status(204).send();
  } catch (err) {
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
authRouter.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
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
    const school = await prisma.school.findUnique({ where: { schoolCode } });
    if (!school) {
      res.status(200).json({ message: 'If the account exists, a reset link has been sent.' });
      return;
    }

    // Find user by identifier within school
    const user = await prisma.user.findFirst({
      where: {
        schoolId: school.id,
        OR: identifierMatchConditions(identifier),
      },
    });

    if (!user) {
      res.status(200).json({ message: 'If the account exists, a reset link has been sent.' });
      return;
    }

    // Generate a secure reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store SHA-256 hash of the token — raw token is never stored
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    await prisma.user.update({
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
      await notificationService.sendEmail(
        user.email,
        'SAMS Password Reset',
        `
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
        `,
      );
    }

    // Send reset link via SMS if available (fire-and-forget — don't block response if AT is down)
    if (user.phone) {
      notificationService.sendSMS(
        user.phone,
        `SAMS Password Reset: Click this link to reset your password (expires in 1 hour): ${resetLink}`,
      ).catch(() => {});
    }

    res.status(200).json({ message: 'If the account exists, a reset link has been sent.' });
  } catch (err) {
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
authRouter.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
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
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with this token hash that hasn't expired
    const user = await prisma.user.findFirst({
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
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
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
authRouter.post('/webauthn/register/options', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const options = await webauthnService.generateRegistrationOptions(req.user.sub);
    res.status(200).json(options);
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
    } else {
      res.status(500).json({ error: 'Failed to generate registration options', code: 'INTERNAL_ERROR' });
    }
  }
});

/**
 * POST /api/v1/auth/webauthn/register/verify
 * Verify and store a WebAuthn credential registration.
 * Requires authentication.
 */
authRouter.post('/webauthn/register/verify', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { credentialId, publicKey, clientDataJSON, transports } = req.body;

  if (!credentialId || !publicKey || !clientDataJSON) {
    res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    const result = await webauthnService.verifyRegistration(
      req.user.sub,
      credentialId,
      publicKey,
      clientDataJSON,
      transports,
    );
    res.status(201).json(result);
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
    } else {
      res.status(500).json({ error: 'Failed to verify registration', code: 'INTERNAL_ERROR' });
    }
  }
});

/**
 * POST /api/v1/auth/webauthn/authenticate/options
 * Generate WebAuthn authentication options (no auth required — this is for login).
 */
authRouter.post('/webauthn/authenticate/options', async (req: Request, res: Response): Promise<void> => {
  try {
    const options = await webauthnService.generateAuthenticationOptions();
    res.status(200).json(options);
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
    } else {
      res.status(500).json({ error: 'Failed to generate authentication options', code: 'INTERNAL_ERROR' });
    }
  }
});

/**
 * POST /api/v1/auth/webauthn/authenticate/verify
 * Verify a WebAuthn authentication assertion and return JWT tokens.
 */
authRouter.post('/webauthn/authenticate/verify', async (req: Request, res: Response): Promise<void> => {
  const { credentialId, authenticatorData, clientDataJSON, signature } = req.body;

  if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
    res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    const { user } = await webauthnService.verifyAuthentication(
      credentialId,
      authenticatorData,
      clientDataJSON,
      signature,
    );

    // Generate JWT tokens for the authenticated user (same as password login)
    const tokenPair = await authService.generateTokensForUser(user.id);

    res.status(200).json({
      token: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      user,
    });
  } catch (err: any) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
    } else if (err.message === 'ACCOUNT_LOCKED') {
      res.status(401).json({ error: 'Account is locked', code: 'ACCOUNT_LOCKED' });
    } else {
      res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' });
    }
  }
});
