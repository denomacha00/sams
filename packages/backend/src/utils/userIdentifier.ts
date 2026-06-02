import { normalizeSmsPhone } from '../config/africasTalking';

/** Build OR conditions to match username, email, admission no., or phone variants. */
export function identifierMatchConditions(identifier: string): Array<Record<string, string>> {
  const trimmed = identifier.trim();
  const conditions: Array<Record<string, string>> = [
    { email: trimmed },
    { admissionNumber: trimmed },
    { username: trimmed },
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

  // Deduplicate identical phone values
  const seen = new Set<string>();
  return conditions.filter((c) => {
    const val = Object.values(c)[0];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}
