import cron from 'node-cron';
import { prisma } from '../index';
import { notificationService } from '../services/notificationService';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Minimum attendance percentage before triggering an alert. Configurable via env. */
const ATTENDANCE_THRESHOLD = parseFloat(
  process.env.ATTENDANCE_THRESHOLD_PERCENT ?? '75',
);

/** Number of days before license expiry to start sending reminders. */
const LICENSE_EXPIRY_WARNING_DAYS = parseInt(
  process.env.LICENSE_EXPIRY_WARNING_DAYS ?? '7',
  10,
);

// ─── Cron Task Reference ──────────────────────────────────────────────────────

let task: cron.ScheduledTask | null = null;

// ─── Low Attendance Check ─────────────────────────────────────────────────────

/**
 * Find students whose attendance percentage is below the configured threshold
 * and send SMS + in-app notifications to the student's Teacher and HOD.
 *
 * Attendance percentage = (PRESENT + LATE records) / (total records) * 100
 *
 * Requirements: 18.1
 */
export async function checkLowAttendance(): Promise<void> {
  try {
    // Get all students grouped by school
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        schoolId: true,
        classId: true,
        departmentId: true,
      },
    });

    for (const student of students) {
      // Count total attendance records for this student
      const totalRecords = await prisma.attendanceRecord.count({
        where: { studentId: student.id },
      });

      if (totalRecords === 0) {
        continue; // No records yet, skip
      }

      // Count present records (PRESENT + LATE count as attended)
      const presentRecords = await prisma.attendanceRecord.count({
        where: {
          studentId: student.id,
          status: { in: ['PRESENT', 'LATE'] },
        },
      });

      const attendancePercentage = (presentRecords / totalRecords) * 100;

      if (attendancePercentage < ATTENDANCE_THRESHOLD) {
        // Send SMS to student's phone if available
        if (student.phone) {
          void notificationService.sendSMS(
            student.phone,
            `SAMS Alert: Your attendance is at ${attendancePercentage.toFixed(1)}%, which is below the required ${ATTENDANCE_THRESHOLD}%. Please improve your attendance.`,
          );
        }

        // Send in-app notification to the student's Teacher(s)
        if (student.classId) {
          const teachers = await prisma.user.findMany({
            where: {
              schoolId: student.schoolId,
              classId: student.classId,
              role: 'TEACHER',
            },
            select: { id: true },
          });

          for (const teacher of teachers) {
            void notificationService.sendInApp(teacher.id, {
              title: 'Low Attendance Alert',
              message: `Student ${student.fullName} has attendance at ${attendancePercentage.toFixed(1)}% (below ${ATTENDANCE_THRESHOLD}% threshold).`,
              type: 'LOW_ATTENDANCE',
            });
          }
        }

        // Send in-app notification to the student's HOD
        if (student.departmentId) {
          const hods = await prisma.user.findMany({
            where: {
              schoolId: student.schoolId,
              departmentId: student.departmentId,
              role: 'HOD',
            },
            select: { id: true },
          });

          for (const hod of hods) {
            void notificationService.sendInApp(hod.id, {
              title: 'Low Attendance Alert',
              message: `Student ${student.fullName} has attendance at ${attendancePercentage.toFixed(1)}% (below ${ATTENDANCE_THRESHOLD}% threshold).`,
              type: 'LOW_ATTENDANCE',
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Notifications] Error checking low attendance:', err);
  }
}

// ─── License Expiry Check ─────────────────────────────────────────────────────

/**
 * Find schools whose license expires within the configured warning window
 * and send a daily email reminder to the School Admin.
 *
 * Requirements: 18.2
 */
export async function checkLicenseExpiry(): Promise<void> {
  try {
    const now = new Date();
    const warningDate = new Date(
      now.getTime() + LICENSE_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
    );

    // Find schools with license expiring between now and the warning window
    const expiringSchools = await prisma.school.findMany({
      where: {
        licenseExpiresAt: {
          gte: now,
          lte: warningDate,
        },
        isSuspended: false,
      },
      select: {
        id: true,
        name: true,
        licenseExpiresAt: true,
      },
    });

    for (const school of expiringSchools) {
      // Find the School Admin for this school
      const schoolAdmin = await prisma.user.findFirst({
        where: {
          schoolId: school.id,
          role: 'SCHOOL_ADMIN',
        },
        select: { id: true, email: true, fullName: true },
      });

      if (schoolAdmin?.email) {
        const daysRemaining = Math.ceil(
          (school.licenseExpiresAt.getTime() - now.getTime()) /
            (24 * 60 * 60 * 1000),
        );

        void notificationService.sendEmail(
          schoolAdmin.email,
          `SAMS License Expiry Reminder - ${school.name}`,
          `<h2>License Expiry Reminder</h2>
           <p>Dear ${schoolAdmin.fullName},</p>
           <p>Your SAMS license for <strong>${school.name}</strong> will expire in <strong>${daysRemaining} day(s)</strong> on ${school.licenseExpiresAt.toLocaleDateString()}.</p>
           <p>Please renew your subscription to avoid service interruption. Once expired, your school will be placed in read-only mode.</p>
           <p>Visit your dashboard to renew now.</p>
           <br/>
           <p>— SAMS Team</p>`,
        );
      }
    }
  } catch (err) {
    console.error('[Notifications] Error checking license expiry:', err);
  }
}

// ─── Combined Daily Job ───────────────────────────────────────────────────────

/**
 * Run all daily notification checks.
 * Called by the cron scheduler at the configured time.
 */
export async function runDailyNotificationChecks(): Promise<void> {
  console.log('[Notifications] Running daily notification checks...');
  await checkLowAttendance();
  await checkLicenseExpiry();
  console.log('[Notifications] Daily notification checks complete.');
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start the notification cron job. Runs daily at 6:00 AM.
 * Safe to call multiple times — will not create duplicate schedules.
 */
export function startNotificationJob(): void {
  if (task) {
    return; // Already running
  }

  // Run daily at 6:00 AM server time
  task = cron.schedule('0 6 * * *', () => {
    void runDailyNotificationChecks();
  });

  console.log('[Notifications] Cron job started (daily at 06:00)');
}

/**
 * Stop the notification cron job. Useful for graceful shutdown and testing.
 */
export function stopNotificationJob(): void {
  if (task) {
    task.stop();
    task = null;
    console.log('[Notifications] Cron job stopped');
  }
}
