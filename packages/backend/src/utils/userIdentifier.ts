import { normalizeSmsPhone } from '../config/africasTalking';

type UserIdentifierCondition = {
  email?: { equals: string; mode: 'insensitive' };
  username?: { equals: string; mode: 'insensitive' };
  admissionNumber?: string;
  phone?: string;
};

/** Build OR conditions to match username, email, admission no., or phone variants. */
export function identifierMatchConditions(identifier: string): UserIdentifierCondition[] {
  const trimmed = identifier.trim();
  const conditions: UserIdentifierCondition[] = [
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
