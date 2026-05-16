import { Server as SocketIOServer } from 'socket.io';
/**
 * Initialize the attendance socket namespace.
 * Authenticates connections via handshake token and sets up event handlers.
 */
export declare function setupAttendanceSocket(io: SocketIOServer): void;
/**
 * Broadcast a new attendance record to all clients in a session room.
 * Also stores the event in Redis for replay on reconnection.
 */
export declare function broadcastAttendanceNew(sessionId: string, record: unknown): void;
/**
 * Broadcast an attendance record update to all clients in a session room.
 * Also stores the event in Redis for replay on reconnection.
 */
export declare function broadcastAttendanceUpdated(sessionId: string, record: unknown): void;
/**
 * Broadcast a new attendance record (alias for backward compatibility).
 * Use broadcastAttendanceNew or broadcastAttendanceUpdated for specific events.
 */
export declare function broadcastAttendanceUpdate(sessionId: string, record: unknown): void;
/**
 * Broadcast a QR code refresh to all clients subscribed to a session's QR.
 */
export declare function broadcastQRRefresh(sessionId: string, qrToken: string): void;
/**
 * Broadcast session end to all clients in a session room.
 */
export declare function broadcastSessionEnd(sessionId: string): void;
//# sourceMappingURL=attendanceSocket.d.ts.map