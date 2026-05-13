import { prisma } from '../index';
import { AppError } from '../middleware/errors';
import { RiskLevel } from '@sams/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskScoreResult {
  studentId: string;
  attendanceWeight: number;
  gradeWeight: number;
  patternWeight: number;
  score: number;
  riskLevel: RiskLevel;
  computedAt: Date;
}

// ─── Risk Service ─────────────────────────────────────────────────────────────

export class RiskService {
  /**
   * Compute risk score for a student.
   * Formula: score = A*0.4 + G*0.4 + P*0.2
   * Where:
   *   A = attendance risk (0-100, higher = more at risk)
   *   G = grade risk (0-100, placeholder — defaults to 50)
   *   P = pattern risk (0-100, based on consecutive absences)
   *
   * Classification:
   *   0-25: LOW
   *   26-50: MEDIUM
   *   51-75: HIGH
   *   76-100: CRITICAL
   */
  async computeRiskScore(schoolId: string, studentId: string): Promise<RiskScoreResult> {
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, schoolId: true, classId: true },
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    if (student.schoolId !== schoolId) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
    }

    // Calculate attendance risk (A)
    const attendanceWeight = await this._computeAttendanceRisk(studentId, schoolId, student.classId);

    // Grade risk (G) — placeholder, defaults to 50 (neutral)
    const gradeWeight = 50;

    // Pattern risk (P) — based on recent consecutive absences
    const patternWeight = await this._computePatternRisk(studentId);

    // Composite score
    const score = Math.round((attendanceWeight * 0.4 + gradeWeight * 0.4 + patternWeight * 0.2) * 100) / 100;

    // Classify risk level
    const riskLevel = this._classifyRisk(score);

    // Upsert risk score in DB
    const now = new Date();
    await prisma.riskScore.upsert({
      where: { studentId },
      create: {
        schoolId,
        studentId,
        attendanceWeight,
        gradeWeight,
        patternWeight,
        score,
        riskLevel,
        computedAt: now,
      },
      update: {
        attendanceWeight,
        gradeWeight,
        patternWeight,
        score,
        riskLevel,
        computedAt: now,
      },
    });

    return {
      studentId,
      attendanceWeight,
      gradeWeight,
      patternWeight,
      score,
      riskLevel,
      computedAt: now,
    };
  }

  /**
   * Get risk scores for a school, optionally filtered by department.
   */
  async getRiskScores(schoolId: string, departmentId?: string): Promise<RiskScoreResult[]> {
    const where: Record<string, unknown> = { schoolId };

    if (departmentId) {
      // Get students in the department
      const students = await prisma.user.findMany({
        where: { schoolId, departmentId, role: 'STUDENT' },
        select: { id: true },
      });

      const studentIds = students.map((s) => s.id);

      const scores = await prisma.riskScore.findMany({
        where: { schoolId, studentId: { in: studentIds } },
        orderBy: { score: 'desc' },
      });

      return scores.map((s) => ({
        studentId: s.studentId,
        attendanceWeight: s.attendanceWeight,
        gradeWeight: s.gradeWeight,
        patternWeight: s.patternWeight,
        score: s.score,
        riskLevel: s.riskLevel as RiskLevel,
        computedAt: s.computedAt,
      }));
    }

    const scores = await prisma.riskScore.findMany({
      where,
      orderBy: { score: 'desc' },
    });

    return scores.map((s) => ({
      studentId: s.studentId,
      attendanceWeight: s.attendanceWeight,
      gradeWeight: s.gradeWeight,
      patternWeight: s.patternWeight,
      score: s.score,
      riskLevel: s.riskLevel as RiskLevel,
      computedAt: s.computedAt,
    }));
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Compute attendance risk: inverse of attendance percentage.
   * 100% attendance = 0 risk, 0% attendance = 100 risk.
   */
  private async _computeAttendanceRisk(studentId: string, schoolId: string, classId: string | null): Promise<number> {
    // Get total sessions for the student's class (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let totalExpected = 0;
    if (classId) {
      totalExpected = await prisma.attendanceSession.count({
        where: {
          schoolId,
          classId,
          startedAt: { gte: thirtyDaysAgo },
        },
      });
    }

    if (totalExpected === 0) {
      return 0; // No sessions = no risk data
    }

    // Count present records
    const presentCount = await prisma.attendanceRecord.count({
      where: {
        studentId,
        schoolId,
        status: { in: ['PRESENT', 'LATE'] },
        scannedAt: { gte: thirtyDaysAgo },
      },
    });

    const attendanceRate = presentCount / totalExpected;
    // Invert: high attendance = low risk
    return Math.round((1 - attendanceRate) * 100);
  }

  /**
   * Compute pattern risk based on consecutive recent absences.
   * 0 consecutive = 0, 1 = 20, 2 = 40, 3 = 60, 4 = 80, 5+ = 100
   */
  private async _computePatternRisk(studentId: string): Promise<number> {
    // Get last 10 attendance records ordered by date
    const recentRecords = await prisma.attendanceRecord.findMany({
      where: { studentId },
      orderBy: { scannedAt: 'desc' },
      take: 10,
      select: { status: true },
    });

    // Count consecutive absences from most recent
    let consecutiveAbsences = 0;
    for (const record of recentRecords) {
      if (record.status === 'ABSENT') {
        consecutiveAbsences++;
      } else {
        break;
      }
    }

    // Map to 0-100 scale
    return Math.min(consecutiveAbsences * 20, 100);
  }

  /**
   * Classify risk level based on score.
   */
  private _classifyRisk(score: number): RiskLevel {
    if (score <= 25) return RiskLevel.LOW;
    if (score <= 50) return RiskLevel.MEDIUM;
    if (score <= 75) return RiskLevel.HIGH;
    return RiskLevel.CRITICAL;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const riskService = new RiskService();
