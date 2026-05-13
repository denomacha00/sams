import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { type AccessTokenPayload } from '@sams/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  user?: AccessTokenPayload;
}

// ─── Module-level reference to io ─────────────────────────────────────────────

let ioInstance: SocketIOServer | null = null;

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Initialize the attendance socket namespace.
 * Authenticates connections via handshake token and sets up event handlers.
 */
export function setupAttendanceSocket(io: SocketIOServer): void {
  ioInstance = io;

  const JWT_SECRET = process.env.JWT_SECRET ?? '';

  // Authentication middleware
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

    // Handle session:join — join a specific session room
    socket.on('session:join', (data: { sessionId: string }) => {
      if (data?.sessionId) {
        socket.join(`session:${data.sessionId}`);
      }
    });

    // Handle session:leave
    socket.on('session:leave', (data: { sessionId: string }) => {
      if (data?.sessionId) {
        socket.leave(`session:${data.sessionId}`);
      }
    });

    // Handle qr:subscribe — subscribe to QR refresh events for a session
    socket.on('qr:subscribe', (data: { sessionId: string }) => {
      if (data?.sessionId) {
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

// ─── Broadcast Functions ──────────────────────────────────────────────────────

/**
 * Broadcast an attendance update to all clients in a session room.
 */
export function broadcastAttendanceUpdate(sessionId: string, record: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`session:${sessionId}`).emit('attendance:update', record);
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
