import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { redis } from '../index';
import { notificationService } from './notificationService';
import { isEmailConfigured } from '../config/email';
import { isSmsConfigured } from '../config/africasTalking';

export type OtpPurpose = 'login' | 'password_reset';

const OTP_LENGTH = Number(process.env.OTP_LENGTH ?? 6);
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 600);
const OTP_CHALLENGE_EXPIRY = '10m';

export function isOtpLoginEnabled(): boolean {
  return process.env.OTP_LOGIN_ENABLED === 'true';
}

export function isOtpPasswordResetEnabled(): boolean {
  return process.env.OTP_PASSWORD_RESET_ENABLED !== 'false';
}

function otpKey(userId: string, purpose: OtpPurpose): string {
  return `otp:${purpose}:${userId}`;
}

function generateCode(): string {
  const max = 10 ** OTP_LENGTH;
  const min = 10 ** (OTP_LENGTH - 1);
  return crypto.randomInt(min, max).toString();
}

export async function createOtp(userId: string, purpose: OtpPurpose): Promise<string> {
  const code = generateCode();
  await redis.setex(otpKey(userId, purpose), OTP_TTL_SECONDS, code);
  return code;
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

export async function deliverOtp(
  user: { id: string; email?: string | null; phone?: string | null; fullName?: string },
  code: string,
  context: 'login' | 'password_reset',
): Promise<{ email: boolean; sms: boolean }> {
  const name = user.fullName || 'there';
  const subject =
    context === 'login' ? 'Your SAMS login code' : 'Your SAMS password reset code';
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

  if (user.email && isEmailConfigured()) {
    const result = await notificationService.sendEmail(user.email, subject, html);
    emailSent = result.ok;
  }

  if (user.phone && isSmsConfigured()) {
    const result = await notificationService.sendSMSTest(user.phone, text);
    smsSent = result.ok;
  }

  return { email: emailSent, sms: smsSent };
}
