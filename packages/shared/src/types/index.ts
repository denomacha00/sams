// ─── Enums ───────────────────────────────────────────────────────────────────

export enum PlanTier {
  TRIAL = 'TRIAL',
  BASIC = 'BASIC',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SCHOOL_ADMIN = 'SCHOOL_ADMIN',
  HOD = 'HOD',
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  LATE = 'LATE',
  EXCUSED = 'EXCUSED',
  ABSENT = 'ABSENT',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum AuditEventType {
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  LICENSE_ACTIVATION = 'LICENSE_ACTIVATION',
  ATTENDANCE_CREATED = 'ATTENDANCE_CREATED',
  ATTENDANCE_UPDATED = 'ATTENDANCE_UPDATED',
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SCHOOL_SUSPENDED = 'SCHOOL_SUSPENDED',
  ROLE_CHANGED = 'ROLE_CHANGED',
  CONFLICT_RESOLVED = 'CONFLICT_RESOLVED',
  SMS_RETRY = 'SMS_RETRY',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ─── Shared DTOs ─────────────────────────────────────────────────────────────

export interface GpsCoords {
  lat: number;
  lng: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string;
  schoolId: string;
  role: UserRole;
  departmentId?: string;
  classId?: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface QRPayload {
  sessionId: string;
  nonce: string;
  iat: number;
  exp: number;
}

export interface LicensePayload {
  schoolName: string;
  planTier: PlanTier;
  expiresAt: Date;
}

export interface OfflineAttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  method: string;
  note?: string;
  scannedAt: string;
  synced: boolean;
  conflictResolution?: 'server_wins' | 'offline_wins';
}

export interface SyncResult {
  synced: string[];
  conflicts: ConflictResult[];
}

export interface ConflictResult {
  recordId: string;
  resolution: 'server_wins' | 'offline_wins';
  offlineRecord: OfflineAttendanceRecord;
  serverRecord: OfflineAttendanceRecord;
}

export interface BiometricMatch {
  studentId: string;
  confidence: number;
}

export interface EncryptedTemplate {
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface CachedTemplate {
  studentId: string;
  classId: string;
  encryptedData: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

export interface CachedSession {
  sessionId: string;
  classId: string;
  teacherId: string;
  subject: string;
  startedAt: string;
  lateThresholdMin: number;
  locationLat?: number;
  locationLng?: number;
  locationRadiusM: number;
}

export interface CachedStudent {
  studentId: string;
  classId: string;
  fullName: string;
  admissionNumber?: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface StudentReport {
  studentId: string;
  totalExpected: number;
  totalPresent: number;
  totalLate: number;
  totalExcused: number;
  totalAbsent: number;
  attendancePercentage: number;
}

export interface ClassReport {
  classId: string;
  students: StudentReport[];
  averageAttendancePercentage: number;
}

export interface DepartmentReport {
  departmentId: string;
  classes: ClassReport[];
  averageAttendancePercentage: number;
}

export interface SchoolReport {
  schoolId: string;
  departments: DepartmentReport[];
  averageAttendancePercentage: number;
}

export interface RiskScore {
  studentId: string;
  attendanceWeight: number;
  gradeWeight: number;
  patternWeight: number;
  score: number;
  riskLevel: RiskLevel;
  computedAt: Date;
}

export interface RiskScope {
  schoolId: string;
  departmentId?: string;
}

export interface AuditEvent {
  eventType: AuditEventType;
  actorId?: string;
  actorRole?: UserRole;
  schoolId?: string;
  resourceSnapshot: Record<string, unknown>;
}

export interface AuditFilters {
  schoolId?: string;
  eventType?: AuditEventType;
  from?: Date;
  to?: Date;
}

export interface InAppNotification {
  title: string;
  message: string;
  createdAt: Date;
}

export interface STKPushResponse {
  checkoutRequestId: string;
  message: string;
}

export interface MpesaCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
}

export interface Invoice {
  id: string;
  schoolId: string;
  amount: number;
  planTier: PlanTier;
  mpesaReceiptNumber?: string;
  completedAt: Date;
  invoiceUrl?: string;
}

export interface AIResponse {
  answer: string;
  data?: unknown;
}

export interface UserContext {
  userId: string;
  role: UserRole;
  schoolId: string;
  departmentId?: string;
  classId?: string;
}
