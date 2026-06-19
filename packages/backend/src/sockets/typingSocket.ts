import { Server as SocketIOServer, Socket } from 'socket.io';
import { type AccessTokenPayload } from '@sams/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  user?: AccessTokenPayload;
}

export interface TypingPayload {
  /** 'typing' | 'recording' | 'stopped' */
  action: 'typing' | 'recording' | 'stopped';
  /** The sender's display name (used in the indicator UI) */
  senderName: string;
  /** The sender's role for display */
  senderRole: string;
  /** The scope the message is being sent to — broadcasts only to that room */
  scope: 'school' | 'department' | 'class';
  /** Relevant targetId for department/class scopes */
  targetId?: string;
}

// ─── Store for heartbeat cleanup ──────────────────────────────────────────────

/**
 * Typing timeout map: key = `userId:room`, value = NodeJS.Timeout
 * Ensures typing indicators auto-clear after inactivity.
 */
const typingHeartbeats = new Map<string, ReturnType<typeof setTimeout>>();

const TYPING_TIMEOUT_MS = 6_000; // 6 seconds of silence clears indicator

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getScopeRoom(scope: string, schoolId: string, targetId?: string): string {
  if (scope === 'department' && targetId) return `department:${targetId}`;
  if (scope === 'class' && targetId) return `class:${targetId}`;
  return `school:${schoolId}`;
}

function heartbeatKey(userId: string, scopeRoom: string): string {
  return `${userId}:${scopeRoom}`;
}

function clearHeartbeat(key: string): void {
  const existing = typingHeartbeats.get(key);
  if (existing) {
    clearTimeout(existing);
    typingHeartbeats.delete(key);
  }
}

function scheduleHeartbeat(
  socket: Socket,
  userId: string,
  scopeRoom: string,
  payload: Record<string, unknown>,
): void {
  const key = heartbeatKey(userId, scopeRoom);
  clearHeartbeat(key);

  // Auto-clear after TYPING_TIMEOUT_MS
  const timer = setTimeout(() => {
    socket.to(scopeRoom).emit('typing:notification', {
      ...payload,
      action: 'stopped',
      userId,
    });
    typingHeartbeats.delete(key);
  }, TYPING_TIMEOUT_MS);

  typingHeartbeats.set(key, timer);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Initialize the typing indicator socket handler.
 * Handles typing/recording indicators for the notification chat system.
 *
 * Socket events:
 *   client → server:  'typing:notification' (TypingPayload)
 *   server → client:  'typing:notification' (TypingPayload + userId + timestamp)
 *
 * IMPORTANT: Auth middleware is already applied by setupAttendanceSocket on the
 * same io instance — do NOT add io.use() here. The `user` property is set by
 * the attendance socket's middleware.
 *
 * The server broadcasts to the scope room (school, department, or class)
 * matching where the sender's message would go.
 */
export function setupTypingSocket(io: SocketIOServer): void {
  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    if (!user) return;

    // ─── typing:notification ──────────────────────────────────────────
    // Client sends this when user starts typing / recording in the send form.
    // The server broadcasts to the appropriate scope room so recipients see the indicator.
    socket.on('typing:notification', (data: TypingPayload) => {
      if (!data?.action || !data?.senderName) return;

      const scopeRoom = getScopeRoom(data.scope, user.schoolId, data.targetId);
      const broadcastPayload = {
        userId: user.sub,
        senderName: data.senderName,
        senderRole: data.senderRole,
        action: data.action,
        scope: data.scope,
        targetId: data.targetId,
        timestamp: Date.now(),
      };

      // Broadcast to the scope room (exclude sender)
      socket.to(scopeRoom).emit('typing:notification', broadcastPayload);

      if (data.action === 'typing' || data.action === 'recording') {
        scheduleHeartbeat(socket, user.sub, scopeRoom, broadcastPayload);
      } else {
        // 'stopped' — clear heartbeat
        const key = heartbeatKey(user.sub, scopeRoom);
        clearHeartbeat(key);
      }
    });

    // Clean up heartbeats on disconnect
    socket.on('disconnect', () => {
      for (const [key, timer] of typingHeartbeats.entries()) {
        if (key.startsWith(`${user.sub}:`)) {
          clearTimeout(timer);
          typingHeartbeats.delete(key);
        }
      }
    });
  });
}
