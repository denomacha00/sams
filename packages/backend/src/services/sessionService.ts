import jwt from 'jsonwebtoken';
import { createId } from '@paralleldrive/cuid2';
import { UserRole } from '@sams/shared';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { getQrSecret } from '../config/secrets';
import { broadcastQRRefresh, broadcastSessionEnd } from '../sockets/attendanceSocket';
import { isTimetableWindowExpired } from '../lib/sessionWindow';

// ─── Constants ────────────────────────────────────────────────────────────────

const QR_EXPIRY_SECONDS = 30;
const DEFAULT_LATE_THRESHOLD_MIN = 15;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface QRTokenPayload {
  sessionId: string;
  nonce: string;
  iat: number;
  exp: number;
}

interface SessionActorOptions {
  actorRole?: UserRole;
  actorDepartmentId?: string;
}

// ─── Session Service ──────────────────────────────────────────────────────────

export class SessionService {
  /**
   * Start a new attendance session for a teacher.
   * Validates that the timetable entry belongs to the teacher and that the
   * current time falls within the scheduled slot (±30 min tolerance).
   * Creates the session with an initial QR token and returns the session record.
   *
   * Requirements: 17.3
   */
  async startSession(
    teacherId: string,
    schoolId: string,
    timetableEntryId: string,
    location: { lat: number; lng: number } | undefined,
    options: { requireGps?: boolean; locationRadiusM?: number } & SessionActorOptions = {},
  ) {
    const requireGps = options.requireGps ?? true;
    const locationRadiusM = options.locationRadiusM ?? 100;
    const actorRole = options.actorRole ?? UserRole.TEACHER;

    if (actorRole === UserRole.HOD && !options.actorDepartmentId) {
      throw new AppError(403, 'HOD_DEPARTMENT_REQUIRED', 'HOD account is not linked to a department');
    }

    // Validate timetable entry belongs to teacher and school
    const timetableEntry = await prisma.timetableEntry.findFirst({
      where: {
        id: timetableEntryId,
        schoolId,
        ...(actorRole === UserRole.HOD
          ? { class: { departmentId: options.actorDepartmentId } }
          : { teacherId }),
      },
    });

    if (!timetableEntry) {
      throw new AppError(
        403,
        'TIMETABLE_NOT_FOUND',
        actorRole === UserRole.HOD
          ? 'Timetable entry not found in your department'
          : 'Timetable entry not found or does not belong to this teacher',
      );
    }

    // Validate the current day matches the scheduled day of week
    // dayOfWeek: 0=Monday … 6=Sunday (matches JS getDay() adjusted: Sun=0 → 6, Mon=1 → 0)
    const now = new Date();
    // JS getDay(): 0=Sunday, 1=Monday … 6=Saturday
    // Our schema: 0=Monday … 6=Sunday
    const jsDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
    const schemaDayOfWeek = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1; // convert to 0=Mon … 6=Sun

    if (schemaDayOfWeek !== timetableEntry.dayOfWeek) {
      const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      throw new AppError(
        400,
        'WRONG_DAY',
        `This class is scheduled for ${dayNames[timetableEntry.dayOfWeek]}, not today`,
      );
    }

    // Validate the current time is within the scheduled slot (with ±30 min tolerance)
    const TOLERANCE_MINUTES = 30;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = timetableEntry.startTime.split(':').map(Number);
    const [endHour, endMin] = timetableEntry.endTime.split(':').map(Number);
    const scheduledStart = startHour * 60 + startMin;
    const scheduledEnd = endHour * 60 + endMin;

    const windowStart = scheduledStart - TOLERANCE_MINUTES;
    const windowEnd = scheduledEnd + TOLERANCE_MINUTES;

    if (currentMinutes < windowStart || currentMinutes > windowEnd) {
      throw new AppError(
        400,
        'OUTSIDE_SCHEDULED_TIME',
        `Session can only be started within 30 minutes of the scheduled time (${timetableEntry.startTime}–${timetableEntry.endTime})`,
      );
    }

    // Check if there's already an active session for this timetable entry today
    const existingSession = await prisma.attendanceSession.findFirst({
      where: {
        timetableEntryId,
        isActive: true,
      },
      include: { class: { select: { name: true, departmentId: true } } },
    });

    if (existingSession) {
      // Same teacher re-opening Sign In Students after refresh — resume instead of 409.
      const canResume =
        existingSession.teacherId === teacherId ||
        (
          actorRole === UserRole.HOD &&
          !!options.actorDepartmentId &&
          existingSession.class.departmentId === options.actorDepartmentId
        );
      if (canResume) {
        return existingSession;
      }
      throw new AppError(
        409,
        'SESSION_ALREADY_ACTIVE',
        'An active session already exists for this timetable entry',
      );
    }

    // Generate initial QR token
    const nonce = createId();
    const nowUnix = Math.floor(Date.now() / 1000);
    const sessionId = createId();

    const qrToken = jwt.sign(
      { sessionId, nonce, iat: nowUnix, exp: nowUnix + QR_EXPIRY_SECONDS },
      getQrSecret(),
    );

    // Create the attendance session
    const useLocation =
      requireGps &&
      location != null &&
      (location.lat !== 0 || location.lng !== 0);

    const session = await prisma.attendanceSession.create({
      data: {
        id: sessionId,
        schoolId,
        classId: timetableEntry.classId,
        teacherId,
        timetableEntryId,
        subject: timetableEntry.subject,
        lateThresholdMin: DEFAULT_LATE_THRESHOLD_MIN,
        locationLat: useLocation ? location!.lat : null,
        locationLng: useLocation ? location!.lng : null,
        locationRadiusM,
        currentQRToken: qrToken,
        qrRefreshedAt: new Date(),
        isActive: true,
      },
      include: { class: { select: { name: true } } },
    });

    return session;
  }

  /**
   * Close active sessions whose timetable window has passed.
   * This prevents old QR/link sessions from staying live if nobody taps End Session.
   */
  async expireStaleActiveSessions(schoolId?: string): Promise<number> {
    const sessions = await prisma.attendanceSession.findMany({
      where: {
        isActive: true,
        timetableEntryId: { not: null },
        ...(schoolId ? { schoolId } : {}),
      },
      select: {
        id: true,
        timetableEntry: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
      },
    });

    const expiredIds = sessions
      .filter((session) =>
        session.timetableEntry
          ? isTimetableWindowExpired(session.timetableEntry)
          : false,
      )
      .map((session) => session.id);

    if (expiredIds.length === 0) return 0;

    await prisma.attendanceSession.updateMany({
      where: { id: { in: expiredIds }, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    expiredIds.forEach((sessionId) => broadcastSessionEnd(sessionId));
    return expiredIds.length;
  }

  /**
   * End an active attendance session.
   * Verifies the teacher owns the session before deactivating it.
   */
  async endSession(
    sessionId: string,
    teacherId: string,
    actor: SessionActorOptions = {},
  ): Promise<void> {
    const actorRole = actor.actorRole ?? UserRole.TEACHER;
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: { select: { departmentId: true } } },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    const canEnd =
      session.teacherId === teacherId ||
      (
        actorRole === UserRole.HOD &&
        !!actor.actorDepartmentId &&
        session.class.departmentId === actor.actorDepartmentId
      );

    if (!canEnd) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this session');
    }

    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Session is already ended');
    }

    await prisma.attendanceSession.update({
      where: { id: sessionId },
      data: {
        isActive: false,
        endedAt: new Date(),
      },
    });

    // Broadcast session ended to session room
    broadcastSessionEnd(sessionId);
  }

  /**
   * Generate a new QR code JWT for a session.
   * Returns the signed token string.
   */
  generateQRCode(sessionId: string): string {
    const nonce = createId();
    const now = Math.floor(Date.now() / 1000);

    const qrToken = jwt.sign(
      { sessionId, nonce, iat: now, exp: now + QR_EXPIRY_SECONDS },
      getQrSecret(),
    );

    return qrToken;
  }

  /**
   * Refresh the QR code for a session — generates a new token and persists it.
   */
  async refreshQRCode(sessionId: string): Promise<string> {
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Cannot refresh QR for ended session');
    }

    const qrToken = this.generateQRCode(sessionId);

    await prisma.attendanceSession.update({
      where: { id: sessionId },
      data: {
        currentQRToken: qrToken,
        qrRefreshedAt: new Date(),
      },
    });

    // Broadcast QR refresh to subscribed clients
    broadcastQRRefresh(sessionId, qrToken);

    return qrToken;
  }

  /**
   * Get the current active QR token for a session, or null if session is
   * inactive or not found.
   */
  async getActiveQR(sessionId: string): Promise<string | null> {
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { currentQRToken: true, isActive: true },
    });

    if (!session || !session.isActive) {
      return null;
    }

    return session.currentQRToken;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const sessionService = new SessionService();
