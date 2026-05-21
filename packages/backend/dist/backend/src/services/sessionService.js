"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionService = exports.SessionService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cuid2_1 = require("@paralleldrive/cuid2");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
const attendanceSocket_1 = require("../sockets/attendanceSocket");
// ─── Constants ────────────────────────────────────────────────────────────────
const QR_SECRET = process.env.QR_SECRET ?? 'qr-secret-dev';
const QR_EXPIRY_SECONDS = 30;
const DEFAULT_LATE_THRESHOLD_MIN = 15;
// ─── Session Service ──────────────────────────────────────────────────────────
class SessionService {
    /**
     * Start a new attendance session for a teacher.
     * Validates that the timetable entry belongs to the teacher and that the
     * current time falls within the scheduled slot (±30 min tolerance).
     * Creates the session with an initial QR token and returns the session record.
     *
     * Requirements: 17.3
     */
    async startSession(teacherId, schoolId, timetableEntryId, location) {
        // Validate timetable entry belongs to teacher and school
        const timetableEntry = await index_1.prisma.timetableEntry.findFirst({
            where: {
                id: timetableEntryId,
                teacherId,
                schoolId,
            },
        });
        if (!timetableEntry) {
            throw new errors_1.AppError(403, 'TIMETABLE_NOT_FOUND', 'Timetable entry not found or does not belong to this teacher');
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
            throw new errors_1.AppError(400, 'WRONG_DAY', `This class is scheduled for ${dayNames[timetableEntry.dayOfWeek]}, not today`);
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
            throw new errors_1.AppError(400, 'OUTSIDE_SCHEDULED_TIME', `Session can only be started within 30 minutes of the scheduled time (${timetableEntry.startTime}–${timetableEntry.endTime})`);
        }
        // Check if there's already an active session for this timetable entry today
        const existingSession = await index_1.prisma.attendanceSession.findFirst({
            where: {
                timetableEntryId,
                isActive: true,
            },
        });
        if (existingSession) {
            throw new errors_1.AppError(409, 'SESSION_ALREADY_ACTIVE', 'An active session already exists for this timetable entry');
        }
        // Generate initial QR token
        const nonce = (0, cuid2_1.createId)();
        const nowUnix = Math.floor(Date.now() / 1000);
        const sessionId = (0, cuid2_1.createId)();
        const qrToken = jsonwebtoken_1.default.sign({ sessionId, nonce, iat: nowUnix, exp: nowUnix + QR_EXPIRY_SECONDS }, QR_SECRET);
        // Create the attendance session
        const session = await index_1.prisma.attendanceSession.create({
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
    async endSession(sessionId, teacherId) {
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new errors_1.AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
        }
        if (session.teacherId !== teacherId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'You do not own this session');
        }
        if (!session.isActive) {
            throw new errors_1.AppError(400, 'SESSION_ENDED', 'Session is already ended');
        }
        await index_1.prisma.attendanceSession.update({
            where: { id: sessionId },
            data: {
                isActive: false,
                endedAt: new Date(),
            },
        });
        // Broadcast session ended to session room
        (0, attendanceSocket_1.broadcastSessionEnd)(sessionId);
    }
    /**
     * Generate a new QR code JWT for a session.
     * Returns the signed token string.
     */
    generateQRCode(sessionId) {
        const nonce = (0, cuid2_1.createId)();
        const now = Math.floor(Date.now() / 1000);
        const qrToken = jsonwebtoken_1.default.sign({ sessionId, nonce, iat: now, exp: now + QR_EXPIRY_SECONDS }, QR_SECRET);
        return qrToken;
    }
    /**
     * Refresh the QR code for a session — generates a new token and persists it.
     */
    async refreshQRCode(sessionId) {
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new errors_1.AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
        }
        if (!session.isActive) {
            throw new errors_1.AppError(400, 'SESSION_ENDED', 'Cannot refresh QR for ended session');
        }
        const qrToken = this.generateQRCode(sessionId);
        await index_1.prisma.attendanceSession.update({
            where: { id: sessionId },
            data: {
                currentQRToken: qrToken,
                qrRefreshedAt: new Date(),
            },
        });
        // Broadcast QR refresh to subscribed clients
        (0, attendanceSocket_1.broadcastQRRefresh)(sessionId, qrToken);
        return qrToken;
    }
    /**
     * Get the current active QR token for a session, or null if session is
     * inactive or not found.
     */
    async getActiveQR(sessionId) {
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: sessionId },
            select: { currentQRToken: true, isActive: true },
        });
        if (!session || !session.isActive) {
            return null;
        }
        return session.currentQRToken;
    }
}
exports.SessionService = SessionService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.sessionService = new SessionService();
//# sourceMappingURL=sessionService.js.map