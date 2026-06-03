import bcrypt from 'bcrypt';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { licenseService } from './licenseService';
import { AppError } from '../middleware/errors';
import { assertPhoneAvailableInSchool, onboardPhoneForSms, optionalPhoneForStorage } from './phoneOnboardingService';

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateUserData {
  role: UserRole;
  fullName: string;
  username: string;
  email?: string;
  phone?: string;
  admissionNumber?: string;
  password: string;
  departmentId?: string;
  classId?: string;
}

export interface UpdateUserData {
  fullName?: string;
  username?: string;
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

    // Teachers and HODs must be assigned to a department
    if ((data.role === UserRole.TEACHER || data.role === UserRole.HOD) && !data.departmentId) {
      throw new AppError(400, 'DEPARTMENT_REQUIRED', 'Teachers and HODs must be assigned to a department');
    }

    const username = data.username.trim();
    const existingUsername = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    });
    if (existingUsername) {
      throw new AppError(409, 'DUPLICATE_USERNAME', 'A user with this username already exists');
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const phone = optionalPhoneForStorage(data.phone);
    await assertPhoneAvailableInSchool(schoolId, phone);

    const user = await prisma.user.create({
      data: {
        schoolId,
        role: data.role,
        fullName: data.fullName,
        username,
        email: data.email ?? null,
        phone,
        admissionNumber: data.admissionNumber ?? null,
        passwordHash,
        departmentId: data.departmentId || null,
        classId: data.classId || null,
      },
    });

    if (phone) {
      onboardPhoneForSms(phone, data.fullName);
    }

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

    if (data.username) {
      const username = data.username.trim();
      const taken = await prisma.user.findFirst({
        where: {
          username: { equals: username, mode: 'insensitive' },
          NOT: { id: userId },
        },
      });
      if (taken) {
        throw new AppError(409, 'DUPLICATE_USERNAME', 'A user with this username already exists');
      }
    }

    const phone = data.phone !== undefined ? optionalPhoneForStorage(data.phone) : undefined;
    if (phone !== undefined) {
      await assertPhoneAvailableInSchool(schoolId, phone, userId);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.username !== undefined && { username: data.username.trim() }),
        ...(data.email !== undefined && { email: data.email }),
        ...(phone !== undefined && { phone }),
        ...(data.departmentId !== undefined && { departmentId: data.departmentId }),
        ...(data.classId !== undefined && { classId: data.classId }),
        ...(data.isLocked !== undefined && { isLocked: data.isLocked }),
      },
    });

    if (phone && phone !== user.phone) {
      onboardPhoneForSms(phone, updated.fullName);
    }

    return excludePasswordHash(updated);
  }

  /**
   * Assign or remove class representative flag (students only).
   * At most one class rep per class when enabling.
   */
  async setClassRep(schoolId: string, studentId: string, isClassRep: boolean) {
    const user = await prisma.user.findUnique({ where: { id: studentId } });
    if (!user || user.schoolId !== schoolId) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    if (user.role !== UserRole.STUDENT) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Only students can be class representatives');
    }
    if (!user.classId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Student must be assigned to a class');
    }

    if (isClassRep) {
      await prisma.user.updateMany({
        where: {
          schoolId,
          classId: user.classId,
          role: UserRole.STUDENT,
          isClassRep: true,
          NOT: { id: studentId },
        },
        data: { isClassRep: false },
      });
    }

    const updated = await prisma.user.update({
      where: { id: studentId },
      data: { isClassRep },
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

    // Delete dependent records before deleting the user (foreign key constraints)
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.notification.updateMany({ where: { senderId: userId }, data: { senderId: null } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.attendanceRecord.deleteMany({ where: { studentId: userId } }),
      prisma.conversationRecord.deleteMany({ where: { thread: { userId } } }),
      prisma.conversationThread.deleteMany({ where: { userId } }),
    ]);

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
