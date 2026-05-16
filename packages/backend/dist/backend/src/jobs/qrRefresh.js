"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshAllActiveSessionQRCodes = refreshAllActiveSessionQRCodes;
exports.startQRRefreshJob = startQRRefreshJob;
exports.stopQRRefreshJob = stopQRRefreshJob;
const node_cron_1 = __importDefault(require("node-cron"));
const index_1 = require("../index");
const sessionService_1 = require("../services/sessionService");
// ─── QR Refresh Cron Job ──────────────────────────────────────────────────────
// Every 30 seconds, find all active sessions and refresh their QR codes.
// This ensures QR tokens rotate frequently to prevent replay attacks.
let task = null;
/**
 * Refresh QR codes for all currently active attendance sessions.
 * Errors on individual sessions are logged but do not halt the batch.
 */
async function refreshAllActiveSessionQRCodes() {
    try {
        const activeSessions = await index_1.prisma.attendanceSession.findMany({
            where: { isActive: true },
            select: { id: true },
        });
        if (activeSessions.length === 0) {
            return;
        }
        const results = await Promise.allSettled(activeSessions.map((session) => sessionService_1.sessionService.refreshQRCode(session.id)));
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
            console.warn(`[QR Refresh] ${failures.length}/${activeSessions.length} session(s) failed to refresh`);
        }
    }
    catch (err) {
        console.error('[QR Refresh] Error fetching active sessions:', err);
    }
}
/**
 * Start the QR refresh cron job. Runs every 30 seconds.
 * Safe to call multiple times — will not create duplicate schedules.
 */
function startQRRefreshJob() {
    if (task) {
        return; // Already running
    }
    // node-cron does not support sub-minute intervals natively with standard cron syntax.
    // We use '*/30 * * * * *' (6-field syntax with seconds) to run every 30 seconds.
    task = node_cron_1.default.schedule('*/30 * * * * *', () => {
        void refreshAllActiveSessionQRCodes();
    });
    console.log('[QR Refresh] Cron job started (every 30 seconds)');
}
/**
 * Stop the QR refresh cron job. Useful for graceful shutdown and testing.
 */
function stopQRRefreshJob() {
    if (task) {
        task.stop();
        task = null;
        console.log('[QR Refresh] Cron job stopped');
    }
}
//# sourceMappingURL=qrRefresh.js.map