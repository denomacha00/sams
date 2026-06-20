import { useState, useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { enqueueNewMessageToast } from '../components/NewMessageToast';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TypingUser {
  userId: string;
  senderName: string;
  senderRole: string;
  action: 'typing' | 'recording' | 'stopped';
  scope: 'school' | 'department' | 'class';
  targetId?: string;
  timestamp: number;
}

type TypingListener = () => void;

// ─── Global state ─────────────────────────────────────────────────────────────

let globalTypingUsers: TypingUser[] = [];
let globalTypingListeners = new Set<TypingListener>();

function updateTypingListeners(): void {
  globalTypingListeners.forEach((listener) => listener());
}

function sameTypingTarget(a: TypingUser, b: TypingUser): boolean {
  return (
    a.userId === b.userId &&
    a.scope === b.scope &&
    (a.targetId ?? '') === (b.targetId ?? '')
  );
}

function findAndUpdateTyping(update: TypingUser): void {
  globalTypingUsers = globalTypingUsers.filter((t) => !sameTypingTarget(t, update));

  if (update.action !== 'stopped') {
    globalTypingUsers.push(update);
  }

  updateTypingListeners();
}

function clearStaleTypingIndicators(): void {
  const now = Date.now();
  globalTypingUsers = globalTypingUsers.filter(
    (t) => now - t.timestamp < 7_000,
  );
  updateTypingListeners();
}

// ─── Socket management ────────────────────────────────────────────────────────

let globalSocket: Socket | null = null;
let socketRefCount = 0;

function connectSocket(userId: string): Socket | null {
  try {
    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) return null;

    const wsUrl = import.meta.env.VITE_WS_URL || window.location.origin;
    const socket = io(wsUrl, { auth: { token: accessToken } });

    socket.on('connect', () => {
      console.log('[NotificationLive] Socket connected');
    });

    // ─── Listen for typing indicators ──────────────────────────────────
    socket.on('typing:notification', (data: TypingUser) => {
      findAndUpdateTyping(data);
    });

    // ─── Listen for new notifications (toast) ──────────────────────────
    socket.on('notification:new', (data: any) => {
      enqueueNewMessageToast({
        id: data.id || `toast-${Date.now()}`,
        title: data.title || 'New Message',
        message: data.message || '',
        senderName: data.senderName || null,
        senderRole: data.senderRole || null,
        batchId: data.batchId || null,
        timestamp: data.timestamp || new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      console.log('[NotificationLive] Socket disconnected');
    });

    return socket;
  } catch {
    return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseNotificationLiveResult {
  typingUsers: TypingUser[];
  /** Call when user starts typing in send form */
  emitTyping: (payload: {
    scope: 'school' | 'department' | 'class';
    targetId?: string;
    senderName: string;
    senderRole: string;
  }) => void;
  /** Call when user starts recording voice */
  emitRecording: (payload: {
    scope: 'school' | 'department' | 'class';
    targetId?: string;
    senderName: string;
    senderRole: string;
  }) => void;
  /** Call when user stops typing/recording */
  emitStopped: (payload: {
    scope: 'school' | 'department' | 'class';
    targetId?: string;
    senderName: string;
    senderRole: string;
  }) => void;
}

export function useNotificationLive(): UseNotificationLiveResult {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const socketRef = useRef<Socket | null>(null);

  // Connect/disconnect socket
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    socketRefCount++;
    if (!globalSocket) {
      globalSocket = connectSocket(user.id);
      socketRef.current = globalSocket;
    }

    return () => {
      socketRefCount--;
      if (socketRefCount <= 0 && globalSocket) {
        globalSocket.disconnect();
        globalSocket = null;
      }
    };
  }, [isAuthenticated, user?.id]);

  // Listen for typing updates
  useEffect(() => {
    const listener = () => {
      setTypingUsers([...globalTypingUsers]);
    };
    globalTypingListeners.add(listener);

    // Periodic stale cleanup
    const interval = setInterval(clearStaleTypingIndicators, 3000);

    return () => {
      globalTypingListeners.delete(listener);
      clearInterval(interval);
    };
  }, []);

  const emitTyping = useCallback(
    (payload: { scope: 'school' | 'department' | 'class'; targetId?: string; senderName: string; senderRole: string }) => {
      if (!globalSocket?.connected) return;
      globalSocket.emit('typing:notification', { ...payload, action: 'typing' });
    },
    [],
  );

  const emitRecording = useCallback(
    (payload: { scope: 'school' | 'department' | 'class'; targetId?: string; senderName: string; senderRole: string }) => {
      if (!globalSocket?.connected) return;
      globalSocket.emit('typing:notification', { ...payload, action: 'recording' });
    },
    [],
  );

  const emitStopped = useCallback(
    (payload: { scope: 'school' | 'department' | 'class'; targetId?: string; senderName: string; senderRole: string }) => {
      if (!globalSocket?.connected) return;
      globalSocket.emit('typing:notification', { ...payload, action: 'stopped' });
    },
    [],
  );

  return { typingUsers, emitTyping, emitRecording, emitStopped };
}
