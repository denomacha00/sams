import { getAfricasTalkingConfig, isSmsConfigured, normalizeSmsPhone } from '../config/africasTalking';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { notificationService } from './notificationService';

/** Normalize Kenyan phone numbers to E.164 (+254...) for storage and SMS. */
export function preparePhoneForStorage(phone: string): string {
  return normalizeSmsPhone(phone.trim());
}

export function isWelcomeSmsEnabled(): boolean {
  return process.env.SMS_WELCOME_ON_REGISTER !== 'false';
}

/**
 * Send a welcome SMS when a user adds a phone number.
 * In production AT, this confirms the number works so OTP codes deliver immediately later.
 * Sandbox still requires numbers to be added in the AT dashboard (no public API for that).
 */
export function onboardPhoneForSms(phone: string, fullName?: string): void {
  if (!phone?.trim() || !isSmsConfigured() || !isWelcomeSmsEnabled()) return;

  let to: string;
  try {
    to = preparePhoneForStorage(phone);
  } catch {
    console.warn('[SMS] Invalid phone — skipped onboard SMS');
    return;
  }

  const cfg = getAfricasTalkingConfig();
  const name = fullName?.trim() || 'there';
  const message =
    cfg?.sandbox
      ? `SAMS: Hi ${name}, your number is registered. Verification codes will be sent here.`
      : `SAMS: Hi ${name}, your number is registered for verification codes and school alerts.`;

  void notificationService.sendSMSTest(to, message).then((result) => {
    if (result.ok) {
      console.log(`[SMS] Onboard SMS sent to ${to}`);
    } else {
      console.warn(`[SMS] Onboard SMS failed for ${to}:`, result.error);
    }
  });
}

/** Normalize phone if provided; returns null for empty input. */
export function optionalPhoneForStorage(phone?: string | null): string | null {
  if (!phone?.trim()) return null;
  return preparePhoneForStorage(phone);
}

/** One phone number per school (OTP/SMS). Skips when phone is empty. */
export async function assertPhoneAvailableInSchool(
  schoolId: string,
  phone: string | null | undefined,
  excludeUserId?: string,
): Promise<void> {
  if (!phone) return;

  const existing = await prisma.user.findFirst({
    where: {
      schoolId,
      phone,
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
  });

  if (existing) {
    throw new AppError(
      409,
      'DUPLICATE_PHONE',
      'This phone number is already registered in your school. Use a different number or contact your admin.',
    );
  }
}
