import apiClient from './apiClient';
import { getPendingRecords, markSynced } from './offlineStore';
import { SyncResult } from '@sams/shared';

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Sync all pending offline attendance records to the server.
 */
export async function syncPendingRecords(): Promise<SyncResult | null> {
  const pending = await getPendingRecords();
  if (pending.length === 0) return null;

  try {
    const { data } = await apiClient.post<SyncResult>('/attendance/sync', {
      records: pending,
    });

    // Mark synced records
    for (const id of data.synced) {
      await markSynced(id);
    }

    return data;
  } catch (error) {
    console.error('[SyncService] Failed to sync records:', error);
    return null;
  }
}

/**
 * Register online event listener to trigger sync within 30 seconds of reconnection.
 */
export function registerOnlineSync(): void {
  window.addEventListener('online', () => {
    // Debounce: sync within 30 seconds of coming online
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      syncPendingRecords();
    }, 5000); // Start sync 5s after reconnection (within 30s window)
  });

  // Also attempt sync on page load if online
  if (navigator.onLine) {
    setTimeout(() => {
      syncPendingRecords();
    }, 10000); // 10s after page load
  }
}

// Auto-register on import
registerOnlineSync();
