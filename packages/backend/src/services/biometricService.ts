import { prisma } from '../index';
import {
  encryptDescriptor,
  decryptDescriptor,
  deriveSchoolKey,
  type EncryptedTemplate,
} from './biometricEncryption';
import { AppError } from '../middleware/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BiometricMatch {
  studentId: string;
  confidence: number;
  matched: boolean;
}

export interface StoredEncryptedTemplate {
  id: string;
  studentId: string;
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum confidence threshold for a biometric match to be considered valid.
 * A Euclidean distance below this threshold (converted to confidence) is accepted.
 * Requirements: 7.5, 7.6
 */
const MATCH_DISTANCE_THRESHOLD = 0.6;

// ─── BiometricService ─────────────────────────────────────────────────────────

export class BiometricService {
  /**
   * Enroll a biometric template for a student.
   *
   * Encrypts the face descriptor using the school's derived key and stores
   * the encrypted template in the BiometricTemplate table. If a template
   * already exists for the student, it is updated (re-enrollment).
   *
   * Requirements: 7.4, 7.8
   *
   * @param studentId - The student's user ID
   * @param schoolId - The school ID (for key derivation and scoping)
   * @param descriptor - The face descriptor as a Float32Array
   */
  async enrollTemplate(
    studentId: string,
    schoolId: string,
    descriptor: Float32Array,
  ): Promise<void> {
    // Verify the student exists and belongs to this school
    const student = await prisma.user.findFirst({
      where: { id: studentId, schoolId, role: 'STUDENT' },
      select: { id: true },
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found in this school');
    }

    // Derive the school-specific encryption key
    const schoolKey = deriveSchoolKey(schoolId);

    // Encrypt the descriptor
    const encrypted = encryptDescriptor(descriptor, schoolKey);

    // Upsert the biometric template
    await prisma.biometricTemplate.upsert({
      where: { studentId },
      create: {
        schoolId,
        studentId,
        encryptedData: encrypted.encryptedData,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      update: {
        encryptedData: encrypted.encryptedData,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
    });
  }

  /**
   * Match a face descriptor against all enrolled templates in a class.
   *
   * Decrypts all templates for students in the given class, computes the
   * Euclidean distance between the input descriptor and each stored descriptor,
   * and returns the best match with a confidence score.
   *
   * Confidence is computed as: 1 - (distance / threshold)
   * A match is considered valid if distance < MATCH_DISTANCE_THRESHOLD.
   *
   * Requirements: 7.5, 7.6
   *
   * @param descriptor - The face descriptor to match
   * @param classId - The class to search within
   * @param schoolId - The school ID (for key derivation)
   * @returns BiometricMatch with studentId, confidence, and matched flag
   */
  async matchDescriptor(
    descriptor: Float32Array,
    classId: string,
    schoolId: string,
  ): Promise<BiometricMatch> {
    // Get all students in the class who have biometric templates
    const templates = await prisma.biometricTemplate.findMany({
      where: {
        schoolId,
        student: {
          classId,
        },
      },
      select: {
        studentId: true,
        encryptedData: true,
        iv: true,
        authTag: true,
      },
    });

    if (templates.length === 0) {
      throw new AppError(404, 'NO_TEMPLATES', 'No biometric templates found for this class');
    }

    // Derive the school-specific encryption key
    const schoolKey = deriveSchoolKey(schoolId);

    let bestMatch: { studentId: string; distance: number } | null = null;

    for (const template of templates) {
      // Decrypt the stored descriptor
      const encryptedTemplate: EncryptedTemplate = {
        encryptedData: Buffer.from(template.encryptedData),
        iv: Buffer.from(template.iv),
        authTag: Buffer.from(template.authTag),
      };

      let storedDescriptor: Float32Array;
      try {
        storedDescriptor = decryptDescriptor(encryptedTemplate, schoolKey);
      } catch {
        // Skip templates that fail to decrypt (corrupted data)
        continue;
      }

      // Compute Euclidean distance
      const distance = this.euclideanDistance(descriptor, storedDescriptor);

      if (bestMatch === null || distance < bestMatch.distance) {
        bestMatch = { studentId: template.studentId, distance };
      }
    }

    if (!bestMatch) {
      return { studentId: '', confidence: 0, matched: false };
    }

    // Convert distance to confidence score (0-1 range)
    // Lower distance = higher confidence
    const confidence = Math.max(0, 1 - bestMatch.distance / MATCH_DISTANCE_THRESHOLD);
    const matched = bestMatch.distance < MATCH_DISTANCE_THRESHOLD;

    return {
      studentId: bestMatch.studentId,
      confidence,
      matched,
    };
  }

  /**
   * Get encrypted templates for a class (for offline caching).
   *
   * Returns the raw encrypted templates without decryption so they can be
   * cached on the client device for offline biometric matching.
   *
   * Requirements: 7.4
   *
   * @param classId - The class to get templates for
   * @param schoolId - The school ID for scoping
   * @returns Array of encrypted templates with student IDs
   */
  async getEncryptedTemplates(
    classId: string,
    schoolId: string,
  ): Promise<StoredEncryptedTemplate[]> {
    const templates = await prisma.biometricTemplate.findMany({
      where: {
        schoolId,
        student: {
          classId,
        },
      },
      select: {
        id: true,
        studentId: true,
        encryptedData: true,
        iv: true,
        authTag: true,
      },
    });

    return templates.map((t) => ({
      id: t.id,
      studentId: t.studentId,
      encryptedData: Buffer.from(t.encryptedData),
      iv: Buffer.from(t.iv),
      authTag: Buffer.from(t.authTag),
    }));
  }

  /**
   * Compute the Euclidean distance between two Float32Array descriptors.
   * Used internally for biometric matching.
   */
  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      return Infinity;
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const biometricService = new BiometricService();
