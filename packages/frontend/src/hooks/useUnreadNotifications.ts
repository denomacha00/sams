import { useState, useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';

const POLL_INTERVAL_MS = 60_000;

let globalUnreadCount = 0;
let globalListeners = new Set<(count: number) => void>();
let globalPollTimer: ReturnType<typeof setInterval> | null = null;
let globalSocket: Socket | null = null;

function updateGlobalCount(newCount: number): void {
  globalUnreadCount = newCount;
  globalListeners.forEach((listener) => listener(newCount));
}

async function fetchUnreadCount(): Promise<void> {
  try {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const { data } = await apiClient.get('/notifications/unread-count');
    updateGlobalCount(data.count ?? 0);
  } catch {
    // Silently fail — next poll will retry
  }
}

function startPolling(): void {
  if (globalPollTimer) return;
  void fetchUnreadCount();
  globalPollTimer = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (globalPollTimer) {
    clearInterval(globalPollTimer);
    globalPollTimer = null;
  }
}

function setupSocketListener(): void {
  if (globalSocket?.connected) return;

  try {
    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) return;

    const wsUrl = import.meta.env.VITE_WS_URL || window.location.origin;
    globalSocket = io(wsUrl, { auth: { token: accessToken } });

    globalSocket.on('connect', () => {
      console.log('[UnreadNotifications] Socket connected');
    });

    globalSocket.on('notification:new', () => {
      // Bump the count on any new notification
      void fetchUnreadCount();
    });

    globalSocket.on('disconnect', () => {
      console.log('[UnreadNotifications] Socket disconnected');
    });
  } catch {
    // Socket connection failure is non-critical
  }
}

function cleanupSocket(): void {
  if (globalSocket) {
    globalSocket.disconnect();
    globalSocket = null;
  }
}

/**
 * Shared hook for unread notification count.
 * Only one API poll runs regardless of how many components use this hook.
 */
export function useUnreadNotifications(): { unreadCount: number } {
  const [count, setCount] = useState(globalUnreadCount);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      updateGlobalCount(0);
      return;
    }

    // Add listener
    const listener = (newCount: number) => setCount(newCount);
    globalListeners.add(listener);

    // Start shared resources on first mount
    startPolling();
    setupSocketListener();

    // Fetch immediately
    void fetchUnreadCount();

    return () => {
      globalListeners.delete(listener);

      // Stop shared resources when no listeners remain
      if (globalListeners.size === 0) {
        stopPolling();
        cleanupSocket();
      }
    };
  }, [isAuthenticated]);

  return { unreadCount: count };
}
