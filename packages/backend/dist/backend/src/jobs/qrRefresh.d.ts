/**
 * Refresh QR codes for all currently active attendance sessions.
 * Errors on individual sessions are logged but do not halt the batch.
 */
export declare function refreshAllActiveSessionQRCodes(): Promise<void>;
/**
 * Start the QR refresh cron job. Runs every 30 seconds.
 * Safe to call multiple times — will not create duplicate schedules.
 */
export declare function startQRRefreshJob(): void;
/**
 * Stop the QR refresh cron job. Useful for graceful shutdown and testing.
 */
export declare function stopQRRefreshJob(): void;
//# sourceMappingURL=qrRefresh.d.ts.map