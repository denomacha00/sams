import { LicensePayload } from '../types/index';
/**
 * Encodes a license payload into a dash-grouped uppercase key.
 * Each call produces a unique key due to a random nonce in the payload.
 *
 * @param payload - The license data to encode.
 * @param secret  - HMAC secret (keep server-side only).
 * @returns       A key in the form XXXX-YYYY-XXXX-XXXX (groups of 4).
 */
export declare function encodeLicenseKey(payload: LicensePayload, secret: string): string;
/**
 * Decodes a license key and verifies its HMAC checksum.
 *
 * @param key    - The dash-grouped key string.
 * @param secret - HMAC secret used during encoding.
 * @returns      The decoded payload, or `null` if the key is malformed or the
 *               HMAC does not match.
 */
export declare function decodeLicenseKey(key: string, secret: string): LicensePayload | null;
//# sourceMappingURL=licenseKey.d.ts.map