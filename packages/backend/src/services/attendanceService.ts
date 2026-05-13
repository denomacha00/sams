import jwt from 'jsonwebtoken';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../index';
import { AppError } from '../middleware/errors';
import { auditService } from './auditService';
import {
  haversineDistance,
  classifyAttendanceStatus,
  AttendanceStatus,
  OfflineAttendanceRecord,
  ConflictResult,
  SyncResult,
} from '@sams/shared';

// ─── Constants ────────────────────────────────────────────────────────────────

const QR_SECRET = process.env.QR_SECRET ?? 'qr-secret-dev';
const BIOMETRIC_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.BIOMETRIC_CONFIDENCE_THRESHOLD ?? '0.6',
);

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface QRTokenPayload {
  sessionId: string;
  nonce: string;
  iat: number;
  exp: number;
}

// ─── Attendance Service ───────────────────────────────────────────────────────

export class AttendanceService {
  /**
   * Record attendance via QR code scan.
   * Validates the QR JWT, checks GPS proximity, prevents duplicates,
   * classifies status, and creates the record.
   */
  async recordQRScan(
    studentId: string,
    schoolId: string,
    qrToken: string,
    gpsCoords: { lat: number; lng: number },
  ) {
    // 1. Verify QR JWT
    let payload: QRTokenPayload;
    try {
      payload = jwt.verify(qrToken, QR_SECRET) as QRTokenPayload;
    } catch {
      throw new AppError(400, 'QR_EXPIRED', 'QR code is expired or invalid');
    }

    // 2. Extract sessionId and fetch session
    const session = await prisma.attendanceSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
    }

    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
    }

    // 3. Validate GPS proximity
    if (session.locationLat != null && session.locationLng != null) {
      const distance = haversineDistance(
        gpsCoords.lat,
        gpsCoords.lng,
        session.locationLat,
        session.locationLng,
      );

      if (distance > session.locationRadiusM) {
        throw new AppError(
          400,
          'GPS_OUT_OF_RANGE',
          `Student is ${Math.round(distance)}m away, must be within ${session.locationRadiusM}m`,
        );
      }
    }

    // 4. Check duplicate
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        sessionId_studentId: {
          sessionId: session.id,
          studentId,
        },
      },
    });

    if (existing) {
      throw new AppError(
        400,
        'DUPLICATE_SCAN',
        'Attendance already recorded for this session',
      );
    }

    // 5. Classify status
    const status = classifyAttendanceStatus(
      new Date(),
      session.startedAt,
      session.lateThresholdMin,
    );

    // 6. Create AttendanceRecord
    const record = await prisma.attendanceRecord.create({
      data: {
        id: createId(),
        schoolId,
        sessionId: session.id,
        studentId,
        status,
        method: 'QR',
        scannedAt: new Date(),
      },
    });

    return record;
  }

  /**
   * Record attendance manually by a teacher.
   * Validates status and note length, handles duplicates by updating.
   */
  async recordManual(
    teacherId: string,
    schoolId: string,
    studentId: string,
    sessionId: string,
    status: string,
    note?: string,
  ) {
    // Validate status
    const validStatuses: string[] = [
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.EXCUSED,
      AttendanceStatus.ABSENT,
    ];

    if (!validStatuses.includes(status)) {
      throw new AppError(
        400,
        'INVALID_STATUS',
        `Status must be one of: ${validStatuses.join(', ')}`,
      );
    }

    // Validate note length
    if (note && note.length > 500) {
      throw new AppError(
        400,
        'NOTE_TOO_LONG',
        'Note must be 500 characters or fewer',
      );
    }

    // Check for existing record (duplicate)
    const existing = await prisma.attendanceRecord.findUnique({
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

      const updated = await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status: status as AttendanceStatus,
          method: 'MANUAL',
          note: note ?? existing.note,
          scannedAt: new Date(),
        },
      });

      await auditService.log({
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

      return updated;
    }

    // Create new record
    const record = await prisma.attendanceRecord.create({
      data: {
        id: createId(),
        schoolId,
        sessionId,
        studentId,
        status: status as AttendanceStatus,
        method: 'MANUAL',
        note,
        scannedAt: new Date(),
      },
    });

    return record;
  }

  /**
   * Record attendance via biometric verification.
   * Checks confidence threshold before creating the record.
   */
  async recordBiometric(
    teacherId: string,
    schoolId: string,
    sessionId: string,
    studentId: string,
    confidence: number,
  ) {
    // Check confidence threshold
    if (confidence < BIOMETRIC_CONFIDENCE_THRESHOLD) {
      throw new AppError(
        400,
        'LOW_CONFIDENCE',
        `Biometric confidence ${confidence} is below threshold ${BIOMETRIC_CONFIDENCE_THRESHOLD}`,
      );
    }

    // Check for existing record
    const existing = await prisma.attendanceRecord.findUnique({
      where: {
        sessionId_studentId: {
          sessionId,
          studentId,
        },
      },
    });

    if (existing) {
      throw new AppError(
        400,
        'DUPLICATE_SCAN',
        'Attendance already recorded for this session',
      );
    }

    // Create record with status PRESENT
    const record = await prisma.attendanceRecord.create({
      data: {
        id: createId(),
        schoolId,
        sessionId,
        studentId,
        status: AttendanceStatus.PRESENT,
        method: 'BIOMETRIC',
        scannedAt: new Date(),
      },
    });

    return record;
  }

  /**
   * Update an existing attendance record.
   * Validates school ownership, stores previous status, and logs to audit.
   */
  async updateRecord(
    teacherId: string,
    schoolId: string,
    recordId: string,
    status: string,
    note?: string,
  ) {
    // Fetch record and assert school ownership
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
    });

    if (!record) {
      throw new AppError(404, 'RECORD_NOT_FOUND', 'Attendance record not found');
    }

    if (record.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Record does not belong to this school');
    }

    // Validate status
    const validStatuses: string[] = [
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.EXCUSED,
      AttendanceStatus.ABSENT,
    ];

    if (!validStatuses.includes(status)) {
      throw new AppError(
        400,
        'INVALID_STATUS',
        `Status must be one of: ${validStatuses.join(', ')}`,
      );
    }

    // Store previous status
    const previousStatus = record.status;

    // Update record
    const updated = await prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        status: status as AttendanceStatus,
        note: note ?? record.note,
      },
    });

    // Log to AuditService
    await auditService.log({
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

    return updated;
  }

  /**
   * Sync offline attendance records.
   * For each record: check if a server record exists for the same session+student.
   * Conflict resolution: server timestamp > offline → keep server; else → upsert offline.
   * Logs every conflict to AuditService.
   */
  async syncOfflineRecords(
    schoolId: string,
    records: OfflineAttendanceRecord[],
  ): Promise<SyncResult> {
    const synced: string[] = [];
    const conflicts: ConflictResult[] = [];

    for (const offlineRecord of records) {
      const existing = await prisma.attendanceRecord.findUnique({
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
          const conflict: ConflictResult = {
            recordId: existing.id,
            resolution: 'server_wins',
            offlineRecord,
            serverRecord: {
              id: existing.id,
              sessionId: existing.sessionId,
              studentId: existing.studentId,
              status: existing.status as AttendanceStatus,
              method: existing.method,
              note: existing.note ?? undefined,
              scannedAt: existing.scannedAt.toISOString(),
              synced: true,
            },
          };
          conflicts.push(conflict);

          // Log conflict to audit
          await auditService.log({
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
        } else {
          // Offline wins — upsert with offline data
          await prisma.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              status: offlineRecord.status as AttendanceStatus,
              method: offlineRecord.method,
              note: offlineRecord.note,
              scannedAt: new Date(offlineRecord.scannedAt),
              syncedAt: new Date(),
            },
          });

          const conflict: ConflictResult = {
            recordId: existing.id,
            resolution: 'offline_wins',
            offlineRecord,
            serverRecord: {
              id: existing.id,
              sessionId: existing.sessionId,
              studentId: existing.studentId,
              status: existing.status as AttendanceStatus,
              method: existing.method,
              note: existing.note ?? undefined,
              scannedAt: existing.scannedAt.toISOString(),
              synced: true,
            },
          };
          conflicts.push(conflict);

          // Log conflict to audit
          await auditService.log({
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
      } else {
        // No conflict — create new record from offline data
        const newRecord = await prisma.attendanceRecord.create({
          data: {
            id: createId(),
            schoolId,
            sessionId: offlineRecord.sessionId,
            studentId: offlineRecord.studentId,
            status: offlineRecord.status as AttendanceStatus,
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

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const attendanceService = new AttendanceService();
