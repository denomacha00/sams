import bcrypt from 'bcrypt';
import { createId } from '@paralleldrive/cuid2';
import { UserRole } from '@prisma/client';
import { prisma } from '../index';
import { licenseService } from './licenseService';
import { AppError } from '../middleware/errors';

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;
const DEFAULT_EXPIRY_DAYS = 30;
const MIN_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 365;
const DEFAULT_MAX_USES = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateLinkOptions {
  expiryDays?: number;
  maxUses?: number;
  targetRole?: string;
}

export interface RegisterViaLinkData {
  fullName: string;
  admissionNumber: string;
}

export interface AddStudentManuallyData {
  fullName: string;
  admissionNumber: string;
  password: string;
  email?: string;
  phone?: string;
}

// ─── Registration Link Service ────────────────────────────────────────────────

export class RegistrationLinkService {
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
  async generateLink(
    creatorId: string,
    creatorRole: UserRole,
    schoolId: string,
    departmentId?: string,
    classId?: string,
    options?: GenerateLinkOptions,
  ) {
    // Determine target role — use provided targetRole or derive from creator role
    let targetRole: UserRole;

    if (options && (options as any).targetRole) {
      targetRole = (options as any).targetRole as UserRole;
    } else {
      switch (creatorRole) {
        case UserRole.SCHOOL_ADMIN:
          targetRole = UserRole.HOD;
          break;
        case UserRole.HOD:
          targetRole = UserRole.TEACHER;
          break;
        case UserRole.TEACHER:
          targetRole = UserRole.STUDENT;
          break;
        default:
          throw new AppError(403, 'FORBIDDEN', 'Your role cannot generate registration links');
      }
    }

    // Clamp expiryDays
    let expiryDays = options?.expiryDays ?? DEFAULT_EXPIRY_DAYS;
    expiryDays = Math.max(MIN_EXPIRY_DAYS, Math.min(MAX_EXPIRY_DAYS, expiryDays));

    const maxUses = options?.maxUses ?? DEFAULT_MAX_USES;

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    // Generate unique token
    const token = createId();

    const link = await prisma.registrationLink.create({
      data: {
        schoolId,
        classId: (classId && classId.length > 10) ? classId : null,
        targetRole,
        token,
        expiresAt,
        maxUses,
        useCount: 0,
        createdById: creatorId,
      },
    });

    return link;
  }

  /**
   * Resolve a registration link by token.
   * Throws 404 if not found, 410 if expired or at max uses.
   *
   * Requirements: 4.8
   */
  async resolveLink(token: string) {
    const link = await prisma.registrationLink.findUnique({
      where: { token },
    });

    if (!link) {
      throw new AppError(404, 'LINK_NOT_FOUND', 'Registration link not found');
    }

    const now = new Date();

    if (link.expiresAt < now) {
      throw new AppError(410, 'LINK_EXPIRED', 'Registration link has expired');
    }

    if (link.useCount >= link.maxUses) {
      throw new AppError(410, 'LINK_EXHAUSTED', 'Registration link has reached maximum uses');
    }

    return link;
  }

  /**
   * Register a new user via a registration link.
   * Validates the link, checks for duplicate admission number (409 DUPLICATE_ADMISSION),
   * hashes the admissionNumber as the default password, creates the user,
   * and increments the link's useCount.
   *
   * Requirements: 4.9
   */
  async registerViaLink(token: string, fullName: string, admissionNumber: string) {
    // Validate the link
    const link = await this.resolveLink(token);

    // Check for duplicate admission number within the school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId: link.schoolId,
        admissionNumber,
      },
    });

    if (existingUser) {
      throw new AppError(409, 'DUPLICATE_ADMISSION', 'A user with this admission number already exists');
    }

    // If registering a student, check the plan limit
    if (link.targetRole === UserRole.STUDENT) {
      await licenseService.checkStudentLimit(link.schoolId);
    }

    // Hash admissionNumber as default password
    const passwordHash = await bcrypt.hash(admissionNumber, BCRYPT_ROUNDS);

    // Create the user
    const user = await prisma.user.create({
      data: {
        schoolId: link.schoolId,
        role: link.targetRole,
        fullName,
        admissionNumber,
        passwordHash,
        classId: link.classId ?? null,
        departmentId: null,
      },
    });

    // Increment useCount
    await prisma.registrationLink.update({
      where: { id: link.id },
      data: { useCount: { increment: 1 } },
    });

    // Return user without passwordHash
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * Manually add a student (used by teachers).
   * Checks for duplicate admission number, hashes password, creates Student user.
   *
   * Requirements: 4.9
   */
  async addStudentManually(
    teacherId: string,
    schoolId: string,
    departmentId: string,
    classId: string,
    data: AddStudentManuallyData,
  ) {
    // Check for duplicate admission number within the school
    const existingUser = await prisma.user.findFirst({
      where: {
        schoolId,
        admissionNumber: data.admissionNumber,
      },
    });

    if (existingUser) {
      throw new AppError(409, 'DUPLICATE_ADMISSION', 'A user with this admission number already exists');
    }

    // Check student limit
    await licenseService.checkStudentLimit(schoolId);

    // Hash the password
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    // Create the student
    const user = await prisma.user.create({
      data: {
        schoolId,
        role: UserRole.STUDENT,
        fullName: data.fullName,
        admissionNumber: data.admissionNumber,
        passwordHash,
        departmentId,
        classId,
        email: data.email ?? null,
        phone: data.phone ?? null,
      },
    });

    // Return user without passwordHash
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const registrationLinkService = new RegistrationLinkService();
