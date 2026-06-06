import bcrypt from 'bcrypt';
import { createId } from '@paralleldrive/cuid2';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { licenseService } from './licenseService';
import { AppError } from '../middleware/errors';
import { assertPhoneAvailableInSchool, onboardPhoneForSms, optionalPhoneForStorage } from './phoneOnboardingService';
import { buildRegistrationLinkUrl } from '../lib/registrationLinkUrl';
import { resolveTeacherManagedClassIds } from '../lib/teacherScope';

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
  targetRole?: 'TEACHER' | 'STUDENT' | 'HOD';
}

export interface RegisterViaLinkData {
  fullName: string;
  username: string;
  phone?: string;
  email?: string;
  password: string;
  admissionNumber?: string; // Required for students
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

    if (options && options.targetRole) {
      if (creatorRole === UserRole.SCHOOL_ADMIN) {
        if (![UserRole.HOD, UserRole.TEACHER, UserRole.STUDENT].includes(options.targetRole as UserRole)) {
          throw new AppError(400, 'INVALID_TARGET_ROLE', 'School admins can only generate links for HOD, TEACHER, or STUDENT roles');
        }
      } else if (creatorRole === UserRole.HOD) {
        if (options.targetRole !== UserRole.TEACHER && options.targetRole !== UserRole.STUDENT) {
          throw new AppError(400, 'INVALID_TARGET_ROLE', 'HOD can only generate links for TEACHER or STUDENT roles');
        }
      } else if (creatorRole === UserRole.TEACHER) {
        if (options.targetRole !== UserRole.STUDENT) {
          throw new AppError(400, 'INVALID_TARGET_ROLE', 'Teachers can only generate links for STUDENT registrations');
        }
      } else {
        throw new AppError(403, 'FORBIDDEN', 'Your role cannot generate registration links');
      }
      targetRole = options.targetRole as UserRole;
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

    if (creatorRole === UserRole.TEACHER) {
      const teacher = await prisma.user.findFirst({
        where: { id: creatorId, schoolId, role: UserRole.TEACHER },
        select: { classId: true, departmentId: true },
      });
      if (!teacher) {
        throw new AppError(403, 'FORBIDDEN', 'Teacher account not found');
      }
      departmentId = teacher.departmentId ?? departmentId;
      const managedClassIds = await resolveTeacherManagedClassIds(creatorId, teacher.classId);
      if (classId && !managedClassIds.includes(classId)) {
        throw new AppError(403, 'FORBIDDEN', 'Teachers can only generate student registration links for classes they manage');
      }
      if (!classId && managedClassIds.length === 1) {
        classId = managedClassIds[0];
      }
      if (!classId) {
        throw new AppError(400, 'CLASS_REQUIRED', 'Teachers must be assigned to a class before generating student registration links');
      }
    }

    if (creatorRole === UserRole.HOD && !departmentId) {
      throw new AppError(403, 'FORBIDDEN', 'HOD must be assigned to a department');
    }

    if (classId) {
      const classRecord = await prisma.class.findUnique({
        where: { id: classId },
        select: { schoolId: true, departmentId: true },
      });

      if (!classRecord || classRecord.schoolId !== schoolId) {
        throw new AppError(400, 'CLASS_REQUIRED', 'The specified class does not exist in your school');
      }

      if (departmentId && classRecord.departmentId !== departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'Class does not belong to the selected department');
      }

      departmentId = classRecord.departmentId;
    }

    if (departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: departmentId },
        select: { schoolId: true },
      });

      if (!department || department.schoolId !== schoolId) {
        throw new AppError(400, 'DEPARTMENT_REQUIRED', 'The specified department does not exist in your school');
      }
    }

    if (targetRole === UserRole.STUDENT && !classId) {
      throw new AppError(400, 'CLASS_REQUIRED', 'A class must be selected for student registration links');
    }

    // TEACHER and HOD links must have a department assignment.
    if ((targetRole === UserRole.TEACHER || targetRole === UserRole.HOD) && !departmentId) {
      throw new AppError(400, 'DEPARTMENT_REQUIRED', 'A department must be selected for staff registration links');
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
        departmentId: departmentId ?? null,
        classId: classId ?? null,
        targetRole,
        token,
        expiresAt,
        maxUses,
        useCount: 0,
        createdById: creatorId,
      },
    });

    return { ...link, url: buildRegistrationLinkUrl(token) };
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
   * Validates the link, checks for duplicate username/admission number,
   * hashes the password, creates the user, and increments the link's useCount.
   *
   * Requirements: 4.9
   */
  async registerViaLink(token: string, data: RegisterViaLinkData) {
    const { fullName, username, phone, email, password, admissionNumber } = data;

    // Validate the link
    const link = await this.resolveLink(token);

    // Check for duplicate username globally
    if (username) {
      const normalized = username.trim();
      const existingUsername = await prisma.user.findFirst({
        where: { username: { equals: normalized, mode: 'insensitive' } },
      });
      if (existingUsername) {
        throw new AppError(409, 'DUPLICATE_USERNAME', 'A user with this username already exists');
      }
    }

    // Check for duplicate admission number within the school (students)
    if (admissionNumber) {
      const existingUser = await prisma.user.findFirst({
        where: {
          schoolId: link.schoolId,
          admissionNumber,
        },
      });

      if (existingUser) {
        throw new AppError(409, 'DUPLICATE_ADMISSION', 'A user with this admission number already exists');
      }
    }

    // If registering a student, check the plan limit
    if (link.targetRole === UserRole.STUDENT) {
      await licenseService.checkStudentLimit(link.schoolId);
    }

    if (link.classId) {
      const classRecord = await prisma.class.findUnique({
        where: { id: link.classId },
        select: { schoolId: true, departmentId: true },
      });
      if (!classRecord || classRecord.schoolId !== link.schoolId) {
        throw new AppError(410, 'LINK_INVALID', 'This registration link is no longer valid. Please request a new link.');
      }
      if (link.departmentId && classRecord.departmentId !== link.departmentId) {
        throw new AppError(410, 'LINK_INVALID', 'This registration link is no longer valid. Please request a new link.');
      }
    }

    if (link.departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: link.departmentId },
        select: { schoolId: true },
      });
      if (!department || department.schoolId !== link.schoolId) {
        throw new AppError(410, 'LINK_INVALID', 'This registration link is no longer valid. Please request a new link.');
      }
    }

    if (link.targetRole === UserRole.STUDENT && !link.classId) {
      throw new AppError(400, 'CLASS_REQUIRED', 'This registration link is missing class information. Please request a new link.');
    }

    if ((link.targetRole === UserRole.TEACHER || link.targetRole === UserRole.HOD) && !link.departmentId) {
      throw new AppError(400, 'DEPARTMENT_REQUIRED', 'This registration link is missing department information. Please request a new link.');
    }

    // Hash the provided password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const storedPhone = optionalPhoneForStorage(phone);
    await assertPhoneAvailableInSchool(link.schoolId, storedPhone);

    // Create the user
    const user = await prisma.user.create({
      data: {
        schoolId: link.schoolId,
        role: link.targetRole,
        fullName,
        username: username.trim(),
        phone: storedPhone,
        email: email ?? null,
        admissionNumber: admissionNumber ?? null,
        passwordHash,
        classId: link.classId ?? null,
        departmentId: (link as any).departmentId ?? null,
      },
    });

    if (storedPhone) {
      onboardPhoneForSms(storedPhone, fullName);
    }

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
  async getLinksForUser(userId: string, userRole: UserRole, schoolId: string) {
    let links;

    if (userRole === UserRole.SCHOOL_ADMIN) {
      links = await prisma.registrationLink.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
      });
    } else if (userRole === UserRole.HOD || userRole === UserRole.TEACHER) {
      links = await prisma.registrationLink.findMany({
        where: { schoolId, createdById: userId },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to access registration links');
    }

    // Enrich with department and class names
    const deptIds = [...new Set(links.map((l) => l.departmentId).filter(Boolean))] as string[];
    const classIds = [...new Set(links.map((l) => l.classId).filter(Boolean))] as string[];

    const [depts, classes] = await Promise.all([
      deptIds.length > 0
        ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
        : [],
      classIds.length > 0
        ? prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
        : [],
    ]);

    const deptMap = new Map<string, string>(depts.map((d) => [d.id, d.name] as [string, string]));
    const classMap = new Map<string, string>(classes.map((c) => [c.id, c.name] as [string, string]));

    return links.map((l) => ({
      ...l,
      departmentName: l.departmentId ? (deptMap.get(l.departmentId) ?? null) : null,
      className: l.classId ? (classMap.get(l.classId) ?? null) : null,
    }));
  }

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
  async deleteLink(
    linkId: string,
    requesterId: string,
    requesterRole: UserRole,
    schoolId: string,
  ): Promise<void> {
    // Find the link by id
    const link = await prisma.registrationLink.findUnique({
      where: { id: linkId },
    });

    // If not found or doesn't belong to the school, throw 404
    if (!link || link.schoolId !== schoolId) {
      throw new AppError(404, 'NOT_FOUND', 'Registration link not found');
    }

    // SCHOOL_ADMIN can delete any link in their school
    if (requesterRole === UserRole.SCHOOL_ADMIN) {
      await prisma.registrationLink.delete({ where: { id: linkId } });
      return;
    }

    // HOD and TEACHER can only delete links they created
    if (requesterRole === UserRole.HOD || requesterRole === UserRole.TEACHER) {
      if (link.createdById !== requesterId) {
        throw new AppError(403, 'FORBIDDEN', 'You can only delete links you created');
      }
      await prisma.registrationLink.delete({ where: { id: linkId } });
      return;
    }

    // Any other role is forbidden
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to delete registration links');
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
    const storedPhone = optionalPhoneForStorage(data.phone);
    await assertPhoneAvailableInSchool(schoolId, storedPhone);

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
        phone: storedPhone,
      },
    });

    if (storedPhone) {
      onboardPhoneForSms(storedPhone, data.fullName);
    }

    // Return user without passwordHash
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const registrationLinkService = new RegistrationLinkService();
