import cron from 'node-cron';
import { prisma } from '../index';
import { sessionService } from '../services/sessionService';

// ─── QR Refresh Cron Job ──────────────────────────────────────────────────────
// Every 30 seconds, find all active sessions and refresh their QR codes.
// This ensures QR tokens rotate frequently to prevent replay attacks.

let task: cron.ScheduledTask | null = null;

/**
 * Refresh QR codes for all currently active attendance sessions.
 * Errors on individual sessions are logged but do not halt the batch.
 */
export async function refreshAllActiveSessionQRCodes(): Promise<void> {
  try {
    const activeSessions = await prisma.attendanceSession.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (activeSessions.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      activeSessions.map((session) => sessionService.refreshQRCode(session.id)),
    );

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(
        `[QR Refresh] ${failures.length}/${activeSessions.length} session(s) failed to refresh`,
      );
    }
  } catch (err) {
    console.error('[QR Refresh] Error fetching active sessions:', err);
  }
}

/**
 * Start the QR refresh cron job. Runs every 30 seconds.
 * Safe to call multiple times — will not create duplicate schedules.
 */
export function startQRRefreshJob(): void {
  if (task) {
    return; // Already running
  }

  // node-cron does not support sub-minute intervals natively with standard cron syntax.
  // We use '*/30 * * * * *' (6-field syntax with seconds) to run every 30 seconds.
  task = cron.schedule('*/30 * * * * *', () => {
    void refreshAllActiveSessionQRCodes();
  });

  console.log('[QR Refresh] Cron job started (every 30 seconds)');
}

/**
 * Stop the QR refresh cron job. Useful for graceful shutdown and testing.
 */
export function stopQRRefreshJob(): void {
  if (task) {
    task.stop();
    task = null;
    console.log('[QR Refresh] Cron job stopped');
  }
}
