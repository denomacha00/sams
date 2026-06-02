import type { Prisma } from '@prisma/client';
import { normalizeSmsPhone } from '../config/africasTalking';

/** Build OR conditions to match username, email, admission no., or phone variants. */
export function identifierMatchConditions(identifier: string): Prisma.UserWhereInput[] {
  const trimmed = identifier.trim();
  const conditions: Prisma.UserWhereInput[] = [
    { email: { equals: trimmed, mode: 'insensitive' } },
    { username: { equals: trimmed, mode: 'insensitive' } },
    { admissionNumber: trimmed },
    { phone: trimmed },
  ];

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 9) {
    const last9 = digits.slice(-9);
    conditions.push({ phone: `+254${last9}` });
    conditions.push({ phone: `254${last9}` });
    conditions.push({ phone: `0${last9}` });
    try {
      conditions.push({ phone: normalizeSmsPhone(trimmed) });
    } catch {
      // ignore normalization edge cases
    }
  }

  return conditions;
}
