"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAttendanceSocket = setupAttendanceSocket;
exports.broadcastAttendanceNew = broadcastAttendanceNew;
exports.broadcastAttendanceUpdated = broadcastAttendanceUpdated;
exports.broadcastAttendanceUpdate = broadcastAttendanceUpdate;
exports.broadcastQRRefresh = broadcastQRRefresh;
exports.broadcastSessionEnd = broadcastSessionEnd;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const shared_1 = require("@sams/shared");
// ─── Module-level reference to io ─────────────────────────────────────────────
let ioInstance = null;
// Redis event list TTL: 2 hours in seconds
const EVENT_TTL_SECONDS = 2 * 60 * 60;
// ─── Redis Helper ─────────────────────────────────────────────────────────────
/**
 * Get the Redis client from the main index module.
 * Lazy-loaded to avoid circular dependency issues at module load time.
 */
function getRedis() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { redis } = require('../index');
    return redis;
}
/**
 * Get the Prisma client from the main index module.
 */
function getPrisma() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma } = require('../index');
    return prisma;
}
// ─── Setup ────────────────────────────────────────────────────────────────────
/**
 * Initialize the attendance socket namespace.
 * Authenticates connections via handshake token and sets up event handlers.
 */
function setupAttendanceSocket(io) {
    ioInstance = io;
    const JWT_SECRET = process.env.JWT_SECRET ?? '';
    // Authentication middleware — verify JWT on connection
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            return next(new Error('Authentication required'));
        }
        try {
            const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            socket.user = payload;
            next();
        }
        catch {
            next(new Error('Invalid or expired token'));
        }
    });
    io.on('connection', (socket) => {
        const user = socket.user;
        if (!user)
            return;
        // Join school room for scoped broadcasts
        socket.join(`school:${user.schoolId}`);
        // ─── Handle session:join ────────────────────────────────────────────
        // Join a specific session room. Verifies the teacher owns the session
        // and replays missed events from Redis since `lastSeen` timestamp.
        socket.on('session:join', async (data) => {
            if (!data?.sessionId)
                return;
            try {
                const prisma = getPrisma();
                // Verify the session exists and belongs to the user's school
                const session = await prisma.attendanceSession.findFirst({
                    where: {
                        id: data.sessionId,
                        schoolId: user.schoolId,
                    },
                    select: { id: true, teacherId: true, schoolId: true },
                });
                if (!session) {
                    socket.emit('error', { message: 'Session not found' });
                    return;
                }
                // For teachers, verify they own the session
                if (user.role === shared_1.UserRole.TEACHER && session.teacherId !== user.sub) {
                    socket.emit('error', { message: 'You do not own this session' });
                    return;
                }
                // Join the session room
                socket.join(`session:${data.sessionId}`);
                // Replay missed events from Redis if lastSeen is provided
                if (data.lastSeen) {
                    await replayMissedEvents(socket, data.sessionId, data.lastSeen);
                }
            }
            catch (err) {
                console.error('[Socket] Error in session:join:', err);
                socket.emit('error', { message: 'Failed to join session' });
            }
        });
        // Handle session:leave
        socket.on('session:leave', (data) => {
            if (data?.sessionId) {
                socket.leave(`session:${data.sessionId}`);
            }
        });
        // ─── Handle qr:subscribe ────────────────────────────────────────────
        // Subscribe to QR refresh events for a session
        socket.on('qr:subscribe', (data) => {
            if (data?.sessionId) {
                socket.join(`qr:${data.sessionId}`);
            }
        });
        // Handle qr:unsubscribe
        socket.on('qr:unsubscribe', (data) => {
            if (data?.sessionId) {
                socket.leave(`qr:${data.sessionId}`);
            }
        });
        socket.on('disconnect', () => {
            // Cleanup handled automatically by socket.io
        });
    });
}
// ─── Event Replay ─────────────────────────────────────────────────────────────
/**
 * Replay missed attendance events from Redis for a session.
 * Events are stored as JSON strings in a Redis list keyed by `events:{sessionId}`.
 * Only events with a timestamp after `lastSeen` are replayed.
 */
async function replayMissedEvents(socket, sessionId, lastSeen) {
    try {
        const redis = getRedis();
        const key = `events:${sessionId}`;
        // Get all stored events for this session
        const events = await redis.lrange(key, 0, -1);
        if (!events || events.length === 0)
            return;
        for (const eventStr of events) {
            try {
                const event = JSON.parse(eventStr);
                // Only replay events that occurred after the client's lastSeen timestamp
                if (event.timestamp > lastSeen) {
                    socket.emit(event.type, event.record);
                }
            }
            catch {
                // Skip malformed events
            }
        }
    }
    catch (err) {
        console.error('[Socket] Error replaying missed events:', err);
    }
}
// ─── Redis Event Storage ──────────────────────────────────────────────────────
/**
 * Store an attendance event in Redis for later replay.
 * Events are stored in a list with a 2-hour TTL.
 */
async function storeEventInRedis(sessionId, event) {
    try {
        const redis = getRedis();
        const key = `events:${sessionId}`;
        await redis.rpush(key, JSON.stringify(event));
        // Reset TTL on every push to keep the list alive while the session is active
        await redis.expire(key, EVENT_TTL_SECONDS);
    }
    catch (err) {
        console.error('[Socket] Error storing event in Redis:', err);
    }
}
// ─── Broadcast Functions ──────────────────────────────────────────────────────
/**
 * Broadcast a new attendance record to all clients in a session room.
 * Also stores the event in Redis for replay on reconnection.
 */
function broadcastAttendanceNew(sessionId, record) {
    if (!ioInstance)
        return;
    const event = {
        type: 'attendance:new',
        sessionId,
        record,
        timestamp: Date.now(),
    };
    ioInstance.to(`session:${sessionId}`).emit('attendance:new', record);
    // Store in Redis for replay (fire-and-forget)
    void storeEventInRedis(sessionId, event);
}
/**
 * Broadcast an attendance record update to all clients in a session room.
 * Also stores the event in Redis for replay on reconnection.
 */
function broadcastAttendanceUpdated(sessionId, record) {
    if (!ioInstance)
        return;
    const event = {
        type: 'attendance:updated',
        sessionId,
        record,
        timestamp: Date.now(),
    };
    ioInstance.to(`session:${sessionId}`).emit('attendance:updated', record);
    // Store in Redis for replay (fire-and-forget)
    void storeEventInRedis(sessionId, event);
}
/**
 * Broadcast a new attendance record (alias for backward compatibility).
 * Use broadcastAttendanceNew or broadcastAttendanceUpdated for specific events.
 */
function broadcastAttendanceUpdate(sessionId, record) {
    broadcastAttendanceNew(sessionId, record);
}
/**
 * Broadcast a QR code refresh to all clients subscribed to a session's QR.
 */
function broadcastQRRefresh(sessionId, qrToken) {
    if (!ioInstance)
        return;
    ioInstance.to(`qr:${sessionId}`).emit('qr:refresh', { sessionId, qrToken });
}
/**
 * Broadcast session end to all clients in a session room.
 */
function broadcastSessionEnd(sessionId) {
    if (!ioInstance)
        return;
    ioInstance.to(`session:${sessionId}`).emit('session:ended', { sessionId });
}
//# sourceMappingURL=attendanceSocket.js.map