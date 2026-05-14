import jwt from 'jsonwebtoken';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';
import { broadcastQRRefresh, broadcastSessionEnd } from '../sockets/attendanceSocket';

// ─── Constants ────────────────────────────────────────────────────────────────

const QR_SECRET = process.env.QR_SECRET ?? 'qr-secret-dev';
const QR_EXPIRY_SECONDS = 30;
const DEFAULT_LATE_THRESHOLD_MIN = 15;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface QRTokenPayload {
  sessionId: string;
  nonce: string;
  iat: number;
  exp: number;
}

// ─── Session Service ──────────────────────────────────────────────────────────

export class SessionService {
  /**
   * Start a new attendance session for a teacher.
   * Validates that the timetable entry belongs to the teacher, creates the
   * session with an initial QR token, and returns the session record.
   */
  async startSession(
    teacherId: string,
    schoolId: string,
    timetableEntryId: string,
    location: { lat: number; lng: number },
  ) {
    // Validate timetable entry belongs to teacher and school
    const timetableEntry = await prisma.timetableEntry.findFirst({
      where: {
        id: timetableEntryId,
        teacherId,
        schoolId,
      },
    });

    if (!timetableEntry) {
      throw new AppError(
        403,
        'TIMETABLE_NOT_FOUND',
        'Timetable entry not found or does not belong to this teacher',
      );
    }

    // Generate initial QR token
    const nonce = createId();
    const now = Math.floor(Date.now() / 1000);
    const sessionId = createId();

    const qrToken = jwt.sign(
      { sessionId, nonce, iat: now, exp: now + QR_EXPIRY_SECONDS },
      QR_SECRET,
    );

    // Create the attendance session
    const session = await prisma.attendanceSession.create({
      data: {
        id: sessionId,
        schoolId,
        classId: timetableEntry.classId,
        teacherId,
        timetableEntryId,
        subject: timetableEntry.subject,
        lateThresholdMin: DEFAULT_LATE_THRESHOLD_MIN,
        locationLat: location.lat,
        locationLng: location.lng,
        currentQRToken: qrToken,
        qrRefreshedAt: new Date(),
        isActive: true,
      },
    });

    return session;
  }

  /**
   * End an active attendance session.
   * Verifies the teacher owns the session before deactivating it.
   */
  async endSession(sessionId: string, teacherId: string): Promise<void> {
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    if (session.teacherId !== teacherId) {
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
      QR_SECRET,
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
