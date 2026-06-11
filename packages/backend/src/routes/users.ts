import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { AVATARS_DIR, avatarPublicUrl } from '../config/uploads';
import multer from 'multer';
import sharp from 'sharp';
import { UserRole } from '@sams/shared';
import type { Prisma } from '@prisma/client';
import { requirePermission } from '../middleware/rbac';
import { userService } from '../services/userService';
import { registrationLinkService } from '../services/registrationLinkService';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { assertPhoneAvailableInSchool, onboardPhoneForSms, optionalPhoneForStorage } from '../services/phoneOnboardingService';
import { getLocalTimetableClock, minutesFromTime } from '../lib/sessionWindow';
import {
  resolveTeacherClassId,
  resolveTeacherManagedClassIds,
  resolveTeacherTeachingClassIds,
} from '../lib/teacherScope';

// ─── Avatar Upload Config ─────────────────────────────────────────────────────

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'INVALID_IMAGE', 'Only JPEG, PNG, WebP, or GIF images are allowed'));
    }
  },
});

function uploadAvatar(req: Request, res: Response, next: NextFunction): void {
  upload.single('avatar')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(413, 'FILE_TOO_LARGE', 'Profile picture must be 5MB or smaller'));
      return;
    }

    if (err instanceof AppError) {
      next(err);
      return;
    }

    next(new AppError(400, 'INVALID_IMAGE', 'Invalid profile picture upload'));
  });
}

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createUserSchema = z.object({
  role: z.nativeEnum(UserRole),
  fullName: z.string().min(1).max(200),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, and hyphens'),
  email: z.string().email().optional(),
  phone: z.string().min(9).max(15).optional(),
  admissionNumber: z.string().optional(),
  password: z.string().min(8),
  departmentId: z.string().optional(),
  classId: z.string().optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, underscores, and hyphens').optional(),
  email: z.string().email().optional(),
  phone: z.string().min(9).max(15).optional(),
  departmentId: z.string().optional(),
  classId: z.string().optional(),
  isLocked: z.boolean().optional(),
  attendanceGpsExempt: z.boolean().optional(),
});

const generateLinkSchema = z.object({
  classId: z.string().optional(),
  departmentId: z.string().optional(),
  expiryDays: z.number().int().min(7).max(365).optional(),
  maxUses: z.number().int().min(1).optional(),
  targetRole: z.enum(['TEACHER', 'STUDENT', 'HOD']).optional(),
});

const registerViaLinkSchema = z.object({
  fullName: z.string().min(1).max(200),
  username: z.string().min(3).max(50),
  phone: z.string().min(9).max(15).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8),
  admissionNumber: z.string().min(1).max(50).optional(),
});

const updateMeSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(9).max(15).optional(),
});

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function localDateKey(date: Date): string {
  const tz = process.env.APP_TIMEZONE || 'Africa/Nairobi';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isTodayLocal(date: Date, todayKey = localDateKey(new Date())): boolean {
  return localDateKey(date) === todayKey;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const usersRouter = Router();

/**
 * GET /api/v1/users/me
 * Get the authenticated user's own profile.
 */
usersRouter.get('/me', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
        schoolId: true,
        departmentId: true,
        classId: true,
        isClassRep: true,
        _count: { select: { webauthnCredentials: true } },
        biometricTemplate: { select: { id: true } },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const effectiveClassId =
      user.role === UserRole.TEACHER
        ? await resolveTeacherClassId(user.id, user.classId)
        : user.classId;

    const { _count, biometricTemplate, ...profile } = user;
    res.status(200).json({
      ...profile,
      classId: effectiveClassId,
      fingerprintRegistered: _count.webauthnCredentials > 0,
      bioEnrolled: !!biometricTemplate,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to get profile'));
  }
});

/**
 * PATCH /api/v1/users/me
 * Update the authenticated user's own profile.
 */
usersRouter.patch('/me', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    // If username is being changed, check uniqueness
    if (parsed.data.username) {
      const existing = await prisma.user.findUnique({
        where: { username: parsed.data.username },
      });
      if (existing && existing.id !== req.user.sub) {
        throw new AppError(400, 'USERNAME_TAKEN', 'This username is already taken');
      }
    }

    // Students cannot change their fullName (only admins/teachers can)
    const isStudent = req.user.role === 'STUDENT';

    const current = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { phone: true },
    });
    const phone = parsed.data.phone !== undefined ? optionalPhoneForStorage(parsed.data.phone) : undefined;
    if (phone !== undefined) {
      await assertPhoneAvailableInSchool(req.schoolId, phone, req.user.sub);
    }

    const updated = await prisma.user.update({
      where: { id: req.user.sub },
      data: {
        ...(parsed.data.username && { username: parsed.data.username }),
        ...(!isStudent && parsed.data.fullName && { fullName: parsed.data.fullName }),
        ...(parsed.data.email && { email: parsed.data.email }),
        ...(phone !== undefined && { phone }),
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
      },
    });

    if (phone && phone !== current?.phone) {
      onboardPhoneForSms(phone, updated.fullName);
    }

    res.status(200).json(updated);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to update profile'));
  }
});

/**
 * POST /api/v1/users/me/password
 * Change the authenticated user's password.
 */
usersRouter.post('/me/password', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const bcrypt = await import('bcrypt');
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.sub },
      data: { passwordHash: newHash },
    });

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to change password'));
  }
});

/**
 * POST /api/v1/users/me/avatar
 * Upload and resize profile picture (200x200 JPEG).
 */
usersRouter.post('/me/avatar', uploadAvatar, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'No image file provided');
    }

    // Ensure uploads directory exists
    if (!fs.existsSync(AVATARS_DIR)) {
      fs.mkdirSync(AVATARS_DIR, { recursive: true });
    }

    // Resize to 200x200 and convert to JPEG. Sharp verifies the actual file bytes,
    // so spoofed image MIME types fail here instead of being persisted.
    const filename = `${req.user.sub}.jpg`;
    const filepath = path.join(AVATARS_DIR, filename);

    await sharp(req.file.buffer, { failOn: 'error' })
      .rotate()
      .resize(200, 200, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 85 })
      .toFile(filepath);

    // Store a cache-busting URL so other signed-in devices pick up replacements
    // after /users/me refreshes, even though the avatar filename is stable.
    const avatarUrl = `${avatarPublicUrl(req.user.sub)}?v=${Date.now()}`;
    await prisma.user.update({
      where: { id: req.user.sub, schoolId: req.schoolId },
      data: { avatarUrl },
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ avatarUrl });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError(400, 'INVALID_IMAGE', 'Profile picture could not be processed'));
  }
});

/**
 * GET /api/v1/users
 * List users scoped to the authenticated user's school.
 * HOD scope guard automatically filters to their department.
 */
usersRouter.get('/', requirePermission('manage:users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rolesParam = typeof req.query.roles === 'string' ? req.query.roles : undefined;
    const parsedRoles = rolesParam
      ? rolesParam.split(',').map((r) => r.trim()).filter(Boolean) as UserRole[]
      : undefined;

    const filters: { role?: UserRole; roles?: UserRole[]; departmentId?: string; classId?: string } = {
      ...(parsedRoles?.length ? { roles: parsedRoles } : { role: req.query.role as UserRole | undefined }),
      departmentId: req.query.departmentId as string | undefined,
      classId: req.query.classId as string | undefined,
    };

    // HOD can only see users in their own department
    if (req.user.role === UserRole.HOD) {
      if (!req.user.departmentId) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }
      filters.departmentId = req.user.departmentId;
    }

    const users = await userService.listUsers(req.schoolId, filters);
    res.status(200).json(users);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to list users'));
  }
});

const classRepSchema = z.object({ isClassRep: z.boolean() });

/**
 * GET /api/v1/users/teaching-classes
 * Teacher-visible classes: class-teacher assignments plus timetable teaching assignments.
 */
usersRouter.get('/teaching-classes', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user.role !== UserRole.TEACHER) {
      throw new AppError(403, 'FORBIDDEN', 'Only teachers can view their teaching classes');
    }

    const classIds = await resolveTeacherTeachingClassIds(req.user.sub, req.user.classId);
    if (classIds.length === 0) {
      res.status(200).json([]);
      return;
    }

    const manageableClassIds = new Set(
      await resolveTeacherManagedClassIds(req.user.sub, req.user.classId),
    );
    const classes = await prisma.class.findMany({
      where: {
        schoolId: req.schoolId,
        id: { in: classIds },
      },
      select: {
        id: true,
        name: true,
        departmentId: true,
        classTeacherId: true,
      },
      orderBy: { name: 'asc' },
    });

    res.status(200).json(
      classes.map((cls) => ({
        id: cls.id,
        name: cls.name,
        departmentId: cls.departmentId,
        canManageClassRep: manageableClassIds.has(cls.id),
      })),
    );
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to load teaching classes'));
  }
});

/**
 * GET /api/v1/users/class-roster
 * Teachers: students in classes they teach. HOD: students in department (optional classId query).
 */
usersRouter.get('/class-roster', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const role = req.user.role;
    const where: Prisma.UserWhereInput = {
      schoolId: req.schoolId,
      role: UserRole.STUDENT,
    };
    let manageableClassIds = new Set<string>();

    if (role === UserRole.TEACHER) {
      const [teachingClassIds, managedClassIds] = await Promise.all([
        resolveTeacherTeachingClassIds(req.user.sub, req.user.classId),
        resolveTeacherManagedClassIds(req.user.sub, req.user.classId),
      ]);
      if (teachingClassIds.length === 0) {
        res.status(200).json([]);
        return;
      }
      where.classId = { in: teachingClassIds };
      manageableClassIds = new Set(managedClassIds);
    } else if (role === UserRole.HOD) {
      if (!req.user.departmentId) {
        res.status(200).json([]);
        return;
      }
      where.OR = [
        { departmentId: req.user.departmentId },
        { class: { departmentId: req.user.departmentId } },
      ];
      if (typeof req.query.classId === 'string') where.classId = req.query.classId;
    } else if (role === UserRole.SCHOOL_ADMIN) {
      if (typeof req.query.classId === 'string') where.classId = req.query.classId;
      if (typeof req.query.departmentId === 'string') {
        where.OR = [
          { departmentId: req.query.departmentId },
          { class: { departmentId: req.query.departmentId } },
        ];
      }
    } else {
      throw new AppError(403, 'FORBIDDEN', 'Only teachers, HODs, and school admins can view class roster');
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        phone: true,
        admissionNumber: true,
        classId: true,
        departmentId: true,
        isClassRep: true,
        isLocked: true,
        class: { select: { id: true, name: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    res.status(200).json(
      users.map((user) => ({
        ...user,
        className: user.class?.name ?? null,
        canManageClassRep: user.classId ? manageableClassIds.has(user.classId) : false,
      })),
    );
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to load class roster'));
  }
});

/**
 * GET /api/v1/users/student-workbench
 * Role-scoped student roster for everyday class work.
 * Teachers see classes they teach/manage, HODs see their department, admins see the school.
 */
usersRouter.get('/student-workbench', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const role = req.user.role;
    if (![UserRole.TEACHER, UserRole.HOD, UserRole.SCHOOL_ADMIN].includes(role)) {
      throw new AppError(403, 'FORBIDDEN', 'Only teachers, HODs, and school admins can view students');
    }

    const clock = getLocalTimetableClock();
    const todayKey = localDateKey(new Date());
    const requestedClassId = typeof req.query.classId === 'string' && req.query.classId.trim()
      ? req.query.classId.trim()
      : undefined;
    const requestedDepartmentId = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
      ? req.query.departmentId.trim()
      : undefined;

    const emptyResponse = () => ({
      scope: role,
      generatedAt: new Date().toISOString(),
      today: {
        dayOfWeek: clock.dayOfWeek,
        dayLabel: DAY_LABELS[clock.dayOfWeek] ?? 'Today',
        currentMinutes: clock.minutes,
      },
      totals: {
        departments: 0,
        classes: 0,
        students: 0,
        lessonsToday: 0,
        activeSessions: 0,
        presentToday: 0,
        absentToday: 0,
        notMarkedToday: 0,
      },
      departments: [],
    });

    const classWhere: Prisma.ClassWhereInput = { schoolId: req.schoolId };
    let managedClassIds = new Set<string>();

    if (role === UserRole.TEACHER) {
      const [teachingClassIds, teacherManagedClassIds] = await Promise.all([
        resolveTeacherTeachingClassIds(req.user.sub, req.user.classId),
        resolveTeacherManagedClassIds(req.user.sub, req.user.classId),
      ]);

      if (teachingClassIds.length === 0) {
        res.status(200).json(emptyResponse());
        return;
      }
      if (requestedClassId && !teachingClassIds.includes(requestedClassId)) {
        res.status(200).json(emptyResponse());
        return;
      }
      classWhere.id = requestedClassId ?? { in: teachingClassIds };
      managedClassIds = new Set(teacherManagedClassIds);
    } else if (role === UserRole.HOD) {
      if (!req.user.departmentId) {
        res.status(200).json(emptyResponse());
        return;
      }
      classWhere.departmentId = req.user.departmentId;
      if (requestedClassId) classWhere.id = requestedClassId;
    } else {
      if (requestedDepartmentId) classWhere.departmentId = requestedDepartmentId;
      if (requestedClassId) classWhere.id = requestedClassId;
    }

    const classes = await prisma.class.findMany({
      where: classWhere,
      select: {
        id: true,
        name: true,
        capacity: true,
        departmentId: true,
        classTeacherId: true,
        department: { select: { id: true, name: true } },
        classTeacher: { select: { id: true, fullName: true, email: true, phone: true } },
        users: {
          where: { role: UserRole.STUDENT },
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            phone: true,
            admissionNumber: true,
            avatarUrl: true,
            classId: true,
            departmentId: true,
            isClassRep: true,
            isLocked: true,
            attendanceGpsExempt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { fullName: 'asc' },
        },
        timetableEntries: {
          where: { dayOfWeek: clock.dayOfWeek },
          select: {
            id: true,
            subject: true,
            startTime: true,
            endTime: true,
            room: true,
            teacherId: true,
            teacher: { select: { id: true, fullName: true } },
          },
          orderBy: { startTime: 'asc' },
        },
      },
    });

    const sortedClasses = classes.sort((a, b) => {
      const deptCompare = (a.department?.name ?? '').localeCompare(b.department?.name ?? '');
      if (deptCompare !== 0) return deptCompare;
      return a.name.localeCompare(b.name);
    });

    const visibleClassIds = sortedClasses.map((cls) => cls.id);
    if (visibleClassIds.length === 0) {
      res.status(200).json(emptyResponse());
      return;
    }

    const activeSessions = await prisma.attendanceSession.findMany({
      where: {
        schoolId: req.schoolId,
        classId: { in: visibleClassIds },
        isActive: true,
      },
      select: {
        id: true,
        classId: true,
        timetableEntryId: true,
        subject: true,
        startedAt: true,
        _count: { select: { records: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    const studentIds = sortedClasses.flatMap((cls) => cls.users.map((student) => student.id));
    const recentAttendance = studentIds.length > 0
      ? await prisma.attendanceRecord.findMany({
          where: {
            schoolId: req.schoolId,
            studentId: { in: studentIds },
            scannedAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) },
            session: { classId: { in: visibleClassIds } },
          },
          select: {
            id: true,
            studentId: true,
            status: true,
            method: true,
            note: true,
            scannedAt: true,
            session: {
              select: {
                id: true,
                classId: true,
                subject: true,
                timetableEntryId: true,
                timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } },
              },
            },
          },
          orderBy: { scannedAt: 'desc' },
        })
      : [];

    const todayAttendance = recentAttendance.filter((record) => (
      isTodayLocal(record.scannedAt, todayKey) ||
      record.session.timetableEntry?.dayOfWeek === clock.dayOfWeek
    ));
    const recordsByStudent = new Map<string, typeof todayAttendance>();
    for (const record of todayAttendance) {
      const existing = recordsByStudent.get(record.studentId) ?? [];
      existing.push(record);
      recordsByStudent.set(record.studentId, existing);
    }

    const activeByEntry = new Map<string, (typeof activeSessions)[number]>();
    const activeByClass = new Map<string, (typeof activeSessions)>();
    for (const session of activeSessions) {
      if (session.timetableEntryId && !activeByEntry.has(session.timetableEntryId)) {
        activeByEntry.set(session.timetableEntryId, session);
      }
      const classSessions = activeByClass.get(session.classId) ?? [];
      classSessions.push(session);
      activeByClass.set(session.classId, classSessions);
    }

    let totalStudents = 0;
    let lessonsToday = 0;
    let presentToday = 0;
    let absentToday = 0;
    let notMarkedToday = 0;
    const departments = new Map<string, {
      id: string;
      name: string;
      classes: unknown[];
    }>();

    for (const cls of sortedClasses) {
      const canManageClass = role !== UserRole.TEACHER || managedClassIds.has(cls.id);
      const lessons = cls.timetableEntries
        .filter((entry) => role !== UserRole.TEACHER || canManageClass || entry.teacherId === req.user.sub)
        .map((entry) => {
          const start = minutesFromTime(entry.startTime);
          const end = minutesFromTime(entry.endTime);
          const active = activeByEntry.get(entry.id);
          return {
            id: entry.id,
            subject: entry.subject,
            startTime: entry.startTime,
            endTime: entry.endTime,
            room: entry.room,
            teacherId: entry.teacherId,
            teacherName: entry.teacher.fullName,
            isCurrent: Number.isFinite(start) && Number.isFinite(end) && clock.minutes >= start && clock.minutes <= end,
            isPast: Number.isFinite(end) && clock.minutes > end,
            activeSessionId: active?.id ?? null,
            activeRecordCount: active?._count.records ?? 0,
          };
        });
      lessonsToday += lessons.length;

      const activeClassSessions = activeByClass.get(cls.id) ?? [];
      const expectedMarks = lessons.length > 0 ? lessons.length : activeClassSessions.length;
      const students = cls.users.map((student) => {
        const records = recordsByStudent.get(student.id) ?? [];
        const sessionIds = new Set(records.map((record) => record.session.id));
        const statusCounts = records.reduce<Record<string, number>>((counts, record) => {
          counts[record.status] = (counts[record.status] ?? 0) + 1;
          return counts;
        }, {});
        const lastRecord = records[0];
        const notMarked = Math.max(expectedMarks - sessionIds.size, 0);

        if ((statusCounts.PRESENT ?? 0) + (statusCounts.LATE ?? 0) > 0) presentToday += 1;
        if ((statusCounts.ABSENT ?? 0) > 0) absentToday += 1;
        if (notMarked > 0) notMarkedToday += 1;

        return {
          id: student.id,
          fullName: student.fullName,
          username: student.username,
          email: student.email,
          phone: student.phone,
          admissionNumber: student.admissionNumber,
          avatarUrl: student.avatarUrl,
          classId: student.classId,
          departmentId: student.departmentId,
          isClassRep: student.isClassRep,
          isLocked: student.isLocked,
          attendanceGpsExempt: student.attendanceGpsExempt,
          joinedAt: student.createdAt,
          updatedAt: student.updatedAt,
          today: {
            present: statusCounts.PRESENT ?? 0,
            late: statusCounts.LATE ?? 0,
            excused: statusCounts.EXCUSED ?? 0,
            absent: statusCounts.ABSENT ?? 0,
            notMarked,
            lastStatus: lastRecord?.status ?? null,
            lastMethod: lastRecord?.method ?? null,
            lastNote: lastRecord?.note ?? null,
            lastSubject: lastRecord?.session.subject ?? null,
            lastMarkedAt: lastRecord?.scannedAt ?? null,
            records: records.map((record) => ({
              id: record.id,
              sessionId: record.session.id,
              subject: record.session.subject,
              status: record.status,
              method: record.method,
              note: record.note,
              scannedAt: record.scannedAt,
            })),
          },
        };
      });
      totalStudents += students.length;

      const departmentId = cls.department?.id ?? 'unassigned';
      const departmentName = cls.department?.name ?? 'Unassigned department';
      const department = departments.get(departmentId) ?? { id: departmentId, name: departmentName, classes: [] };
      department.classes.push({
        id: cls.id,
        name: cls.name,
        capacity: cls.capacity,
        departmentId: cls.departmentId,
        departmentName,
        classTeacherId: cls.classTeacherId,
        classTeacher: cls.classTeacher,
        canManageClass,
        studentCount: students.length,
        activeSessionCount: activeClassSessions.length,
        todayLessons: lessons,
        students,
      });
      departments.set(departmentId, department);
    }

    const departmentList = Array.from(departments.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.status(200).json({
      scope: role,
      generatedAt: new Date().toISOString(),
      today: {
        dayOfWeek: clock.dayOfWeek,
        dayLabel: DAY_LABELS[clock.dayOfWeek] ?? 'Today',
        currentMinutes: clock.minutes,
      },
      totals: {
        departments: departmentList.length,
        classes: sortedClasses.length,
        students: totalStudents,
        lessonsToday,
        activeSessions: activeSessions.length,
        presentToday,
        absentToday,
        notMarkedToday,
      },
      departments: departmentList,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to load student workbench'));
  }
});

/**
 * PATCH /api/v1/users/:id/class-rep
 * Assign class representative (one per class). Class teachers only.
 */
usersRouter.patch('/:id/class-rep', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = classRepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    if (req.user.role !== UserRole.TEACHER) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only the class teacher can assign or remove a class representative',
      );
    }

    const target = await userService.getUser(req.schoolId, req.params.id as string);
    const manageableClassIds = await resolveTeacherManagedClassIds(req.user.sub, req.user.classId);
    if (manageableClassIds.length === 0) {
      throw new AppError(403, 'FORBIDDEN', 'You must be assigned as class teacher for a class');
    }
    const targetClassId = (target as { classId?: string | null }).classId;
    if (!targetClassId || !manageableClassIds.includes(targetClassId)) {
      throw new AppError(403, 'FORBIDDEN', 'You can only assign class rep for students in your class');
    }

    const user = await userService.setClassRep(req.schoolId, req.params.id as string, parsed.data.isClassRep);
    res.status(200).json(user);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to update class rep'));
  }
});

/**
 * POST /api/v1/users
 * Create a new user within the school.
 * HOD can only create users in their own department.
 */
usersRouter.post('/', requirePermission('manage:users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    // HOD can only create users in their own department
    if (req.user.role === UserRole.HOD) {
      if (!req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HOD must be assigned to a department');
      }
      // HODs cannot create SCHOOL_ADMIN or other HODs
      if (parsed.data.role === UserRole.SCHOOL_ADMIN || parsed.data.role === UserRole.HOD) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only create TEACHER and STUDENT accounts');
      }
      if (parsed.data.departmentId && parsed.data.departmentId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only create users in their own department');
      }
      // Force departmentId to HOD's own department
      parsed.data.departmentId = req.user.departmentId;
    }

    const user = await userService.createUser(req.schoolId, parsed.data);
    res.status(201).json(user);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to create user'));
  }
});

/**
 * GET /api/v1/users/:id
 * Get a single user by ID.
 * Requires manage:users permission — prevents students/teachers from fetching arbitrary profiles.
 * HOD can only fetch users in their own department.
 */
usersRouter.get('/:id', requirePermission('manage:users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await userService.getUser(req.schoolId, req.params.id as string);

    // HOD can only view users in their own department
    if (req.user.role === UserRole.HOD) {
      if (!req.user.departmentId || (user as any).departmentId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only view users in their own department');
      }
    }

    res.status(200).json(user);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to get user'));
  }
});

/**
 * PUT /api/v1/users/:id
 * Update a user.
 * HOD can only update users in their own department.
 */
usersRouter.put('/:id', requirePermission('manage:users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    // HOD scope: verify the target user is in their department
    if (req.user.role === UserRole.HOD) {
      if (!req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HOD must be assigned to a department');
      }
      const targetUser = await userService.getUser(req.schoolId, req.params.id as string);
      if ((targetUser as any).departmentId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only update users in their own department');
      }
      // HOD cannot move a user to a different department
      if (parsed.data.departmentId && parsed.data.departmentId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs cannot move users to a different department');
      }
    }

    if (parsed.data.attendanceGpsExempt !== undefined) {
      const target = await userService.getUser(req.schoolId, req.params.id as string);
      if (target.role !== UserRole.STUDENT) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'GPS attendance permission applies to students only',
        );
      }
    }

    const user = await userService.updateUser(req.schoolId, req.params.id as string, parsed.data as Parameters<typeof userService.updateUser>[2]);
    res.status(200).json(user);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to update user'));
  }
});

/**
 * DELETE /api/v1/users/:id
 * Delete a user.
 * HOD can only delete users in their own department.
 */
usersRouter.delete('/:id', requirePermission('manage:users'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // HOD scope: verify the target user is in their department
    if (req.user.role === UserRole.HOD) {
      if (!req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HOD must be assigned to a department');
      }
      const targetUser = await userService.getUser(req.schoolId, req.params.id as string);
      if ((targetUser as any).departmentId !== req.user.departmentId) {
        throw new AppError(403, 'FORBIDDEN', 'HODs can only delete users in their own department');
      }
    }

    await userService.deleteUser(req.schoolId, req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to delete user'));
  }
});

// ─── Registration Links ───────────────────────────────────────────────────────

export const registrationLinksRouter = Router();

/**
 * GET /api/v1/registration-links
 * List registration links scoped by the user's role.
 * - SCHOOL_ADMIN sees all links for the school
 * - HOD sees only links they created
 * - Other roles get 403
 * - Unauthenticated requests get empty array (public access compatibility)
 */
registrationLinksRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  // This route is under PUBLIC_PATHS so req.user might not be set
  // If no user (public access), return empty
  if (!req.user || !req.schoolId) {
    res.json([]);
    return;
  }
  try {
    const links = await registrationLinkService.getLinksForUser(
      req.user.sub,
      req.user.role as any,
      req.schoolId,
    );
    res.json(links);
  } catch (err) {
    if (err instanceof AppError) throw err;
    res.json([]);
  }
});

/**
 * POST /api/v1/registration-links
 * Generate a registration link. Requires manage:users permission.
 */
registrationLinksRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Allow SCHOOL_ADMIN, HOD, and TEACHER to generate links
  const allowedRoles = ['SCHOOL_ADMIN', 'HOD', 'TEACHER'];
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }
  const parsed = generateLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    // Determine classId: use body classId, especially when targetRole is STUDENT
    const classId = parsed.data.classId || undefined;
    // Use body departmentId if provided (admin selecting dept for HOD), otherwise use creator's dept
    const departmentId = parsed.data.departmentId || req.user.departmentId;

    const link = await registrationLinkService.generateLink(
      req.user.sub,
      req.user.role,
      req.schoolId,
      departmentId,
      classId,
      {
        expiryDays: parsed.data.expiryDays,
        maxUses: parsed.data.maxUses,
        targetRole: parsed.data.targetRole,
      },
    );
    res.status(201).json(link);
  } catch (err) {
    console.error('[RegistrationLinks] Error:', err);
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to generate registration link'));
  }
});

/**
 * GET /api/v1/registration-links/:token
 * Resolve a registration link (public, no auth).
 */
registrationLinksRouter.get('/:token', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const link = await registrationLinkService.resolveLink(req.params.token as string);

    // Fetch school and class names for the frontend display
    const school = await prisma.school.findUnique({
      where: { id: link.schoolId },
      select: { name: true, schoolCode: true },
    });

    let className: string | undefined;
    let departmentName: string | undefined;

    if (link.classId) {
      const classRecord = await prisma.class.findUnique({
        where: { id: link.classId },
        select: { name: true, department: { select: { name: true } } },
      });
      className = classRecord?.name;
      departmentName = classRecord?.department?.name;
    } else if (link.departmentId) {
      const dept = await prisma.department.findUnique({
        where: { id: link.departmentId },
        select: { name: true },
      });
      departmentName = dept?.name ?? undefined;
    }

    res.status(200).json({
      ...link,
      schoolName: school?.name,
      schoolCode: school?.schoolCode,
      className,
      departmentName,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to resolve registration link'));
  }
});

/**
 * DELETE /api/v1/registration-links/:id
 * Delete a registration link with ownership check.
 * - SCHOOL_ADMIN can delete any link in their school
 * - HOD can only delete links they created
 * - Returns 403 if ownership check fails, 404 if not found
 */
registrationLinksRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user || !req.schoolId) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  try {
    await registrationLinkService.deleteLink(
      req.params.id as string,
      req.user.sub,
      req.user.role as any,
      req.schoolId,
    );
    res.status(204).send();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to delete registration link'));
  }
});

/**
 * POST /api/v1/registration-links/:token/register
 * Self-register via a registration link (public, no auth).
 */
registrationLinksRouter.post('/:token/register', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const parsed = registerViaLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const user = await registrationLinkService.registerViaLink(
      req.params.token as string,
      parsed.data,
    );
    res.status(201).json(user);
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Failed to register via link'));
  }
});
