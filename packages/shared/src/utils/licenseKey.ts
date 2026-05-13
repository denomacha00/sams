import { createHmac, randomBytes } from 'crypto';
import { PlanTier, LicensePayload } from '../types/index';

// ─── License Key Codec ────────────────────────────────────────────────────────
//
// Format: groups of 4 uppercase alphanumeric characters separated by dashes,
// e.g. ABCD-EFGH-IJKL-MNOP-QRST-UVWX (number of groups varies with payload size).
//
// Structure of the raw (dash-stripped) key:
//   [hex-encoded JSON payload][8-char hex HMAC-SHA256 checksum]
//
// The payload JSON is hex-encoded (0-9, A-F only) to avoid any character
// conflicts. The HMAC checksum is also hex (0-9, A-F). This means the entire
// key uses only uppercase hexadecimal characters, which are a strict subset of
// the allowed alphanumeric character set.
//
// Encoding steps:
//   1. Serialize payload as compact JSON: {n, p, e, r} (r = random nonce)
//   2. Hex-encode the JSON bytes (uppercase)
//   3. Compute HMAC-SHA256(hexPayload, secret), take first 8 hex chars (uppercase)
//   4. Concatenate hexPayload + hmac → rawToken
//   5. Pad to a multiple of 4 with '0' chars
//   6. Insert '-' every 4 characters
//
// Decoding steps:
//   1. Validate format: must match /^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/
//   2. Strip dashes → rawToken
//   3. Strip trailing '0' padding chars
//   4. Split: hexPayload = all but last 8 chars, hmac = last 8 chars
//   5. Recompute HMAC; return null on mismatch
//   6. Hex-decode and JSON.parse; return null on any error

const HMAC_LENGTH = 8; // hex chars (4 bytes)
const PAD_CHAR = '0';

/**
 * Encodes a license payload into a dash-grouped uppercase key.
 * Each call produces a unique key due to a random nonce in the payload.
 *
 * @param payload - The license data to encode.
 * @param secret  - HMAC secret (keep server-side only).
 * @returns       A key in the form XXXX-YYYY-XXXX-XXXX (groups of 4).
 */
export function encodeLicenseKey(payload: LicensePayload, secret: string): string {
  // Generate 8 random hex characters as a nonce for uniqueness
  const nonce = randomBytes(4).toString('hex').toUpperCase();

  const json = JSON.stringify({
    n: payload.schoolName.slice(0, 20),
    p: payload.planTier,
    e: Math.floor(payload.expiresAt.getTime() / 1000),
    r: nonce,
  });

  // Hex-encode the JSON (produces only 0-9, a-f characters)
  const hexPayload = Buffer.from(json, 'utf8').toString('hex').toUpperCase();

  // Compute HMAC over the hex payload
  const hmac = createHmac('sha256', secret)
    .update(hexPayload)
    .digest('hex')
    .slice(0, HMAC_LENGTH)
    .toUpperCase();

  // Combine payload and checksum
  const rawToken = hexPayload + hmac;

  // Pad to a multiple of 4 so groups are even
  const padded = rawToken.padEnd(Math.ceil(rawToken.length / 4) * 4, PAD_CHAR);

  // Insert dashes every 4 characters
  const groups: string[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    groups.push(padded.slice(i, i + 4));
  }

  return groups.join('-');
}

/**
 * Decodes a license key and verifies its HMAC checksum.
 *
 * @param key    - The dash-grouped key string.
 * @param secret - HMAC secret used during encoding.
 * @returns      The decoded payload, or `null` if the key is malformed or the
 *               HMAC does not match.
 */
export function decodeLicenseKey(key: string, secret: string): LicensePayload | null {
  // Validate format: one or more groups of exactly 4 uppercase alphanumeric chars
  if (!/^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/.test(key)) {
    return null;
  }

  const rawToken = key.replace(/-/g, '');

  // Strip trailing padding chars (they were added during encoding)
  const stripped = rawToken.replace(/0+$/, '');

  // Need at least HMAC_LENGTH + 2 chars (minimum 1-char hex payload is 2 hex chars)
  if (stripped.length <= HMAC_LENGTH) {
    return null;
  }

  const hexPayload = stripped.slice(0, stripped.length - HMAC_LENGTH);
  const providedHmac = stripped.slice(stripped.length - HMAC_LENGTH);

  // Verify HMAC
  const expectedHmac = createHmac('sha256', secret)
    .update(hexPayload)
    .digest('hex')
    .slice(0, HMAC_LENGTH)
    .toUpperCase();

  if (providedHmac !== expectedHmac) {
    return null;
  }

  // Hex-decode and parse JSON
  try {
    // Validate that hexPayload is valid hex (even length, only hex chars)
    if (hexPayload.length % 2 !== 0 || !/^[0-9A-F]+$/.test(hexPayload)) {
      return null;
    }

    const json = Buffer.from(hexPayload, 'hex').toString('utf8');
    const data = JSON.parse(json) as { n: string; p: string; e: number; r?: string };

    if (
      typeof data.n !== 'string' ||
      typeof data.p !== 'string' ||
      typeof data.e !== 'number'
    ) {
      return null;
    }

    // Validate planTier is a known value
    const validTiers = Object.values(PlanTier) as string[];
    if (!validTiers.includes(data.p)) {
      return null;
    }

    return {
      schoolName: data.n,
      planTier: data.p as PlanTier,
      expiresAt: new Date(data.e * 1000),
    };
  } catch {
    return null;
  }
}
