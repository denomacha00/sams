import { UserRole } from '@sams/shared';
export interface CreateUserData {
    role: UserRole;
    fullName: string;
    email?: string;
    phone?: string;
    admissionNumber?: string;
    password: string;
    departmentId?: string;
    classId?: string;
}
export interface UpdateUserData {
    fullName?: string;
    email?: string;
    phone?: string;
    departmentId?: string;
    classId?: string;
    isLocked?: boolean;
}
export interface ListUsersFilters {
    role?: UserRole;
    departmentId?: string;
    classId?: string;
}
export declare class UserService {
    /**
     * Create a new user within a school.
     * If the role is STUDENT, checks the school's plan student limit first.
     * Hashes the password with bcrypt cost 12.
     * Returns the created user without the passwordHash field.
     *
     * Requirements: 4.1, 12.1, 12.6
     */
    createUser(schoolId: string, data: CreateUserData): Promise<Omit<{
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
        passwordHash: string;
        passwordResetToken: string | null;
        passwordResetExpires: Date | null;
        classId: string | null;
        isLocked: boolean;
        failedLoginCount: number;
        failedLoginWindowStart: Date | null;
        lastLoginAt: Date | null;
        avatarUrl: string | null;
    }, "passwordHash">>;
    /**
     * Update an existing user. Asserts school ownership before updating.
     * Returns the updated user without the passwordHash field.
     *
     * Requirements: 4.2
     */
    updateUser(schoolId: string, userId: string, data: UpdateUserData): Promise<Omit<{
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
        passwordHash: string;
        passwordResetToken: string | null;
        passwordResetExpires: Date | null;
        classId: string | null;
        isLocked: boolean;
        failedLoginCount: number;
        failedLoginWindowStart: Date | null;
        lastLoginAt: Date | null;
        avatarUrl: string | null;
    }, "passwordHash">>;
    /**
     * Delete a user. Asserts school ownership before deleting.
     *
     * Requirements: 4.3
     */
    deleteUser(schoolId: string, userId: string): Promise<void>;
    /**
     * List users scoped to a school with optional filters.
     * Excludes passwordHash from all returned records.
     *
     * Requirements: 4.4
     */
    listUsers(schoolId: string, filters?: ListUsersFilters): Promise<Omit<{
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
        passwordHash: string;
        passwordResetToken: string | null;
        passwordResetExpires: Date | null;
        classId: string | null;
        isLocked: boolean;
        failedLoginCount: number;
        failedLoginWindowStart: Date | null;
        lastLoginAt: Date | null;
        avatarUrl: string | null;
    }, "passwordHash">[]>;
    /**
     * Get a single user by ID. Asserts school ownership.
     * Returns the user without the passwordHash field.
     *
     * Requirements: 4.5
     */
    getUser(schoolId: string, userId: string): Promise<Omit<{
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
        passwordHash: string;
        passwordResetToken: string | null;
        passwordResetExpires: Date | null;
        classId: string | null;
        isLocked: boolean;
        failedLoginCount: number;
        failedLoginWindowStart: Date | null;
        lastLoginAt: Date | null;
        avatarUrl: string | null;
    }, "passwordHash">>;
}
export declare const userService: UserService;
//# sourceMappingURL=userService.d.ts.map