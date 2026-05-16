"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attendanceService = exports.AttendanceService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cuid2_1 = require("@paralleldrive/cuid2");
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
const auditService_1 = require("./auditService");
const riskService_1 = require("./riskService");
const attendanceSocket_1 = require("../sockets/attendanceSocket");
const shared_1 = require("@sams/shared");
// ─── Constants ────────────────────────────────────────────────────────────────
const QR_SECRET = process.env.QR_SECRET ?? 'qr-secret-dev';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const BIOMETRIC_CONFIDENCE_THRESHOLD = parseFloat(process.env.BIOMETRIC_CONFIDENCE_THRESHOLD ?? '0.6');
// ─── Attendance Service ───────────────────────────────────────────────────────
class AttendanceService {
    /**
     * Generate a shareable attendance link for an active session.
     * Creates a JWT with type 'LINK', stores it on the session record,
     * and returns the full shareable URL.
     */
    async generateAttendanceLink(sessionId, schoolId, expiryMinutes = 5) {
        // 1. Validate session exists, is active, and belongs to the teacher's school
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: sessionId },
        });
        if (!session) {
            throw new errors_1.AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
        }
        if (!session.isActive) {
            throw new errors_1.AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
        }
        if (session.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Session does not belong to your school');
        }
        // 2. Generate JWT with type 'LINK'
        const nonce = (0, cuid2_1.createId)();
        const now = Math.floor(Date.now() / 1000);
        const exp = now + expiryMinutes * 60;
        const linkToken = jsonwebtoken_1.default.sign({ sessionId, type: 'LINK', nonce, iat: now, exp }, QR_SECRET);
        // 3. Store token and expiry on the session record
        const expiresAt = new Date(exp * 1000);
        await index_1.prisma.attendanceSession.update({
            where: { id: sessionId },
            data: {
                currentLinkToken: linkToken,
                linkExpiresAt: expiresAt,
            },
        });
        // 4. Return link details
        const linkUrl = `${FRONTEND_URL}/attend/${linkToken}`;
        return {
            linkToken,
            linkUrl,
            expiresAt: expiresAt.toISOString(),
            sessionId,
        };
    }
    /**
     * Record attendance via link token.
     * Validates the link JWT (type: 'LINK'), checks GPS proximity,
     * prevents duplicates, classifies status, and creates the record.
     */
    async recordLinkAttendance(studentId, schoolId, linkToken, gpsCoords) {
        // 1. Verify JWT signature and expiry
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(linkToken, QR_SECRET);
        }
        catch {
            throw new errors_1.AppError(400, 'LINK_EXPIRED', 'Attendance link is expired or invalid');
        }
        // 2. Validate token has type: 'LINK' to prevent QR token reuse
        if (payload.type !== 'LINK') {
            throw new errors_1.AppError(400, 'INVALID_TOKEN_TYPE', 'Invalid token type — expected a link token');
        }
        // 3. Fetch session, check isActive
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: payload.sessionId },
        });
        if (!session) {
            throw new errors_1.AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
        }
        if (!session.isActive) {
            throw new errors_1.AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
        }
        // 4. Validate GPS proximity using haversineDistance
        if (session.locationLat != null && session.locationLng != null) {
            const distance = (0, shared_1.haversineDistance)(gpsCoords.lat, gpsCoords.lng, session.locationLat, session.locationLng);
            if (distance > session.locationRadiusM) {
                throw new errors_1.AppError(400, 'GPS_OUT_OF_RANGE', `Student is ${Math.round(distance)}m away, must be within ${session.locationRadiusM}m`);
            }
        }
        // 5. Check duplicate via sessionId + studentId unique constraint
        const existing = await index_1.prisma.attendanceRecord.findUnique({
            where: {
                sessionId_studentId: {
                    sessionId: session.id,
                    studentId,
                },
            },
        });
        if (existing) {
            throw new errors_1.AppError(400, 'DUPLICATE_SCAN', 'Attendance already recorded for this session');
        }
        // 6. Classify status (PRESENT/LATE) using classifyAttendanceStatus
        const status = (0, shared_1.classifyAttendanceStatus)(new Date(), session.startedAt, session.lateThresholdMin);
        // 7. Create AttendanceRecord with method="LINK"
        const record = await index_1.prisma.attendanceRecord.create({
            data: {
                id: (0, cuid2_1.createId)(),
                schoolId,
                sessionId: session.id,
                studentId,
                status,
                method: 'LINK',
                scannedAt: new Date(),
            },
        });
        // 8. Broadcast via WebSocket and trigger risk score recomputation
        (0, attendanceSocket_1.broadcastAttendanceNew)(session.id, record);
        riskService_1.riskService.computeRiskScore(schoolId, studentId).catch(() => { });
        return record;
    }
    /**
     * Record attendance via QR code scan.
     * Validates the QR JWT, checks GPS proximity, prevents duplicates,
     * classifies status, and creates the record.
     */
    async recordQRScan(studentId, schoolId, qrToken, gpsCoords) {
        // 1. Verify QR JWT
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(qrToken, QR_SECRET);
        }
        catch {
            throw new errors_1.AppError(400, 'QR_EXPIRED', 'QR code is expired or invalid');
        }
        // 2. Extract sessionId and fetch session
        const session = await index_1.prisma.attendanceSession.findUnique({
            where: { id: payload.sessionId },
        });
        if (!session) {
            throw new errors_1.AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
        }
        if (!session.isActive) {
            throw new errors_1.AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
        }
        // 3. Validate GPS proximity
        if (session.locationLat != null && session.locationLng != null) {
            const distance = (0, shared_1.haversineDistance)(gpsCoords.lat, gpsCoords.lng, session.locationLat, session.locationLng);
            if (distance > session.locationRadiusM) {
                throw new errors_1.AppError(400, 'GPS_OUT_OF_RANGE', `Student is ${Math.round(distance)}m away, must be within ${session.locationRadiusM}m`);
            }
        }
        // 4. Check duplicate
        const existing = await index_1.prisma.attendanceRecord.findUnique({
            where: {
                sessionId_studentId: {
                    sessionId: session.id,
                    studentId,
                },
            },
        });
        if (existing) {
            throw new errors_1.AppError(400, 'DUPLICATE_SCAN', 'Attendance already recorded for this session');
        }
        // 5. Classify status
        const status = (0, shared_1.classifyAttendanceStatus)(new Date(), session.startedAt, session.lateThresholdMin);
        // 6. Create AttendanceRecord
        const record = await index_1.prisma.attendanceRecord.create({
            data: {
                id: (0, cuid2_1.createId)(),
                schoolId,
                sessionId: session.id,
                studentId,
                status,
                method: 'QR',
                scannedAt: new Date(),
            },
        });
        // Broadcast new attendance to session room
        (0, attendanceSocket_1.broadcastAttendanceNew)(session.id, record);
        // Fire-and-forget: recompute student risk score
        riskService_1.riskService.computeRiskScore(schoolId, studentId).catch(() => { });
        return record;
    }
    /**
     * Record attendance manually by a teacher.
     * Validates status and note length, handles duplicates by updating.
     */
    async recordManual(teacherId, schoolId, studentId, sessionId, status, note) {
        // Validate status
        const validStatuses = [
            shared_1.AttendanceStatus.PRESENT,
            shared_1.AttendanceStatus.LATE,
            shared_1.AttendanceStatus.EXCUSED,
            shared_1.AttendanceStatus.ABSENT,
        ];
        if (!validStatuses.includes(status)) {
            throw new errors_1.AppError(400, 'INVALID_STATUS', `Status must be one of: ${validStatuses.join(', ')}`);
        }
        // Validate note length
        if (note && note.length > 500) {
            throw new errors_1.AppError(400, 'NOTE_TOO_LONG', 'Note must be 500 characters or fewer');
        }
        // Check for existing record (duplicate)
        const existing = await index_1.prisma.attendanceRecord.findUnique({
            where: {
                sessionId_studentId: {
                    sessionId,
                    studentId,
                },
            },
        });
        if (existing) {
            // Update (overwrite) existing record and log to audit
            const previousStatus = existing.status;
            const updated = await index_1.prisma.attendanceRecord.update({
                where: { id: existing.id },
                data: {
                    status: status,
                    method: 'MANUAL',
                    note: note ?? existing.note,
                    scannedAt: new Date(),
                },
            });
            await auditService_1.auditService.log({
                eventType: 'ATTENDANCE_UPDATED',
                actorId: teacherId,
                actorRole: 'TEACHER',
                schoolId,
                resourceSnapshot: {
                    recordId: existing.id,
                    sessionId,
                    studentId,
                    previousStatus,
                    newStatus: status,
                    method: 'MANUAL',
                    note,
                },
            });
            // Broadcast updated attendance to session room
            (0, attendanceSocket_1.broadcastAttendanceUpdated)(sessionId, updated);
            // Fire-and-forget: recompute student risk score
            riskService_1.riskService.computeRiskScore(schoolId, studentId).catch(() => { });
            return updated;
        }
        // Create new record
        const record = await index_1.prisma.attendanceRecord.create({
            data: {
                id: (0, cuid2_1.createId)(),
                schoolId,
                sessionId,
                studentId,
                status: status,
                method: 'MANUAL',
                note,
                scannedAt: new Date(),
            },
        });
        // Broadcast new attendance to session room
        (0, attendanceSocket_1.broadcastAttendanceNew)(sessionId, record);
        // Fire-and-forget: recompute student risk score
        riskService_1.riskService.computeRiskScore(schoolId, studentId).catch(() => { });
        return record;
    }
    /**
     * Record attendance via biometric verification.
     * Checks confidence threshold before creating the record.
     */
    async recordBiometric(teacherId, schoolId, sessionId, studentId, confidence) {
        // Check confidence threshold
        if (confidence < BIOMETRIC_CONFIDENCE_THRESHOLD) {
            throw new errors_1.AppError(400, 'LOW_CONFIDENCE', `Biometric confidence ${confidence} is below threshold ${BIOMETRIC_CONFIDENCE_THRESHOLD}`);
        }
        // Check for existing record
        const existing = await index_1.prisma.attendanceRecord.findUnique({
            where: {
                sessionId_studentId: {
                    sessionId,
                    studentId,
                },
            },
        });
        if (existing) {
            throw new errors_1.AppError(400, 'DUPLICATE_SCAN', 'Attendance already recorded for this session');
        }
        // Create record with status PRESENT
        const record = await index_1.prisma.attendanceRecord.create({
            data: {
                id: (0, cuid2_1.createId)(),
                schoolId,
                sessionId,
                studentId,
                status: shared_1.AttendanceStatus.PRESENT,
                method: 'BIOMETRIC',
                scannedAt: new Date(),
            },
        });
        // Broadcast new attendance to session room
        (0, attendanceSocket_1.broadcastAttendanceNew)(sessionId, record);
        // Fire-and-forget: recompute student risk score
        riskService_1.riskService.computeRiskScore(schoolId, studentId).catch(() => { });
        return record;
    }
    /**
     * Update an existing attendance record.
     * Validates school ownership, stores previous status, and logs to audit.
     */
    async updateRecord(teacherId, schoolId, recordId, status, note) {
        // Fetch record and assert school ownership
        const record = await index_1.prisma.attendanceRecord.findUnique({
            where: { id: recordId },
        });
        if (!record) {
            throw new errors_1.AppError(404, 'RECORD_NOT_FOUND', 'Attendance record not found');
        }
        if (record.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Record does not belong to this school');
        }
        // Validate status
        const validStatuses = [
            shared_1.AttendanceStatus.PRESENT,
            shared_1.AttendanceStatus.LATE,
            shared_1.AttendanceStatus.EXCUSED,
            shared_1.AttendanceStatus.ABSENT,
        ];
        if (!validStatuses.includes(status)) {
            throw new errors_1.AppError(400, 'INVALID_STATUS', `Status must be one of: ${validStatuses.join(', ')}`);
        }
        // Store previous status
        const previousStatus = record.status;
        // Update record
        const updated = await index_1.prisma.attendanceRecord.update({
            where: { id: recordId },
            data: {
                status: status,
                note: note ?? record.note,
            },
        });
        // Log to AuditService
        await auditService_1.auditService.log({
            eventType: 'ATTENDANCE_UPDATED',
            actorId: teacherId,
            actorRole: 'TEACHER',
            schoolId,
            resourceSnapshot: {
                recordId,
                sessionId: record.sessionId,
                studentId: record.studentId,
                previousStatus,
                newStatus: status,
                note,
            },
        });
        // Broadcast updated attendance to session room
        (0, attendanceSocket_1.broadcastAttendanceUpdated)(record.sessionId, updated);
        // Fire-and-forget: recompute student risk score
        riskService_1.riskService.computeRiskScore(schoolId, record.studentId).catch(() => { });
        return updated;
    }
    /**
     * Sync offline attendance records.
     * For each record: check if a server record exists for the same session+student.
     * Conflict resolution: server timestamp > offline → keep server; else → upsert offline.
     * Logs every conflict to AuditService.
     */
    async syncOfflineRecords(schoolId, records) {
        const synced = [];
        const conflicts = [];
        for (const offlineRecord of records) {
            const existing = await index_1.prisma.attendanceRecord.findUnique({
                where: {
                    sessionId_studentId: {
                        sessionId: offlineRecord.sessionId,
                        studentId: offlineRecord.studentId,
                    },
                },
            });
            if (existing) {
                // Conflict: compare timestamps
                const serverTimestamp = existing.scannedAt.getTime();
                const offlineTimestamp = new Date(offlineRecord.scannedAt).getTime();
                if (serverTimestamp > offlineTimestamp) {
                    // Server wins — keep server record
                    const conflict = {
                        recordId: existing.id,
                        resolution: 'server_wins',
                        offlineRecord,
                        serverRecord: {
                            id: existing.id,
                            sessionId: existing.sessionId,
                            studentId: existing.studentId,
                            status: existing.status,
                            method: existing.method,
                            note: existing.note ?? undefined,
                            scannedAt: existing.scannedAt.toISOString(),
                            synced: true,
                        },
                    };
                    conflicts.push(conflict);
                    // Log conflict to audit
                    await auditService_1.auditService.log({
                        eventType: 'CONFLICT_RESOLVED',
                        schoolId,
                        resourceSnapshot: {
                            resolution: 'server_wins',
                            serverRecordId: existing.id,
                            offlineRecordId: offlineRecord.id,
                            serverTimestamp: existing.scannedAt.toISOString(),
                            offlineTimestamp: offlineRecord.scannedAt,
                            serverStatus: existing.status,
                            offlineStatus: offlineRecord.status,
                        },
                    });
                }
                else {
                    // Offline wins — upsert with offline data
                    await index_1.prisma.attendanceRecord.update({
                        where: { id: existing.id },
                        data: {
                            status: offlineRecord.status,
                            method: offlineRecord.method,
                            note: offlineRecord.note,
                            scannedAt: new Date(offlineRecord.scannedAt),
                            syncedAt: new Date(),
                        },
                    });
                    const conflict = {
                        recordId: existing.id,
                        resolution: 'offline_wins',
                        offlineRecord,
                        serverRecord: {
                            id: existing.id,
                            sessionId: existing.sessionId,
                            studentId: existing.studentId,
                            status: existing.status,
                            method: existing.method,
                            note: existing.note ?? undefined,
                            scannedAt: existing.scannedAt.toISOString(),
                            synced: true,
                        },
                    };
                    conflicts.push(conflict);
                    // Log conflict to audit
                    await auditService_1.auditService.log({
                        eventType: 'CONFLICT_RESOLVED',
                        schoolId,
                        resourceSnapshot: {
                            resolution: 'offline_wins',
                            serverRecordId: existing.id,
                            offlineRecordId: offlineRecord.id,
                            serverTimestamp: existing.scannedAt.toISOString(),
                            offlineTimestamp: offlineRecord.scannedAt,
                            serverStatus: existing.status,
                            offlineStatus: offlineRecord.status,
                        },
                    });
                    synced.push(existing.id);
                }
            }
            else {
                // No conflict — create new record from offline data
                const newRecord = await index_1.prisma.attendanceRecord.create({
                    data: {
                        id: (0, cuid2_1.createId)(),
                        schoolId,
                        sessionId: offlineRecord.sessionId,
                        studentId: offlineRecord.studentId,
                        status: offlineRecord.status,
                        method: offlineRecord.method,
                        note: offlineRecord.note,
                        scannedAt: new Date(offlineRecord.scannedAt),
                        syncedAt: new Date(),
                    },
                });
                synced.push(newRecord.id);
            }
        }
        return { synced, conflicts };
    }
}
exports.AttendanceService = AttendanceService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.attendanceService = new AttendanceService();
//# sourceMappingURL=attendanceService.js.map