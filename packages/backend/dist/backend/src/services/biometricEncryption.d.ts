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
export declare function encryptDescriptor(descriptor: Float32Array, schoolKey: Buffer): EncryptedTemplate;
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
export declare function decryptDescriptor(template: EncryptedTemplate, schoolKey: Buffer): Float32Array;
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
export declare function deriveSchoolKey(schoolId: string): Buffer;
//# sourceMappingURL=biometricEncryption.d.ts.map