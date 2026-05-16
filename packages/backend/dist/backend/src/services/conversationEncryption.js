"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationEncryptionService = void 0;
const crypto_1 = __importDefault(require("crypto"));
// ─── Constants ────────────────────────────────────────────────────────────────
/** AES-256-GCM algorithm identifier */
const ALGORITHM = 'aes-256-gcm';
/** Standard IV length for GCM mode (12 bytes) */
const IV_LENGTH = 12;
/** Authentication tag length (16 bytes) */
const AUTH_TAG_LENGTH = 16;
/** HKDF salt for conversation encryption key derivation */
const HKDF_SALT = 'sams-conversation-encryption-v1';
// ─── ConversationEncryptionService ────────────────────────────────────────────
/**
 * Service for encrypting and decrypting conversation content using AES-256-GCM
 * with per-user derived keys. Mirrors the pattern in biometricEncryption.ts but
 * derives keys per-user instead of per-school.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
class ConversationEncryptionService {
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
    deriveUserKey(userId, masterKey) {
        const key = masterKey || process.env.CONVERSATION_MASTER_KEY;
        if (!key || key.length < 32) {
            throw new Error('CONVERSATION_MASTER_KEY must be at least 32 characters');
        }
        const salt = Buffer.from(HKDF_SALT, 'utf8');
        const info = Buffer.from(`user:${userId}`, 'utf8');
        // HKDF-Extract: PRK = HMAC-SHA256(salt, masterKey)
        const prk = crypto_1.default.createHmac('sha256', salt).update(key).digest();
        // HKDF-Expand: OKM = HMAC-SHA256(PRK, info || 0x01) truncated to 32 bytes
        const okm = crypto_1.default.createHmac('sha256', prk)
            .update(Buffer.concat([info, Buffer.from([0x01])]))
            .digest();
        return okm; // 32 bytes (SHA-256 output)
    }
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
    encrypt(plaintext, userId) {
        const key = this.deriveUserKey(userId);
        const iv = crypto_1.default.randomBytes(IV_LENGTH);
        const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv, {
            authTagLength: AUTH_TAG_LENGTH,
        });
        const plaintextBuffer = Buffer.from(plaintext, 'utf8');
        const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return { encryptedData: encrypted, iv, authTag };
    }
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
    decrypt(encrypted, userId) {
        const key = this.deriveUserKey(userId);
        return this.decryptWithKey(encrypted, key);
    }
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
    decryptWithFallback(encrypted, userId) {
        // Attempt 1: Current key
        try {
            const currentKey = this.deriveUserKey(userId, process.env.CONVERSATION_MASTER_KEY);
            const plaintext = this.decryptWithKey(encrypted, currentKey);
            return { plaintext, usedPreviousKey: false };
        }
        catch {
            // Current key failed — try previous key
        }
        // Attempt 2: Previous key (for rotation period)
        const previousMasterKey = process.env.CONVERSATION_MASTER_KEY_PREVIOUS;
        if (!previousMasterKey) {
            throw new Error('DECRYPTION_FAILED: Current key failed and no previous key configured');
        }
        try {
            const previousKey = this.deriveUserKey(userId, previousMasterKey);
            const plaintext = this.decryptWithKey(encrypted, previousKey);
            return { plaintext, usedPreviousKey: true };
        }
        catch {
            throw new Error('DECRYPTION_FAILED: Both current and previous keys failed');
        }
    }
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
    reEncrypt(encrypted, userId) {
        const { plaintext } = this.decryptWithFallback(encrypted, userId);
        return this.encrypt(plaintext, userId);
    }
    /**
     * Validate master key configuration at startup.
     *
     * Throws if CONVERSATION_MASTER_KEY is not set or contains fewer than 32 characters.
     *
     * Requirements: 2.5
     *
     * @throws Error if configuration is invalid
     */
    validateConfig() {
        const key = process.env.CONVERSATION_MASTER_KEY;
        if (!key) {
            throw new Error('CONVERSATION_MASTER_KEY environment variable is not set');
        }
        if (key.length < 32) {
            throw new Error('CONVERSATION_MASTER_KEY must be at least 32 characters');
        }
    }
    /**
     * Internal helper: decrypt with a specific derived key.
     */
    decryptWithKey(encrypted, key) {
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, encrypted.iv, {
            authTagLength: AUTH_TAG_LENGTH,
        });
        decipher.setAuthTag(encrypted.authTag);
        const decrypted = Buffer.concat([
            decipher.update(encrypted.encryptedData),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    }
}
// ─── Singleton Export ─────────────────────────────────────────────────────────
/** Singleton instance of ConversationEncryptionService */
exports.conversationEncryptionService = new ConversationEncryptionService();
exports.default = exports.conversationEncryptionService;
//# sourceMappingURL=conversationEncryption.js.map