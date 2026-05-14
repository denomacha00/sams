"use strict";
// ─── Enums ───────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentStatus = exports.AuditEventType = exports.RiskLevel = exports.AttendanceStatus = exports.UserRole = exports.PlanTier = void 0;
var PlanTier;
(function (PlanTier) {
    PlanTier["TRIAL"] = "TRIAL";
    PlanTier["BASIC"] = "BASIC";
    PlanTier["PROFESSIONAL"] = "PROFESSIONAL";
    PlanTier["ENTERPRISE"] = "ENTERPRISE";
})(PlanTier || (exports.PlanTier = PlanTier = {}));
var UserRole;
(function (UserRole) {
    UserRole["SUPER_ADMIN"] = "SUPER_ADMIN";
    UserRole["SCHOOL_ADMIN"] = "SCHOOL_ADMIN";
    UserRole["HOD"] = "HOD";
    UserRole["TEACHER"] = "TEACHER";
    UserRole["STUDENT"] = "STUDENT";
})(UserRole || (exports.UserRole = UserRole = {}));
var AttendanceStatus;
(function (AttendanceStatus) {
    AttendanceStatus["PRESENT"] = "PRESENT";
    AttendanceStatus["LATE"] = "LATE";
    AttendanceStatus["EXCUSED"] = "EXCUSED";
    AttendanceStatus["ABSENT"] = "ABSENT";
})(AttendanceStatus || (exports.AttendanceStatus = AttendanceStatus = {}));
var RiskLevel;
(function (RiskLevel) {
    RiskLevel["LOW"] = "LOW";
    RiskLevel["MEDIUM"] = "MEDIUM";
    RiskLevel["HIGH"] = "HIGH";
    RiskLevel["CRITICAL"] = "CRITICAL";
})(RiskLevel || (exports.RiskLevel = RiskLevel = {}));
var AuditEventType;
(function (AuditEventType) {
    AuditEventType["USER_LOGIN"] = "USER_LOGIN";
    AuditEventType["USER_LOGOUT"] = "USER_LOGOUT";
    AuditEventType["LICENSE_ACTIVATION"] = "LICENSE_ACTIVATION";
    AuditEventType["ATTENDANCE_CREATED"] = "ATTENDANCE_CREATED";
    AuditEventType["ATTENDANCE_UPDATED"] = "ATTENDANCE_UPDATED";
    AuditEventType["PAYMENT_INITIATED"] = "PAYMENT_INITIATED";
    AuditEventType["PAYMENT_SUCCESS"] = "PAYMENT_SUCCESS";
    AuditEventType["PAYMENT_FAILED"] = "PAYMENT_FAILED";
    AuditEventType["SCHOOL_SUSPENDED"] = "SCHOOL_SUSPENDED";
    AuditEventType["ROLE_CHANGED"] = "ROLE_CHANGED";
    AuditEventType["CONFLICT_RESOLVED"] = "CONFLICT_RESOLVED";
    AuditEventType["SMS_RETRY"] = "SMS_RETRY";
})(AuditEventType || (exports.AuditEventType = AuditEventType = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PENDING"] = "PENDING";
    PaymentStatus["SUCCESS"] = "SUCCESS";
    PaymentStatus["FAILED"] = "FAILED";
    PaymentStatus["CANCELLED"] = "CANCELLED";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
//# sourceMappingURL=index.js.map