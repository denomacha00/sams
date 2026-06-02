import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { redis } from '../index';
import { notificationService } from './notificationService';
import { isEmailConfigured } from '../config/email';
import { isSmsConfigured, getAfricasTalkingConfig } from '../config/africasTalking';
import { preparePhoneForStorage } from './phoneOnboardingService';

export type OtpPurpose = 'login' | 'password_reset';

const OTP_LENGTH = Number(process.env.OTP_LENGTH ?? 6);
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 900);
const OTP_CHALLENGE_EXPIRY = '15m';
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60);

export function isOtpLoginEnabled(): boolean {
  return process.env.OTP_LOGIN_ENABLED === 'true';
}

export function isOtpPasswordResetEnabled(): boolean {
  return process.env.OTP_PASSWORD_RESET_ENABLED === 'true';
}

function otpKey(userId: string, purpose: OtpPurpose): string {
  return `otp:${purpose}:${userId}`;
}

function otpResendKey(userId: string, purpose: OtpPurpose): string {
  return `otp:resend:${purpose}:${userId}`;
}

function generateCode(): string {
  const max = 10 ** OTP_LENGTH;
  const min = 10 ** (OTP_LENGTH - 1);
  return crypto.randomInt(min, max).toString();
}

/** Issue a fresh code for this user + purpose; replaces any previous code for the same context. */
export async function createOtp(userId: string, purpose: OtpPurpose): Promise<string> {
  const code = generateCode();
  const key = otpKey(userId, purpose);
  await redis.del(key);
  await redis.setex(key, OTP_TTL_SECONDS, code);
  return code;
}

export async function assertOtpResendAllowed(userId: string, purpose: OtpPurpose): Promise<void> {
  const remaining = await redis.ttl(otpResendKey(userId, purpose));
  if (remaining > 0) {
    const err = new Error('OTP_RESEND_COOLDOWN') as Error & { retryAfterSeconds: number };
    err.retryAfterSeconds = remaining;
    throw err;
  }
}

export async function recordOtpResend(userId: string, purpose: OtpPurpose): Promise<void> {
  await redis.setex(otpResendKey(userId, purpose), OTP_RESEND_COOLDOWN_SECONDS, '1');
}

export async function verifyOtp(userId: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const stored = await redis.get(otpKey(userId, purpose));
  const normalized = code.trim().replace(/\s/g, '');
  if (!stored || stored !== normalized) return false;
  await redis.del(otpKey(userId, purpose));
  return true;
}

export function createOtpChallenge(userId: string, purpose: OtpPurpose): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign({ sub: userId, purpose: `otp_${purpose}` }, secret, { expiresIn: OTP_CHALLENGE_EXPIRY });
}

export function verifyOtpChallenge(token: string, expectedPurpose: OtpPurpose): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  const payload = jwt.verify(token, secret) as { sub: string; purpose: string };
  if (payload.purpose !== `otp_${expectedPurpose}`) {
    throw new Error('INVALID_OTP_CHALLENGE');
  }
  return payload.sub;
}

export interface OtpDeliveryResult {
  email: boolean;
  sms: boolean;
  emailError?: string;
  smsError?: string;
  sandbox: boolean;
}

export async function deliverOtp(
  user: { id: string; email?: string | null; phone?: string | null; fullName?: string },
  code: string,
  context: 'login' | 'password_reset',
): Promise<OtpDeliveryResult> {
  const name = user.fullName || 'there';
  const subject =
    context === 'login' ? 'Your SAMS login code' : 'Your SAMS password reset code';
  const smsText =
    context === 'login'
      ? `SAMS login code: ${code}. Expires in ${Math.floor(OTP_TTL_SECONDS / 60)} min. Do not share.`
      : `SAMS reset code: ${code}. Expires in ${Math.floor(OTP_TTL_SECONDS / 60)} min. Ignore if you did not request this.`;
  const text =
    context === 'login'
      ? `Hi ${name}, your SAMS login verification code is ${code}. It expires in ${Math.floor(OTP_TTL_SECONDS / 60)} minutes. Do not share this code.`
      : `Hi ${name}, your SAMS password reset code is ${code}. It expires in ${Math.floor(OTP_TTL_SECONDS / 60)} minutes. If you did not request this, ignore this message.`;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#4f46e5;">${subject}</h2>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#111;">${code}</p>
      <p style="color:#666;font-size:14px;">This code expires in ${Math.floor(OTP_TTL_SECONDS / 60)} minutes.</p>
      <p style="color:#999;font-size:12px;">If you did not request this, you can safely ignore this email.</p>
    </div>`;

  let emailSent = false;
  let smsSent = false;
  let emailError: string | undefined;
  let smsError: string | undefined;
  const atCfg = getAfricasTalkingConfig();
  const sandbox = atCfg?.sandbox ?? false;

  if (user.email && isEmailConfigured()) {
    const result = await notificationService.sendEmail(user.email, subject, html);
    emailSent = result.ok;
    if (!result.ok) emailError = result.error;
  } else if (user.email && !isEmailConfigured()) {
    emailError = 'Email not configured on server';
  }

  if (user.phone && isSmsConfigured()) {
    const smsTo = preparePhoneForStorage(user.phone);
    const result = await notificationService.sendSMSTest(smsTo, smsText);
    smsSent = result.ok;
    if (!result.ok) {
      smsError = result.error;
      console.error(`[OTP] SMS failed for user ${user.id}:`, smsError);
    }
  } else if (user.phone && !isSmsConfigured()) {
    smsError = 'SMS not configured on server';
  } else if (!user.phone) {
    smsError = 'No phone number on your account';
  }

  return { email: emailSent, sms: smsSent, emailError, smsError, sandbox };
}
