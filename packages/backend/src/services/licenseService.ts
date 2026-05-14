import { PlanTier } from '@sams/shared';
import { prisma } from '../index';
import { auditService } from './auditService';
import { notificationService } from './notificationService';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of students allowed per plan tier.
 * Requirements: 12.1
 */
const PLAN_STUDENT_LIMITS: Record<PlanTier, number> = {
  TRIAL: 50,
  BASIC: 500,
  PROFESSIONAL: 2000,
  ENTERPRISE: Infinity,
};

/**
 * Features and the plan tiers that have access to them.
 * Requirements: 12.2, 12.3, 12.4, 12.5
 */
const FEATURE_ACCESS: Record<string, PlanTier[]> = {
  biometric: [PlanTier.PROFESSIONAL, PlanTier.ENTERPRISE],
  ai: [PlanTier.PROFESSIONAL, PlanTier.ENTERPRISE],
  api_access: [PlanTier.BASIC, PlanTier.PROFESSIONAL, PlanTier.ENTERPRISE],
  custom_branding: [PlanTier.ENTERPRISE],
};

// ─── Error Helper ─────────────────────────────────────────────────────────────

/**
 * Lightweight application error with a machine-readable code and HTTP status.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ─── License Service ──────────────────────────────────────────────────────────

export class LicenseService {
  /**
   * Check whether the school has reached its plan tier student limit.
   * Counts all users with role STUDENT in the given school and compares
   * against the tier's maximum. Throws AppError 422 PLAN_LIMIT_REACHED
   * if the limit has been reached.
   *
   * Requirements: 12.1, 12.6
   */
  async checkStudentLimit(schoolId: string): Promise<void> {
    const school = await prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { planTier: true },
    });

    const studentCount = await prisma.user.count({
      where: {
        schoolId,
        role: 'STUDENT',
      },
    });

    const limit = PLAN_STUDENT_LIMITS[school.planTier];

    if (studentCount >= limit) {
      // Notify School Admin(s) about the limit being reached
      const schoolAdmins = await prisma.user.findMany({
        where: { schoolId, role: 'SCHOOL_ADMIN' },
        select: { id: true, email: true },
      });

      for (const admin of schoolAdmins) {
        await notificationService.sendInApp(admin.id, {
          title: 'Student Limit Reached',
          message: `Your school has reached the ${school.planTier} plan limit of ${limit} students. Please upgrade your plan to add more students.`,
          type: 'PLAN_LIMIT_REACHED',
        });

        if (admin.email) {
          await notificationService.sendEmail(
            admin.email,
            'SAMS: Student Limit Reached — Upgrade Required',
            `<p>Your school has reached the maximum student count of <strong>${limit}</strong> for the <strong>${school.planTier}</strong> plan.</p>
             <p>Please upgrade your subscription to add more students.</p>`,
          );
        }
      }

      throw new AppError(
        'PLAN_LIMIT_REACHED',
        `Student limit of ${limit} reached for ${school.planTier} plan. Please upgrade to add more students.`,
        422,
      );
    }
  }

  /**
   * Check whether the school's plan tier grants access to a specific feature.
   * Returns true if the school's tier is in the feature's allowed tiers list,
   * false otherwise.
   *
   * Requirements: 12.2, 12.3, 12.4, 12.5
   */
  async checkFeatureAccess(
    schoolId: string,
    feature: 'biometric' | 'ai' | 'api_access' | 'custom_branding',
  ): Promise<boolean> {
    const school = await prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { planTier: true },
    });

    const allowedTiers = FEATURE_ACCESS[feature] ?? [];
    return allowedTiers.includes(school.planTier as PlanTier);
  }

  /**
   * Check whether the school's license has expired.
   * If licenseExpiresAt < now, sets isReadOnly=true on the school and
   * notifies the School Admin(s) via NotificationService.
   *
   * Requirements: 12.7
   */
  async checkLicenseExpiry(schoolId: string): Promise<void> {
    const school = await prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { licenseExpiresAt: true, isReadOnly: true, name: true },
    });

    const now = new Date();

    if (school.licenseExpiresAt < now) {
      // Only update and notify if not already in read-only mode
      if (!school.isReadOnly) {
        await prisma.school.update({
          where: { id: schoolId },
          data: { isReadOnly: true },
        });

        // Notify School Admin(s)
        const schoolAdmins = await prisma.user.findMany({
          where: { schoolId, role: 'SCHOOL_ADMIN' },
          select: { id: true, email: true },
        });

        for (const admin of schoolAdmins) {
          await notificationService.sendInApp(admin.id, {
            title: 'License Expired',
            message: `Your school's license expired on ${school.licenseExpiresAt.toLocaleDateString()}. The school is now in read-only mode. Please renew your subscription to restore full access.`,
            type: 'LICENSE_EXPIRED',
          });

          if (admin.email) {
            await notificationService.sendEmail(
              admin.email,
              'SAMS: License Expired — Renewal Required',
              `<p>Your school's SAMS license expired on <strong>${school.licenseExpiresAt.toLocaleDateString()}</strong>.</p>
               <p>The school account has been set to <strong>read-only mode</strong>. No new attendance records or changes can be made until the license is renewed.</p>
               <p>Please contact your Super Admin or renew your subscription to restore full access.</p>`,
            );
          }
        }
      }
    }
  }

  /**
   * Suspend a school immediately.
   * Sets isSuspended=true, revokes all active AttendanceSessions (isActive=false),
   * and logs the event to AuditService.
   *
   * Requirements: 15.3
   */
  async suspendSchool(schoolId: string): Promise<void> {
    // Set school as suspended
    const school = await prisma.school.update({
      where: { id: schoolId },
      data: { isSuspended: true },
    });

    // Revoke all active sessions for this school
    await prisma.attendanceSession.updateMany({
      where: {
        schoolId,
        isActive: true,
      },
      data: { isActive: false },
    });

    // Log to AuditService
    await auditService.log({
      eventType: 'SCHOOL_SUSPENDED',
      schoolId,
      resourceSnapshot: {
        schoolId,
        schoolName: school.name,
        suspendedAt: new Date().toISOString(),
        action: 'SCHOOL_SUSPENDED',
        note: 'All active attendance sessions have been revoked.',
      },
    });
  }

  /**
   * Extend a school's license to a new expiry date.
   * Updates licenseExpiresAt, clears isReadOnly (restores full access),
   * and logs the event to AuditService.
   *
   * Requirements: 15.4
   */
  async extendLicense(schoolId: string, newExpiry: Date): Promise<void> {
    const school = await prisma.school.update({
      where: { id: schoolId },
      data: {
        licenseExpiresAt: newExpiry,
        isReadOnly: false,
      },
    });

    // Log to AuditService
    await auditService.log({
      eventType: 'LICENSE_ACTIVATION',
      schoolId,
      resourceSnapshot: {
        schoolId,
        schoolName: school.name,
        newLicenseExpiresAt: newExpiry.toISOString(),
        isReadOnly: false,
        action: 'LICENSE_EXTENDED',
        note: 'License extended and read-only mode cleared.',
      },
    });
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const licenseService = new LicenseService();
