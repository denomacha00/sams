import { describe, it, expect } from 'vitest';
import { encodeLicenseKey, decodeLicenseKey } from './licenseKey';
import { PlanTier, LicensePayload } from '../types/index';

const TEST_SECRET = 'test-hmac-secret-key';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    schoolName: 'Nairobi High School',
    planTier: PlanTier.PROFESSIONAL,
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

// ─── encodeLicenseKey ─────────────────────────────────────────────────────────

describe('encodeLicenseKey', () => {
  it('returns a string matching the XXXX-YYYY-XXXX-XXXX pattern (groups of 4 uppercase alphanumeric chars)', () => {
    const key = encodeLicenseKey(makePayload(), TEST_SECRET);
    expect(key).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/);
  });

  it('produces a deterministic key for the same payload and secret', () => {
    const payload = makePayload();
    const key1 = encodeLicenseKey(payload, TEST_SECRET);
    const key2 = encodeLicenseKey(payload, TEST_SECRET);
    expect(key1).toBe(key2);
  });

  it('produces different keys for different secrets', () => {
    const payload = makePayload();
    const key1 = encodeLicenseKey(payload, 'secret-a');
    const key2 = encodeLicenseKey(payload, 'secret-b');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different plan tiers', () => {
    const keyTrial = encodeLicenseKey(makePayload({ planTier: PlanTier.TRIAL }), TEST_SECRET);
    const keyEnterprise = encodeLicenseKey(makePayload({ planTier: PlanTier.ENTERPRISE }), TEST_SECRET);
    expect(keyTrial).not.toBe(keyEnterprise);
  });

  it('truncates schoolName to 20 characters', () => {
    const longName = 'A'.repeat(30);
    const shortName = 'A'.repeat(20);
    const keyLong = encodeLicenseKey(makePayload({ schoolName: longName }), TEST_SECRET);
    const keyShort = encodeLicenseKey(makePayload({ schoolName: shortName }), TEST_SECRET);
    // Both should encode the same 20-char name
    expect(keyLong).toBe(keyShort);
  });

  it('encodes expiresAt as a Unix timestamp (second precision)', () => {
    // Two dates that differ only in milliseconds should produce the same key
    const date1 = new Date('2026-06-15T12:00:00.000Z');
    const date2 = new Date('2026-06-15T12:00:00.999Z');
    const key1 = encodeLicenseKey(makePayload({ expiresAt: date1 }), TEST_SECRET);
    const key2 = encodeLicenseKey(makePayload({ expiresAt: date2 }), TEST_SECRET);
    expect(key1).toBe(key2);
  });

  it('produces different keys for different expiry dates', () => {
    const key1 = encodeLicenseKey(makePayload({ expiresAt: new Date('2025-01-01') }), TEST_SECRET);
    const key2 = encodeLicenseKey(makePayload({ expiresAt: new Date('2027-01-01') }), TEST_SECRET);
    expect(key1).not.toBe(key2);
  });

  it('handles all four plan tiers without throwing', () => {
    for (const tier of Object.values(PlanTier)) {
      expect(() => encodeLicenseKey(makePayload({ planTier: tier }), TEST_SECRET)).not.toThrow();
    }
  });
});

// ─── decodeLicenseKey ─────────────────────────────────────────────────────────

describe('decodeLicenseKey', () => {
  it('round-trips: decoded payload matches original payload', () => {
    const payload = makePayload();
    const key = encodeLicenseKey(payload, TEST_SECRET);
    const decoded = decodeLicenseKey(key, TEST_SECRET);

    expect(decoded).not.toBeNull();
    expect(decoded!.schoolName).toBe(payload.schoolName);
    expect(decoded!.planTier).toBe(payload.planTier);
    // expiresAt is stored at second precision
    expect(decoded!.expiresAt.getTime()).toBe(
      Math.floor(payload.expiresAt.getTime() / 1000) * 1000,
    );
  });

  it('round-trips for all plan tiers', () => {
    for (const tier of Object.values(PlanTier)) {
      const payload = makePayload({ planTier: tier });
      const key = encodeLicenseKey(payload, TEST_SECRET);
      const decoded = decodeLicenseKey(key, TEST_SECRET);
      expect(decoded).not.toBeNull();
      expect(decoded!.planTier).toBe(tier);
    }
  });

  it('round-trips a school name with exactly 20 characters', () => {
    const name = 'KenyaHighSchool12345'; // exactly 20 chars
    const payload = makePayload({ schoolName: name });
    const key = encodeLicenseKey(payload, TEST_SECRET);
    const decoded = decodeLicenseKey(key, TEST_SECRET);
    expect(decoded!.schoolName).toBe(name);
  });

  it('returns null when the HMAC secret is wrong', () => {
    const key = encodeLicenseKey(makePayload(), TEST_SECRET);
    expect(decodeLicenseKey(key, 'wrong-secret')).toBeNull();
  });

  it('returns null for a completely arbitrary string', () => {
    expect(decodeLicenseKey('ABCD-EFGH-IJKL-MNOP', TEST_SECRET)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeLicenseKey('', TEST_SECRET)).toBeNull();
  });

  it('returns null for a key with lowercase characters', () => {
    const key = encodeLicenseKey(makePayload(), TEST_SECRET);
    expect(decodeLicenseKey(key.toLowerCase(), TEST_SECRET)).toBeNull();
  });

  it('returns null for a key with a tampered character', () => {
    const key = encodeLicenseKey(makePayload(), TEST_SECRET);
    // Flip one character in the first group
    const tampered = key[0] === 'A' ? 'B' + key.slice(1) : 'A' + key.slice(1);
    expect(decodeLicenseKey(tampered, TEST_SECRET)).toBeNull();
  });

  it('returns null for a key missing dashes', () => {
    const key = encodeLicenseKey(makePayload(), TEST_SECRET);
    expect(decodeLicenseKey(key.replace(/-/g, ''), TEST_SECRET)).toBeNull();
  });

  it('returns null for a key with groups of wrong length', () => {
    // 3-char groups instead of 4
    expect(decodeLicenseKey('ABC-DEF-GHI-JKL', TEST_SECRET)).toBeNull();
  });

  it('returns null for a key with special characters', () => {
    expect(decodeLicenseKey('ABCD-EF!H-IJKL-MNOP', TEST_SECRET)).toBeNull();
  });

  it('returns null for a key that is only padding characters', () => {
    expect(decodeLicenseKey('0000-0000-0000-0000', TEST_SECRET)).toBeNull();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('encodeLicenseKey / decodeLicenseKey edge cases', () => {
  it('handles a school name with special characters (truncated to 20)', () => {
    const name = "St. Mary's Int'l Sch"; // 20 chars with punctuation
    const payload = makePayload({ schoolName: name });
    const key = encodeLicenseKey(payload, TEST_SECRET);
    const decoded = decodeLicenseKey(key, TEST_SECRET);
    expect(decoded!.schoolName).toBe(name);
  });

  it('handles a school name with Unicode characters', () => {
    const name = 'Shule ya Nairobi 2025'; // 21 chars — will be truncated to 20
    const payload = makePayload({ schoolName: name });
    const key = encodeLicenseKey(payload, TEST_SECRET);
    const decoded = decodeLicenseKey(key, TEST_SECRET);
    expect(decoded!.schoolName).toBe(name.slice(0, 20));
  });

  it('handles a far-future expiry date', () => {
    const expiresAt = new Date('2099-06-15T12:00:00.000Z'); // mid-year to avoid timezone edge cases
    const payload = makePayload({ expiresAt });
    const key = encodeLicenseKey(payload, TEST_SECRET);
    const decoded = decodeLicenseKey(key, TEST_SECRET);
    expect(decoded).not.toBeNull();
    // Compare UTC full year to avoid local timezone issues
    expect(decoded!.expiresAt.getUTCFullYear()).toBe(2099);
  });

  it('handles a past expiry date (codec does not enforce expiry)', () => {
    const payload = makePayload({ expiresAt: new Date('2000-06-15T12:00:00.000Z') });
    const key = encodeLicenseKey(payload, TEST_SECRET);
    const decoded = decodeLicenseKey(key, TEST_SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded!.expiresAt.getUTCFullYear()).toBe(2000);
  });
});
