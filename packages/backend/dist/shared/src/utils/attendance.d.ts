import { AttendanceStatus } from '../types/index';
/**
 * Classifies an attendance scan into PRESENT, LATE, or ABSENT based on the
 * time delta between the scan and the session start.
 *
 * Rules (Requirements 5.5, 5.6, 5.7):
 *   - delta <= threshold              → PRESENT
 *   - threshold < delta <= 2*threshold → LATE
 *   - delta > 2*threshold             → ABSENT
 *
 * @param scanTime        - The time the student scanned the QR code
 * @param sessionStart    - The time the attendance session started
 * @param lateThresholdMin - The late threshold in minutes
 * @returns The computed AttendanceStatus
 */
export declare function classifyAttendanceStatus(scanTime: Date, sessionStart: Date, lateThresholdMin: number): AttendanceStatus;
//# sourceMappingURL=attendance.d.ts.map