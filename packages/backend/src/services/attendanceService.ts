import jwt from 'jsonwebtoken';
import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { auditService } from './auditService';
import { riskService } from './riskService';
import { broadcastAttendanceNew, broadcastAttendanceUpdated, broadcastSessionEnd } from '../sockets/attendanceSocket';
import { buildAttendanceEventPayload } from '../lib/attendanceEvent';
import { getQrSecret } from '../config/secrets';
import { hasSessionGpsAnchor, hasSubmittedGps, shouldEnforceSessionGps } from '../lib/attendanceGps';
import { isTimetableWindowExpired, type TimetableWindow } from '../lib/sessionWindow';
import {
  haversineDistance,
  classifyAttendanceStatus,
  AttendanceStatus,
  UserRole,
  OfflineAttendanceRecord,
  ConflictResult,
  SyncResult,
} from '@sams/shared';

// ─── Constants ────────────────────────────────────────────────────────────────


const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
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

interface LinkTokenPayload {
  sessionId: string;
  type: 'LINK';
  nonce: string;
  requireGps: boolean;
  gpsRadiusM: number;
  iat: number;
  exp: number;
}

interface AttendanceSessionScope {
  id: string;
  schoolId: string;
  classId: string;
  teacherId: string;
  class: { departmentId: string };
  isActive?: boolean;
  timetableEntry?: TimetableWindow | null;
  locationLat: number | null;
  locationLng: number | null;
  locationRadiusM: number;
}

interface AttendanceActorOptions {
  actorRole?: UserRole;
  actorDepartmentId?: string | null;
}

interface AttendanceStudentScope {
  id: string;
  schoolId: string;
  role: string;
  classId: string | null;
  isLocked: boolean;
  attendanceGpsExempt: boolean;
}

// ─── Attendance Service ───────────────────────────────────────────────────────

export class AttendanceService {
  private async ensureSessionOpen(
    session: { id: string; isActive: boolean; timetableEntry?: TimetableWindow | null },
  ): Promise<void> {
    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
    }

    if (session.timetableEntry && isTimetableWindowExpired(session.timetableEntry)) {
      await prisma.attendanceSession.update({
        where: { id: session.id },
        data: { isActive: false, endedAt: new Date() },
      });
      broadcastSessionEnd(session.id);
      throw new AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
    }
  }

  private async getStudentForSession(
    studentId: string,
    schoolId: string,
    session: { schoolId: string; classId: string },
  ): Promise<AttendanceStudentScope> {
    if (session.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Session does not belong to your school');
    }

    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        schoolId: true,
        role: true,
        classId: true,
        isLocked: true,
        attendanceGpsExempt: true,
      },
    });

    if (!student || student.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Student does not belong to your school');
    }

    if (student.role !== UserRole.STUDENT) {
      throw new AppError(403, 'STUDENT_ONLY', 'Only students can mark attendance with QR or links');
    }

    if (student.isLocked) {
      throw new AppError(403, 'USER_LOCKED', 'This student account is locked');
    }

    if (student.classId !== session.classId) {
      throw new AppError(403, 'WRONG_CLASS', 'Student does not belong to this class');
    }

    return student;
  }

  private enforceGpsForSession(
    session: { locationLat: number | null; locationLng: number | null },
    gpsCoords: { lat: number; lng: number },
    radiusM: number,
    studentGpsExempt: boolean,
  ): void {
    if (studentGpsExempt || !hasSessionGpsAnchor(session)) return;

    if (!hasSubmittedGps(gpsCoords)) {
      throw new AppError(400, 'GPS_REQUIRED', 'Location is required to mark attendance for this session');
    }

    if (shouldEnforceSessionGps(session, gpsCoords, false)) {
      const distance = haversineDistance(
        gpsCoords.lat,
        gpsCoords.lng,
        session.locationLat!,
        session.locationLng!,
      );

      if (distance > radiusM) {
        throw new AppError(
          400,
          'GPS_OUT_OF_RANGE',
          `Student is ${Math.round(distance)}m away, must be within ${radiusM}m`,
          { distance, radiusM },
        );
      }
    }
  }

  private async getOwnedSession(
    sessionId: string,
    schoolId: string,
    teacherId: string,
    actor: AttendanceActorOptions = {},
  ): Promise<AttendanceSessionScope> {
    const actorRole = actor.actorRole ?? UserRole.TEACHER;

    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        schoolId: true,
        classId: true,
        teacherId: true,
        class: { select: { departmentId: true } },
        isActive: true,
        timetableEntry: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
        locationLat: true,
        locationLng: true,
        locationRadiusM: true,
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
    }

    if (session.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Session does not belong to your school');
    }

    const canManage =
      session.teacherId === teacherId ||
      (
        actorRole === UserRole.HOD &&
        !!actor.actorDepartmentId &&
        session.class.departmentId === actor.actorDepartmentId
      );

    if (!canManage) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this attendance session');
    }

    await this.ensureSessionOpen(session);

    return session;
  }

  private async assertStudentInSession(
    studentId: string,
    schoolId: string,
    session: { schoolId: string; classId: string },
  ): Promise<AttendanceStudentScope> {
    return this.getStudentForSession(studentId, schoolId, session);
  }

  private async assertDeviceAvailableForSession(
    sessionId: string,
    studentId: string,
    deviceHash?: string | null,
  ): Promise<void> {
    if (!deviceHash) return;

    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        sessionId,
        deviceHash,
        NOT: { studentId },
      },
      select: { studentId: true },
    });

    if (existing) {
      throw new AppError(
        409,
        'DEVICE_ALREADY_USED',
        'This device has already marked attendance for another student in this session. Use your own phone/account.',
      );
    }
  }

  private async emitAttendanceNew(sessionId: string, record: { id: string; studentId: string; status: string; method: string; scannedAt: Date }): Promise<void> {
    const payload = await buildAttendanceEventPayload(record as Parameters<typeof buildAttendanceEventPayload>[0]);
    broadcastAttendanceNew(sessionId, payload);
  }

  private async emitAttendanceUpdated(sessionId: string, record: { id: string; studentId: string; status: string; method: string; scannedAt: Date }): Promise<void> {
    const payload = await buildAttendanceEventPayload(record as Parameters<typeof buildAttendanceEventPayload>[0]);
    broadcastAttendanceUpdated(sessionId, payload);
  }

  /**
   * Generate a shareable attendance link for an active session.
   * Teacher can choose whether to enforce GPS proximity check.
   */
  async generateAttendanceLink(
    sessionId: string,
    schoolId: string,
    teacherId: string,
    expiryMinutes: number = 5,
    requireGps: boolean = true,
    gpsRadiusM: number = 100,
    actor: AttendanceActorOptions = {},
  ) {
    // 1. Validate session exists, is active, and belongs to the teacher's school
    const actorRole = actor.actorRole ?? UserRole.TEACHER;
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        class: { select: { departmentId: true } },
        timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } },
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
    }

    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
    }

    if (session.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Session does not belong to your school');
    }

    const canManage =
      session.teacherId === teacherId ||
      (
        actorRole === UserRole.HOD &&
        !!actor.actorDepartmentId &&
        session.class.departmentId === actor.actorDepartmentId
      );

    if (!canManage) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this attendance session');
    }

    await this.ensureSessionOpen(session);

    const effectiveRequireGps = requireGps && hasSessionGpsAnchor(session);

    // 2. Generate JWT with type 'LINK' — embed GPS settings in the token
    const nonce = createId();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiryMinutes * 60;

    const linkToken = jwt.sign(
      { sessionId, type: 'LINK', nonce, requireGps: effectiveRequireGps, gpsRadiusM, iat: now, exp },
      getQrSecret(),
    );

    // 3. Store token and expiry on the session record
    const expiresAt = new Date(exp * 1000);

    await prisma.attendanceSession.update({
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
      requireGps: effectiveRequireGps,
      gpsRadiusM,
    };
  }

  /**
   * Record attendance via link token.
   * Validates the link JWT (type: 'LINK'), checks GPS proximity,
   * prevents duplicates, classifies status, and creates the record.
   */
  async recordLinkAttendance(
    studentId: string,
    schoolId: string,
    linkToken: string,
    gpsCoords: { lat: number; lng: number },
    deviceHash?: string | null,
  ) {
    // 1. Verify JWT signature and expiry
    let payload: LinkTokenPayload;
    try {
      payload = jwt.verify(linkToken, getQrSecret()) as LinkTokenPayload;
    } catch {
      throw new AppError(400, 'LINK_EXPIRED', 'Attendance link is expired or invalid');
    }

    // 2. Validate token has type: 'LINK' to prevent QR token reuse
    if (payload.type !== 'LINK') {
      throw new AppError(400, 'INVALID_TOKEN_TYPE', 'Invalid token type — expected a link token');
    }

    // 3. Fetch session, check isActive
    const session = await prisma.attendanceSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } },
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
    }

    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
    }

    if (session.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Session does not belong to your school');
    }

    await this.ensureSessionOpen(session);

    if (session.currentLinkToken !== linkToken) {
      throw new AppError(400, 'LINK_REVOKED', 'This attendance link has been replaced. Ask your teacher for the latest link.');
    }

    if (session.linkExpiresAt && session.linkExpiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'LINK_EXPIRED', 'Attendance link has expired');
    }

    const student = await this.getStudentForSession(studentId, schoolId, session);
    await this.assertDeviceAvailableForSession(session.id, studentId, deviceHash);

    // 4. Validate GPS proximity — only if the token requires GPS
    if (payload.requireGps) {
      this.enforceGpsForSession(session, gpsCoords, payload.gpsRadiusM, student.attendanceGpsExempt);
    }

    // 5. Check duplicate via sessionId + studentId unique constraint
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

    // 6. Classify status (PRESENT/LATE) using classifyAttendanceStatus
    const status = classifyAttendanceStatus(
      new Date(),
      session.startedAt,
      session.lateThresholdMin,
    );

    // 7. Create AttendanceRecord with method="LINK"
    const record = await prisma.attendanceRecord.create({
      data: {
        id: createId(),
        schoolId,
        sessionId: session.id,
        studentId,
        status,
        method: 'LINK',
        deviceHash,
        scannedAt: new Date(),
      },
    });

    // 8. Broadcast via WebSocket and trigger risk score recomputation
    await this.emitAttendanceNew(session.id, record);
    riskService.computeRiskScore(schoolId, studentId).catch(() => {});

    return record;
  }

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
    deviceHash?: string | null,
  ) {
    // 1. Verify QR JWT
    let payload: QRTokenPayload;
    try {
      payload = jwt.verify(qrToken, getQrSecret()) as QRTokenPayload;
    } catch {
      throw new AppError(400, 'QR_EXPIRED', 'QR code is expired or invalid');
    }

    // 2. Extract sessionId and fetch session
    const session = await prisma.attendanceSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        timetableEntry: { select: { dayOfWeek: true, startTime: true, endTime: true } },
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Attendance session not found');
    }

    if (!session.isActive) {
      throw new AppError(400, 'SESSION_ENDED', 'Attendance session has ended');
    }

    if (session.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Session does not belong to your school');
    }

    await this.ensureSessionOpen(session);

    const student = await this.getStudentForSession(studentId, schoolId, session);
    await this.assertDeviceAvailableForSession(session.id, studentId, deviceHash);

    // 3. Validate GPS proximity when session anchor is set and student has no exemption
    this.enforceGpsForSession(session, gpsCoords, session.locationRadiusM, student.attendanceGpsExempt);

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
        deviceHash,
        scannedAt: new Date(),
      },
    });

    // Broadcast new attendance to session room
    await this.emitAttendanceNew(session.id, record);

    // Fire-and-forget: recompute student risk score
    riskService.computeRiskScore(schoolId, studentId).catch(() => {});

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
    actor: AttendanceActorOptions = {},
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

    const session = await this.getOwnedSession(sessionId, schoolId, teacherId, actor);
    await this.assertStudentInSession(studentId, schoolId, session);

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
        actorRole: actor.actorRole ?? UserRole.TEACHER,
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
      await this.emitAttendanceUpdated(sessionId, updated);

      // Fire-and-forget: recompute student risk score
      riskService.computeRiskScore(schoolId, studentId).catch(() => {});

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

    // Broadcast new attendance to session room
    await this.emitAttendanceNew(sessionId, record);

    // Fire-and-forget: recompute student risk score
    riskService.computeRiskScore(schoolId, studentId).catch(() => {});

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
    actor: AttendanceActorOptions = {},
  ) {
    // Check confidence threshold
    if (confidence < BIOMETRIC_CONFIDENCE_THRESHOLD) {
      throw new AppError(
        400,
        'LOW_CONFIDENCE',
        `Biometric confidence ${confidence} is below threshold ${BIOMETRIC_CONFIDENCE_THRESHOLD}`,
      );
    }

    const session = await this.getOwnedSession(sessionId, schoolId, teacherId, actor);
    await this.assertStudentInSession(studentId, schoolId, session);

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

    // Broadcast new attendance to session room
    await this.emitAttendanceNew(sessionId, record);

    // Fire-and-forget: recompute student risk score
    riskService.computeRiskScore(schoolId, studentId).catch(() => {});

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
    actor: AttendanceActorOptions = {},
  ) {
    // Fetch record and assert school ownership
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        session: {
          select: {
            id: true,
            schoolId: true,
            classId: true,
            teacherId: true,
            class: { select: { departmentId: true } },
            locationLat: true,
            locationLng: true,
            locationRadiusM: true,
          },
        },
      },
    });

    if (!record) {
      throw new AppError(404, 'RECORD_NOT_FOUND', 'Attendance record not found');
    }

    if (record.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Record does not belong to this school');
    }

    const actorRole = actor.actorRole ?? UserRole.TEACHER;
    const canManage =
      record.session.teacherId === teacherId ||
      (
        actorRole === UserRole.HOD &&
        !!actor.actorDepartmentId &&
        record.session.class.departmentId === actor.actorDepartmentId
      );

    if (!canManage) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this attendance session');
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
      actorRole,
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
    await this.emitAttendanceUpdated(record.sessionId, updated);

    // Fire-and-forget: recompute student risk score
    riskService.computeRiskScore(schoolId, record.studentId).catch(() => {});

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
    teacherId: string,
    records: OfflineAttendanceRecord[],
    actor: AttendanceActorOptions = {},
  ): Promise<SyncResult> {
    const synced: string[] = [];
    const conflicts: ConflictResult[] = [];

    for (const offlineRecord of records) {
      const session = await this.getOwnedSession(offlineRecord.sessionId, schoolId, teacherId, actor);
      await this.assertStudentInSession(offlineRecord.studentId, schoolId, session);

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
