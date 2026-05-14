import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { encryptDescriptor, decryptDescriptor, deriveSchoolKey } from './biometricEncryption';

describe('biometricEncryption', () => {
  const schoolKey = crypto.randomBytes(32);

  describe('encryptDescriptor', () => {
    it('should encrypt a Float32Array descriptor and return EncryptedTemplate', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      const result = encryptDescriptor(descriptor, schoolKey);

      expect(result.encryptedData).toBeInstanceOf(Buffer);
      expect(result.iv).toBeInstanceOf(Buffer);
      expect(result.authTag).toBeInstanceOf(Buffer);
      expect(result.iv.length).toBe(12);
      expect(result.authTag.length).toBe(16);
    });

    it('should produce encrypted data different from the raw descriptor', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      const rawBuffer = Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
      const result = encryptDescriptor(descriptor, schoolKey);

      expect(result.encryptedData.equals(rawBuffer)).toBe(false);
    });

    it('should throw if school key is not 32 bytes', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3]);
      const shortKey = crypto.randomBytes(16);

      expect(() => encryptDescriptor(descriptor, shortKey)).toThrow(
        'School key must be exactly 32 bytes for AES-256-GCM',
      );
    });

    it('should produce different ciphertexts for the same input (random IV)', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      const result1 = encryptDescriptor(descriptor, schoolKey);
      const result2 = encryptDescriptor(descriptor, schoolKey);

      expect(result1.iv.equals(result2.iv)).toBe(false);
      expect(result1.encryptedData.equals(result2.encryptedData)).toBe(false);
    });
  });

  describe('decryptDescriptor', () => {
    it('should decrypt back to the original Float32Array', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      const encrypted = encryptDescriptor(descriptor, schoolKey);
      const decrypted = decryptDescriptor(encrypted, schoolKey);

      expect(decrypted.length).toBe(descriptor.length);
      for (let i = 0; i < descriptor.length; i++) {
        expect(decrypted[i]).toBeCloseTo(descriptor[i], 6);
      }
    });

    it('should handle a typical 128-element face descriptor', () => {
      const descriptor = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        descriptor[i] = Math.random() * 2 - 1; // values between -1 and 1
      }

      const encrypted = encryptDescriptor(descriptor, schoolKey);
      const decrypted = decryptDescriptor(encrypted, schoolKey);

      expect(decrypted.length).toBe(128);
      for (let i = 0; i < 128; i++) {
        expect(decrypted[i]).toBeCloseTo(descriptor[i], 6);
      }
    });

    it('should throw if school key is not 32 bytes', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3]);
      const encrypted = encryptDescriptor(descriptor, schoolKey);
      const shortKey = crypto.randomBytes(16);

      expect(() => decryptDescriptor(encrypted, shortKey)).toThrow(
        'School key must be exactly 32 bytes for AES-256-GCM',
      );
    });

    it('should throw if the auth tag is tampered with', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3]);
      const encrypted = encryptDescriptor(descriptor, schoolKey);

      // Tamper with the auth tag
      encrypted.authTag[0] ^= 0xff;

      expect(() => decryptDescriptor(encrypted, schoolKey)).toThrow();
    });

    it('should throw if the encrypted data is tampered with', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3]);
      const encrypted = encryptDescriptor(descriptor, schoolKey);

      // Tamper with the encrypted data
      encrypted.encryptedData[0] ^= 0xff;

      expect(() => decryptDescriptor(encrypted, schoolKey)).toThrow();
    });

    it('should throw if decrypted with a different key', () => {
      const descriptor = new Float32Array([0.1, 0.2, 0.3]);
      const encrypted = encryptDescriptor(descriptor, schoolKey);
      const wrongKey = crypto.randomBytes(32);

      expect(() => decryptDescriptor(encrypted, wrongKey)).toThrow();
    });
  });

  describe('deriveSchoolKey', () => {
    beforeAll(() => {
      process.env.BIOMETRIC_MASTER_KEY = 'test-master-key-for-unit-tests-only';
    });

    it('should derive a 32-byte key from a school ID', () => {
      const key = deriveSchoolKey('school-123');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should produce different keys for different school IDs', () => {
      const key1 = deriveSchoolKey('school-123');
      const key2 = deriveSchoolKey('school-456');
      expect(key1.equals(key2)).toBe(false);
    });

    it('should produce the same key for the same school ID (deterministic)', () => {
      const key1 = deriveSchoolKey('school-123');
      const key2 = deriveSchoolKey('school-123');
      expect(key1.equals(key2)).toBe(true);
    });

    it('should throw if BIOMETRIC_MASTER_KEY is not set', () => {
      const original = process.env.BIOMETRIC_MASTER_KEY;
      delete process.env.BIOMETRIC_MASTER_KEY;

      expect(() => deriveSchoolKey('school-123')).toThrow(
        'BIOMETRIC_MASTER_KEY environment variable is not set',
      );

      process.env.BIOMETRIC_MASTER_KEY = original;
    });
  });
});
