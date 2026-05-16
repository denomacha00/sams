/**
 * Represents AES-256-GCM encrypted conversation data.
 * Requirements: 2.1, 2.3, 2.4
 */
export interface EncryptedConversationData {
    /** AES-256-GCM encrypted data */
    encryptedData: Buffer;
    /** 12-byte initialization vector */
    iv: Buffer;
    /** 16-byte authentication tag */
    authTag: Buffer;
}
/**
 * Service for encrypting and decrypting conversation content using AES-256-GCM
 * with per-user derived keys. Mirrors the pattern in biometricEncryption.ts but
 * derives keys per-user instead of per-school.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
declare class ConversationEncryptionService {
    /**
     * Derive a 32-byte AES key unique to a user using HKDF (SHA-256).
     *
     * Uses HKDF with:
     * - Salt: "sams-conversation-encryption-v1"
     * - Info: "user:{userId}"
     * - Master key: CONVERSATION_MASTER_KEY env var (or provided masterKey)
     *
     * Requirements: 2.2
     *
     * @param userId - The unique user identifier (CUID)
     * @param masterKey - Optional master key override (defaults to CONVERSATION_MASTER_KEY env var)
     * @returns A deterministic 32-byte Buffer suitable for AES-256-GCM
     * @throws Error if master key is missing or < 32 characters
     */
    deriveUserKey(userId: string, masterKey?: string): Buffer;
    /**
     * Encrypt plaintext message/response content using AES-256-GCM.
     *
     * Generates a cryptographically random 12-byte IV for each operation,
     * ensuring the same plaintext encrypted twice produces different ciphertext.
     *
     * Requirements: 2.1, 2.3, 2.4
     *
     * @param plaintext - The message or response content to encrypt
     * @param userId - The user ID used to derive the encryption key
     * @returns EncryptedConversationData containing encryptedData, iv, and authTag
     */
    encrypt(plaintext: string, userId: string): EncryptedConversationData;
    /**
     * Decrypt ciphertext back to plaintext string using AES-256-GCM.
     *
     * Verifies the authentication tag to ensure data integrity before
     * returning the decrypted content.
     *
     * Requirements: 2.6, 2.7
     *
     * @param encrypted - The encrypted data containing encryptedData, iv, and authTag
     * @param userId - The user ID used to derive the decryption key
     * @returns The original plaintext string
     * @throws Error if authentication tag verification fails (tampered data)
     */
    decrypt(encrypted: EncryptedConversationData, userId: string): string;
    /**
     * Attempt decryption with current key, falling back to previous key for rotation support.
     *
     * During key rotation, records encrypted with the old key can still be decrypted
     * using CONVERSATION_MASTER_KEY_PREVIOUS.
     *
     * Requirements: 7.1, 7.2, 7.5
     *
     * @param encrypted - The encrypted data to decrypt
     * @param userId - The user ID used to derive decryption keys
     * @returns Object with plaintext and whether the previous key was used
     * @throws Error if decryption fails with both current and previous keys
     */
    decryptWithFallback(encrypted: EncryptedConversationData, userId: string): {
        plaintext: string;
        usedPreviousKey: boolean;
    };
    /**
     * Re-encrypt a record with the current key (for key rotation).
     *
     * Decrypts using fallback (tries current then previous key), then
     * re-encrypts with the current CONVERSATION_MASTER_KEY.
     *
     * Requirements: 7.3
     *
     * @param encrypted - The encrypted data to re-encrypt
     * @param userId - The user ID for key derivation
     * @returns Newly encrypted data using the current key
     */
    reEncrypt(encrypted: EncryptedConversationData, userId: string): EncryptedConversationData;
    /**
     * Validate master key configuration at startup.
     *
     * Throws if CONVERSATION_MASTER_KEY is not set or contains fewer than 32 characters.
     *
     * Requirements: 2.5
     *
     * @throws Error if configuration is invalid
     */
    validateConfig(): void;
    /**
     * Internal helper: decrypt with a specific derived key.
     */
    private decryptWithKey;
}
/** Singleton instance of ConversationEncryptionService */
export declare const conversationEncryptionService: ConversationEncryptionService;
export default conversationEncryptionService;
//# sourceMappingURL=conversationEncryption.d.ts.map