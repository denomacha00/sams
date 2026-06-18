import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';
import { RiskLevel } from '@sams/shared';
import { notificationService } from './notificationService';
import { computeSubjectFinalScore } from '../lib/examScore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskScoreResult {
  studentId: string;
  studentName?: string;
  admissionNumber?: string | null;
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
   *   G = grade risk (0-100, dynamically computed from exam results, defaults to 50)
   *   P = pattern risk (0-100, based on consecutive absences)
   *
   * Classification:
   *   score < 25: LOW
   *   25 <= score < 50: MEDIUM
   *   50 <= score < 75: HIGH
   *   score >= 75: CRITICAL
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

    // Grade risk (G) — dynamically computed from exam results, defaults to 50 (neutral)
    let gradeWeight = 50;
    try {
      // Look up the active AcademicTerm for this school
      const activeTerm = await prisma.academicTerm.findFirst({
        where: { schoolId, isActive: true },
        select: { id: true },
      });

      if (activeTerm && student.classId) {
        // Find all exams for this term, class, and student's subjects (with their results)
        const exams = await prisma.exam.findMany({
          where: {
            schoolId,
            termId: activeTerm.id,
            classId: student.classId,
          },
          select: {
            id: true,
            subject: true,
            examType: true,
            maxScore: true,
            results: {
              where: { studentId },
              select: { score: true },
            },
          },
        });

        // Group exams by subject and compute final score per subject.
        const subjectScores: Record<string, Array<{ examType: string; score: number; maxScore: number }>> = {};

        for (const exam of exams) {
          if (exam.results.length === 0) continue;
          const rawScore = exam.results[0].score;
          if (!subjectScores[exam.subject]) {
            subjectScores[exam.subject] = [];
          }
          subjectScores[exam.subject].push({
            examType: exam.examType,
            score: rawScore,
            maxScore: exam.maxScore,
          });
        }

        const finalScores: number[] = [];
        for (const components of Object.values(subjectScores)) {
          finalScores.push(computeSubjectFinalScore(components).finalScore);
        }

        if (finalScores.length > 0) {
          const average = finalScores.reduce((a, b) => a + b, 0) / finalScores.length;
          // Invert: high grades = low risk (100 - average), clamp to 0-100
          gradeWeight = Math.max(0, Math.min(100, Math.round(100 - average)));
        }
      }
    } catch {
      // If exam data lookup fails, fall back to default 50
      gradeWeight = 50;
    }

    // Pattern risk (P) — based on recent consecutive absences
    const patternWeight = await this._computePatternRisk(studentId, schoolId);

    // Composite score
    const score = Math.round((attendanceWeight * 0.4 + gradeWeight * 0.4 + patternWeight * 0.2) * 100) / 100;

    // Classify risk level
    const riskLevel = this._classifyRisk(score);

    // Fetch previous risk score to detect level changes
    const previousScore = await prisma.riskScore.findUnique({
      where: { studentId },
      select: { riskLevel: true },
    });

    const previousLevel = previousScore?.riskLevel as RiskLevel | undefined;

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

    // If risk level changed, notify Teacher and HOD (Requirement 11.5)
    if (previousLevel && previousLevel !== riskLevel) {
      await this._notifyRiskLevelChange(studentId, schoolId, previousLevel, riskLevel, score);
    }

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
  async getRiskScores(
    schoolId: string,
    departmentId?: string,
    classIds?: string[],
  ): Promise<RiskScoreResult[]> {
    type RiskStudent = { id: string; fullName: string; admissionNumber: string | null };

    const mapScores = (scores: any[], studentMap: Map<string, RiskStudent>): RiskScoreResult[] =>
      scores.map((s: any) => {
        const student = studentMap.get(s.studentId);
        return {
          studentId: s.studentId,
          studentName: student?.fullName ?? 'Unknown student',
          admissionNumber: student?.admissionNumber ?? null,
          attendanceWeight: s.attendanceWeight,
          gradeWeight: s.gradeWeight,
          patternWeight: s.patternWeight,
          score: s.score,
          riskLevel: s.riskLevel as RiskLevel,
          computedAt: s.computedAt,
        };
      });

    let students: RiskStudent[];

    if (classIds) {
      if (classIds.length === 0) return [];

      students = await prisma.user.findMany({
        where: { schoolId, role: 'STUDENT', classId: { in: classIds } },
        select: { id: true, fullName: true, admissionNumber: true },
        orderBy: { fullName: 'asc' },
      });
    } else if (departmentId) {
      // Get students in the department
      students = await prisma.user.findMany({
        where: {
          schoolId,
          role: 'STUDENT',
          OR: [
            { departmentId },
            { class: { is: { departmentId } } },
          ],
        },
        select: { id: true, fullName: true, admissionNumber: true },
        orderBy: { fullName: 'asc' },
      });
    } else {
      students = await prisma.user.findMany({
        where: { schoolId, role: 'STUDENT' },
        select: { id: true, fullName: true, admissionNumber: true },
        orderBy: { fullName: 'asc' },
      });
    }

    const studentIds = students.map((s) => s.id);
    if (studentIds.length === 0) return [];
    const studentMap = new Map(students.map((student) => [student.id, student]));

    const scores = await prisma.riskScore.findMany({
      where: { schoolId, studentId: { in: studentIds } },
      orderBy: { score: 'desc' },
    });
    const existingIds = new Set(scores.map((score) => score.studentId));
    const computedScores: RiskScoreResult[] = [];

    const missingStudents = students.filter((student) => !existingIds.has(student.id));
    for (let i = 0; i < missingStudents.length; i += 8) {
      const batch = missingStudents.slice(i, i + 8);
      const batchScores = await Promise.all(
        batch.map(async (student) => {
          try {
            const score = await this.computeRiskScore(schoolId, student.id);
            return {
              ...score,
              studentName: student.fullName,
              admissionNumber: student.admissionNumber,
            };
          } catch {
            return null;
          }
        }),
      );
      for (const score of batchScores) {
        if (score) computedScores.push(score);
      }
    }

    return [...mapScores(scores, studentMap), ...computedScores]
      .sort((a, b) => b.score - a.score);
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
  private async _computePatternRisk(studentId: string, schoolId: string): Promise<number> {
    // Get last 10 attendance records ordered by date
    const recentRecords = await prisma.attendanceRecord.findMany({
      where: { studentId, schoolId },
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
   * LOW: score < 25
   * MEDIUM: 25 <= score < 50
   * HIGH: 50 <= score < 75
   * CRITICAL: score >= 75
   */
  private _classifyRisk(score: number): RiskLevel {
    if (score < 25) return RiskLevel.LOW;
    if (score < 50) return RiskLevel.MEDIUM;
    if (score < 75) return RiskLevel.HIGH;
    return RiskLevel.CRITICAL;
  }

  /**
   * Notify Teacher and HOD when a student's risk level changes.
   * Requirement 11.5. Logs the change to audit trail.
   */
  private async _notifyRiskLevelChange(
    studentId: string,
    schoolId: string,
    previousLevel: RiskLevel,
    newLevel: RiskLevel,
    score: number,
  ): Promise<void> {
    // Get the student's details including class and department
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { fullName: true, classId: true, departmentId: true, admissionNumber: true },
    });

    if (!student) return;

    const message = `Risk level change: ${student.fullName} (${student.admissionNumber ?? 'N/A'}) moved from ${previousLevel} to ${newLevel} (score: ${score.toFixed(1)})`;

    // Log to audit trail
    try {
      const { auditService } = await import('./auditService');
      await auditService.log({
        eventType: 'AI_ACTION_EXECUTED',
        schoolId,
        resourceSnapshot: {
          studentId,
          studentName: student.fullName,
          admissionNumber: student.admissionNumber,
          previousLevel,
          newLevel,
          score: score.toFixed(1),
          actor: 'system:riskService',
        },
      });
    } catch {
      // Non-critical - notifications are the priority
    }

    // Find the student's Teacher (teacher assigned to the student's class)
    if (student.classId) {
      const teachers = await prisma.user.findMany({
        where: { schoolId, classId: student.classId, role: 'TEACHER' },
        select: { id: true },
      });

      for (const teacher of teachers) {
        await notificationService.sendInApp(teacher.id, {
          title: 'Student Risk Level Changed',
          message,
          type: 'RISK_ALERT',
        });
      }
    }

    // Find the HOD for the student's department
    if (student.departmentId) {
      const hods = await prisma.user.findMany({
        where: { schoolId, departmentId: student.departmentId, role: 'HOD' },
        select: { id: true },
      });

      for (const hod of hods) {
        await notificationService.sendInApp(hod.id, {
          title: 'Student Risk Level Changed',
          message,
          type: 'RISK_ALERT',
        });
      }
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const riskService = new RiskService();
