/**
 * Find students whose attendance percentage is below the configured threshold
 * and send SMS + in-app notifications to the student's Teacher and HOD.
 *
 * Attendance percentage = (PRESENT + LATE records) / (total records) * 100
 *
 * Requirements: 18.1
 */
export declare function checkLowAttendance(): Promise<void>;
/**
 * Find schools whose license expires within the configured warning window
 * and send a daily email reminder to the School Admin.
 *
 * Requirements: 18.2
 */
export declare function checkLicenseExpiry(): Promise<void>;
/**
 * Run all daily notification checks.
 * Called by the cron scheduler at the configured time.
 */
export declare function runDailyNotificationChecks(): Promise<void>;
/**
 * Start the notification cron job. Runs daily at 6:00 AM.
 * Safe to call multiple times — will not create duplicate schedules.
 */
export declare function startNotificationJob(): void;
/**
 * Stop the notification cron job. Useful for graceful shutdown and testing.
 */
export declare function stopNotificationJob(): void;
//# sourceMappingURL=notifications.d.ts.map