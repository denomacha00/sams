import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Represents an AES-256-GCM encrypted biometric descriptor template.
 * Requirements: 7.8, 19.3
 */
export interface EncryptedTemplate {
  /** AES-256-GCM encrypted data (Float32Array serialized to Buffer) */
  encryptedData: Buffer;
  /** 12-byte initialization vector */
  iv: Buffer;
  /** 16-byte authentication tag */
  authTag: Buffer;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** AES-256-GCM requires a 32-byte key */
const ALGORITHM = 'aes-256-gcm';
/** Standard IV length for GCM mode */
const IV_LENGTH = 12;
/** Authentication tag length */
const AUTH_TAG_LENGTH = 16;

// ─── Encryption Functions ─────────────────────────────────────────────────────

/**
 * Encrypt a biometric face descriptor using AES-256-GCM.
 *
 * Converts the Float32Array descriptor into a raw Buffer, generates a random
 * 12-byte IV, and encrypts using the provided school-specific 32-byte key.
 * Returns the encrypted data, IV, and authentication tag for storage.
 *
 * Requirements: 7.8, 19.3
 *
 * @param descriptor - The face descriptor as a Float32Array (typically 128 floats from face-api.js)
 * @param schoolKey - A 32-byte (256-bit) AES key specific to the school
 * @returns EncryptedTemplate containing encryptedData, iv, and authTag
 * @throws Error if the schoolKey is not exactly 32 bytes
 */
export function encryptDescriptor(
  descriptor: Float32Array,
  schoolKey: Buffer,
): EncryptedTemplate {
  if (schoolKey.length !== 32) {
    throw new Error('School key must be exactly 32 bytes for AES-256-GCM');
  }

  // Convert Float32Array to Buffer (raw bytes)
  const plaintext = Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);

  // Generate a random 12-byte IV
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher and encrypt
  const cipher = crypto.createCipheriv(ALGORITHM, schoolKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv,
    authTag,
  };
}

/**
 * Decrypt an AES-256-GCM encrypted biometric template back to a Float32Array.
 *
 * Verifies the authentication tag to ensure data integrity, then decrypts
 * the ciphertext and reconstructs the original Float32Array descriptor.
 *
 * Requirements: 7.8, 19.3
 *
 * @param template - The encrypted template containing encryptedData, iv, and authTag
 * @param schoolKey - The same 32-byte AES key used during encryption
 * @returns The original Float32Array face descriptor
 * @throws Error if the schoolKey is not 32 bytes or if authentication fails (tampered data)
 */
export function decryptDescriptor(
  template: EncryptedTemplate,
  schoolKey: Buffer,
): Float32Array {
  if (schoolKey.length !== 32) {
    throw new Error('School key must be exactly 32 bytes for AES-256-GCM');
  }

  // Create decipher with the same IV
  const decipher = crypto.createDecipheriv(ALGORITHM, schoolKey, template.iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // Set the authentication tag for verification
  decipher.setAuthTag(template.authTag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(template.encryptedData),
    decipher.final(),
  ]);

  // Reconstruct Float32Array from the decrypted buffer
  // Ensure proper alignment by copying into a new ArrayBuffer
  const arrayBuffer = new ArrayBuffer(decrypted.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(decrypted);

  return new Float32Array(arrayBuffer);
}

/**
 * Derive a 32-byte school-specific encryption key from the school ID and a master secret.
 *
 * Uses HKDF (HMAC-based Key Derivation Function) with SHA-256 to derive a
 * deterministic key from the school's ID and the BIOMETRIC_MASTER_KEY env variable.
 * This ensures each school has a unique encryption key without storing separate keys.
 *
 * @param schoolId - The unique school identifier
 * @returns A 32-byte Buffer suitable for AES-256-GCM
 * @throws Error if BIOMETRIC_MASTER_KEY environment variable is not set
 */
export function deriveSchoolKey(schoolId: string): Buffer {
  const masterKey = process.env.BIOMETRIC_MASTER_KEY;
  if (!masterKey) {
    throw new Error('BIOMETRIC_MASTER_KEY environment variable is not set');
  }

  // Use HKDF to derive a school-specific key
  // Salt: fixed application-specific value
  // Info: school ID for domain separation
  const salt = Buffer.from('sams-biometric-encryption-v1', 'utf8');
  const info = Buffer.from(`school:${schoolId}`, 'utf8');

  // HKDF-Extract: PRK = HMAC-SHA256(salt, masterKey)
  const prk = crypto.createHmac('sha256', salt).update(masterKey).digest();

  // HKDF-Expand: OKM = HMAC-SHA256(PRK, info || 0x01) truncated to 32 bytes
  const okm = crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([0x01])]))
    .digest();

  return okm;
}
