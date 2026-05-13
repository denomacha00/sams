import bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { prisma } from '../index';
import { licenseService } from './licenseService';
import { AppError } from '../middleware/errors';

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Strips the passwordHash field from a user record before returning to callers.
 */
function excludePasswordHash<T extends { passwordHash: string }>(
  user: T,
): Omit<T, 'passwordHash'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user;
  return rest;
}

// ─── User Service ─────────────────────────────────────────────────────────────

export class UserService {
  /**
   * Create a new user within a school.
   * If the role is STUDENT, checks the school's plan student limit first.
   * Hashes the password with bcrypt cost 12.
   * Returns the created user without the passwordHash field.
   *
   * Requirements: 4.1, 12.1, 12.6
   */
  async createUser(schoolId: string, data: CreateUserData) {
    // If creating a student, check the plan limit
    if (data.role === UserRole.STUDENT) {
      await licenseService.checkStudentLimit(schoolId);
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        schoolId,
        role: data.role,
        fullName: data.fullName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        admissionNumber: data.admissionNumber ?? null,
        passwordHash,
        departmentId: data.departmentId ?? null,
        classId: data.classId ?? null,
      },
    });

    return excludePasswordHash(user);
  }

  /**
   * Update an existing user. Asserts school ownership before updating.
   * Returns the updated user without the passwordHash field.
   *
   * Requirements: 4.2
   */
  async updateUser(schoolId: string, userId: string, data: UpdateUserData) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    if (user.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.departmentId !== undefined && { departmentId: data.departmentId }),
        ...(data.classId !== undefined && { classId: data.classId }),
        ...(data.isLocked !== undefined && { isLocked: data.isLocked }),
      },
    });

    return excludePasswordHash(updated);
  }

  /**
   * Delete a user. Asserts school ownership before deleting.
   *
   * Requirements: 4.3
   */
  async deleteUser(schoolId: string, userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    if (user.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    await prisma.user.delete({ where: { id: userId } });
  }

  /**
   * List users scoped to a school with optional filters.
   * Excludes passwordHash from all returned records.
   *
   * Requirements: 4.4
   */
  async listUsers(schoolId: string, filters?: ListUsersFilters) {
    const where: Record<string, unknown> = { schoolId };

    if (filters?.role) {
      where.role = filters.role;
    }
    if (filters?.departmentId) {
      where.departmentId = filters.departmentId;
    }
    if (filters?.classId) {
      where.classId = filters.classId;
    }

    const users = await prisma.user.findMany({ where });

    return users.map(excludePasswordHash);
  }

  /**
   * Get a single user by ID. Asserts school ownership.
   * Returns the user without the passwordHash field.
   *
   * Requirements: 4.5
   */
  async getUser(schoolId: string, userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    if (user.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    return excludePasswordHash(user);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const userService = new UserService();
