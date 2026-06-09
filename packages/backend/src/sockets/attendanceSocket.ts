import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { type AccessTokenPayload, UserRole } from '@sams/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  user?: AccessTokenPayload;
}

interface AttendanceEvent {
  type: 'attendance:new' | 'attendance:updated';
  sessionId: string;
  record: unknown;
  timestamp: number;
}

// ─── Module-level reference to io ─────────────────────────────────────────────

let ioInstance: SocketIOServer | null = null;

// Redis event list TTL: 2 hours in seconds
const EVENT_TTL_SECONDS = 2 * 60 * 60;

// ─── Redis Helper ─────────────────────────────────────────────────────────────

function getRedis() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { redis } = require('../lib/redis') as typeof import('../lib/redis');
  return redis;
}

function getPrisma() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require('../lib/prisma') as typeof import('../lib/prisma');
  return prisma;
}

async function canAccessSessionRoom(
  user: AccessTokenPayload,
  sessionId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const prisma = getPrisma();
  const session = await prisma.attendanceSession.findFirst({
    where: {
      id: sessionId,
      schoolId: user.schoolId,
    },
    select: {
      id: true,
      teacherId: true,
      schoolId: true,
      class: { select: { departmentId: true } },
    },
  });

  if (!session) {
    return { ok: false, reason: 'Session not found' };
  }

  if (user.role === UserRole.STUDENT) {
    return { ok: false, reason: 'Students cannot join teacher session rooms' };
  }

  if (user.role === UserRole.TEACHER && session.teacherId !== user.sub) {
    return { ok: false, reason: 'You do not own this session' };
  }

  if (
    user.role === UserRole.HOD &&
    (!user.departmentId || session.class.departmentId !== user.departmentId)
  ) {
    return { ok: false, reason: 'Session is outside your department' };
  }

  return { ok: true };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Initialize the attendance socket namespace.
 * Authenticates connections via handshake token and sets up event handlers.
 */
export function setupAttendanceSocket(io: SocketIOServer): void {
  ioInstance = io;

  const JWT_SECRET = process.env.JWT_SECRET ?? '';

  // Authentication middleware — verify JWT on connection
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    if (!user) return;

    // Join school room for scoped broadcasts
    socket.join(`school:${user.schoolId}`);

    // Join personal user room so in-app notifications can be delivered
    // even when the user is not in a specific session room.
    socket.join(`user:${user.sub}`);

    // ─── Handle session:join ────────────────────────────────────────────
    // Join a specific session room. Verifies the teacher owns the session
    // and replays missed events from Redis since `lastSeen` timestamp.
    socket.on('session:join', async (data: { sessionId: string; lastSeen?: number }) => {
      if (!data?.sessionId) return;

      try {
        const access = await canAccessSessionRoom(user, data.sessionId);
        if (!access.ok) {
          socket.emit('error', { message: access.reason ?? 'You cannot join this session' });
          return;
        }

        // Join the session room
        socket.join(`session:${data.sessionId}`);

        // Replay missed events from Redis if lastSeen is provided
        if (data.lastSeen) {
          await replayMissedEvents(socket, data.sessionId, data.lastSeen);
        }
      } catch (err) {
        console.error('[Socket] Error in session:join:', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // Handle session:leave
    socket.on('session:leave', (data: { sessionId: string }) => {
      if (data?.sessionId) {
        socket.leave(`session:${data.sessionId}`);
      }
    });

    // ─── Handle qr:subscribe ────────────────────────────────────────────
    // Subscribe to QR refresh events for a session
    socket.on('qr:subscribe', async (data: { sessionId: string }) => {
      if (data?.sessionId) {
        const access = await canAccessSessionRoom(user, data.sessionId);
        if (!access.ok) {
          socket.emit('error', { message: access.reason ?? 'You cannot subscribe to this QR session' });
          return;
        }
        socket.join(`qr:${data.sessionId}`);
      }
    });

    // Handle qr:unsubscribe
    socket.on('qr:unsubscribe', (data: { sessionId: string }) => {
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
async function replayMissedEvents(
  socket: AuthenticatedSocket,
  sessionId: string,
  lastSeen: number,
): Promise<void> {
  try {
    const redis = getRedis();
    const key = `events:${sessionId}`;

    // Get all stored events for this session
    const events = await redis.lrange(key, 0, -1);

    if (!events || events.length === 0) return;

    for (const eventStr of events) {
      try {
        const event: AttendanceEvent = JSON.parse(eventStr);
        // Only replay events that occurred after the client's lastSeen timestamp
        if (event.timestamp > lastSeen) {
          socket.emit(event.type, event.record);
        }
      } catch {
        // Skip malformed events
      }
    }
  } catch (err) {
    console.error('[Socket] Error replaying missed events:', err);
  }
}

// ─── Redis Event Storage ──────────────────────────────────────────────────────

/**
 * Store an attendance event in Redis for later replay.
 * Events are stored in a list with a 2-hour TTL.
 */
async function storeEventInRedis(sessionId: string, event: AttendanceEvent): Promise<void> {
  try {
    const redis = getRedis();
    const key = `events:${sessionId}`;

    await redis.rpush(key, JSON.stringify(event));
    // Reset TTL on every push to keep the list alive while the session is active
    await redis.expire(key, EVENT_TTL_SECONDS);
  } catch (err) {
    console.error('[Socket] Error storing event in Redis:', err);
  }
}

// ─── Broadcast Functions ──────────────────────────────────────────────────────

/**
 * Broadcast a new attendance record to all clients in a session room.
 * Also stores the event in Redis for replay on reconnection.
 */
export function broadcastAttendanceNew(sessionId: string, record: unknown): void {
  if (!ioInstance) return;

  const event: AttendanceEvent = {
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
export function broadcastAttendanceUpdated(sessionId: string, record: unknown): void {
  if (!ioInstance) return;

  const event: AttendanceEvent = {
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
export function broadcastAttendanceUpdate(sessionId: string, record: unknown): void {
  broadcastAttendanceNew(sessionId, record);
}

/**
 * Broadcast a QR code refresh to all clients subscribed to a session's QR.
 */
export function broadcastQRRefresh(sessionId: string, qrToken: string): void {
  if (!ioInstance) return;
  ioInstance.to(`qr:${sessionId}`).emit('qr:refresh', { sessionId, qrToken });
}

/**
 * Broadcast session end to all clients in a session room.
 */
export function broadcastSessionEnd(sessionId: string): void {
  if (!ioInstance) return;
  ioInstance.to(`session:${sessionId}`).emit('session:ended', { sessionId });
}
