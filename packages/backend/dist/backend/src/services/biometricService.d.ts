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
export declare class BiometricService {
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
    enrollTemplate(studentId: string, schoolId: string, descriptor: Float32Array): Promise<void>;
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
    matchDescriptor(descriptor: Float32Array, classId: string, schoolId: string): Promise<BiometricMatch>;
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
    getEncryptedTemplates(classId: string, schoolId: string): Promise<StoredEncryptedTemplate[]>;
    /**
     * Compute the Euclidean distance between two Float32Array descriptors.
     * Used internally for biometric matching.
     */
    private euclideanDistance;
}
export declare const biometricService: BiometricService;
//# sourceMappingURL=biometricService.d.ts.map