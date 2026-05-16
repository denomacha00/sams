import { UserRole } from '@sams/shared';
export interface GenerateLinkOptions {
    expiryDays?: number;
    maxUses?: number;
    targetRole?: 'TEACHER' | 'STUDENT';
}
export interface RegisterViaLinkData {
    fullName: string;
    username: string;
    phone?: string;
    password: string;
    admissionNumber?: string;
}
export interface AddStudentManuallyData {
    fullName: string;
    admissionNumber: string;
    password: string;
    email?: string;
    phone?: string;
}
export declare class RegistrationLinkService {
    /**
     * Generate a registration link based on the creator's role.
     *
     * - School Admin → targetRole = HOD, embed schoolId
     * - HOD → targetRole = TEACHER, embed schoolId + departmentId
     * - Teacher → targetRole = STUDENT, embed schoolId + departmentId + classId
     *
     * expiryDays defaults to 30 (clamped 7–365).
     * maxUses defaults to 100.
     * Token generated with createId().
     *
     * Requirements: 4.6, 4.7, 4.8
     */
    generateLink(creatorId: string, creatorRole: UserRole, schoolId: string, departmentId?: string, classId?: string, options?: GenerateLinkOptions): Promise<{
        id: string;
        schoolId: string;
        createdAt: Date;
        token: string;
        classId: string | null;
        expiresAt: Date;
        targetRole: import(".prisma/client").$Enums.UserRole;
        maxUses: number;
        useCount: number;
        createdById: string;
    }>;
    /**
     * Resolve a registration link by token.
     * Throws 404 if not found, 410 if expired or at max uses.
     *
     * Requirements: 4.8
     */
    resolveLink(token: string): Promise<{
        id: string;
        schoolId: string;
        createdAt: Date;
        token: string;
        classId: string | null;
        expiresAt: Date;
        targetRole: import(".prisma/client").$Enums.UserRole;
        maxUses: number;
        useCount: number;
        createdById: string;
    }>;
    /**
     * Register a new user via a registration link.
     * Validates the link, checks for duplicate username/admission number,
     * hashes the password, creates the user, and increments the link's useCount.
     *
     * Requirements: 4.9
     */
    registerViaLink(token: string, data: RegisterViaLinkData): Promise<{
        departmentId: string | null;
        id: string;
        schoolId: string;
        createdAt: Date;
        phone: string | null;
        updatedAt: Date;
        role: import(".prisma/client").$Enums.UserRole;
        fullName: string;
        username: string | null;
        email: string | null;
        admissionNumber: string | null;
        passwordResetToken: string | null;
        passwordResetExpires: Date | null;
        classId: string | null;
        isLocked: boolean;
        failedLoginCount: number;
        failedLoginWindowStart: Date | null;
        lastLoginAt: Date | null;
        avatarUrl: string | null;
    }>;
    /**
     * Get registration links scoped by the requesting user's role.
     *
     * - SCHOOL_ADMIN: returns all links for the school
     * - HOD: returns only links created by the HOD
     * - TEACHER: returns only links created by the teacher
     * - Others: throws 403 FORBIDDEN
     *
     * All results are sorted by createdAt descending.
     *
     * Requirements: 4.1, 4.3, 4.4
     */
    getLinksForUser(userId: string, userRole: UserRole, schoolId: string): Promise<{
        id: string;
        schoolId: string;
        createdAt: Date;
        token: string;
        classId: string | null;
        expiresAt: Date;
        targetRole: import(".prisma/client").$Enums.UserRole;
        maxUses: number;
        useCount: number;
        createdById: string;
    }[]>;
    /**
     * Delete a registration link with ownership-based access control.
     *
     * - SCHOOL_ADMIN can delete any link in their school
     * - HOD can only delete links they created (createdById === requesterId)
     * - TEACHER can only delete links they created (createdById === requesterId)
     * - Returns 404 if link not found or doesn't belong to the school
     * - Returns 403 if ownership check fails
     * - Deletion does NOT affect user accounts previously created via the link
     *
     * Requirements: 5.1, 5.2, 5.3, 5.5
     */
    deleteLink(linkId: string, requesterId: string, requesterRole: UserRole, schoolId: string): Promise<void>;
    /**
     * Manually add a student (used by teachers).
     * Checks for duplicate admission number, hashes password, creates Student user.
     *
     * Requirements: 4.9
     */
    addStudentManually(teacherId: string, schoolId: string, departmentId: string, classId: string, data: AddStudentManuallyData): Promise<{
        departmentId: string | null;
        id: string;
        schoolId: string;
        createdAt: Date;
        phone: string | null;
        updatedAt: Date;
        role: import(".prisma/client").$Enums.UserRole;
        fullName: string;
        username: string | null;
        email: string | null;
        admissionNumber: string | null;
        passwordResetToken: string | null;
        passwordResetExpires: Date | null;
        classId: string | null;
        isLocked: boolean;
        failedLoginCount: number;
        failedLoginWindowStart: Date | null;
        lastLoginAt: Date | null;
        avatarUrl: string | null;
    }>;
}
export declare const registrationLinkService: RegistrationLinkService;
//# sourceMappingURL=registrationLinkService.d.ts.map