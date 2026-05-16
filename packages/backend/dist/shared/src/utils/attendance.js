"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyAttendanceStatus = classifyAttendanceStatus;
const index_1 = require("../types/index");
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
function classifyAttendanceStatus(scanTime, sessionStart, lateThresholdMin) {
    const deltaMs = scanTime.getTime() - sessionStart.getTime();
    const deltaMin = deltaMs / 60_000;
    if (deltaMin <= lateThresholdMin) {
        return index_1.AttendanceStatus.PRESENT;
    }
    else if (deltaMin <= 2 * lateThresholdMin) {
        return index_1.AttendanceStatus.LATE;
    }
    else {
        return index_1.AttendanceStatus.ABSENT;
    }
}
//# sourceMappingURL=attendance.js.map