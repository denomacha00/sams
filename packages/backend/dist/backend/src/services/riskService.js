"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskService = exports.RiskService = void 0;
const index_1 = require("../index");
const errors_1 = require("../middleware/errors");
const shared_1 = require("@sams/shared");
const notificationService_1 = require("./notificationService");
// ─── Risk Service ─────────────────────────────────────────────────────────────
class RiskService {
    /**
     * Compute risk score for a student.
     * Formula: score = A*0.4 + G*0.4 + P*0.2
     * Where:
     *   A = attendance risk (0-100, higher = more at risk)
     *   G = grade risk (0-100, placeholder — defaults to 50)
     *   P = pattern risk (0-100, based on consecutive absences)
     *
     * Classification:
     *   score < 25: LOW
     *   25 <= score < 50: MEDIUM
     *   50 <= score < 75: HIGH
     *   score >= 75: CRITICAL
     */
    async computeRiskScore(schoolId, studentId) {
        const student = await index_1.prisma.user.findUnique({
            where: { id: studentId },
            select: { id: true, schoolId: true, classId: true },
        });
        if (!student) {
            throw new errors_1.AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
        }
        if (student.schoolId !== schoolId) {
            throw new errors_1.AppError(403, 'FORBIDDEN', 'Access to this resource is not allowed');
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
        // Fetch previous risk score to detect level changes
        const previousScore = await index_1.prisma.riskScore.findUnique({
            where: { studentId },
            select: { riskLevel: true },
        });
        const previousLevel = previousScore?.riskLevel;
        // Upsert risk score in DB
        const now = new Date();
        await index_1.prisma.riskScore.upsert({
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
    async getRiskScores(schoolId, departmentId) {
        const where = { schoolId };
        if (departmentId) {
            // Get students in the department
            const students = await index_1.prisma.user.findMany({
                where: { schoolId, departmentId, role: 'STUDENT' },
                select: { id: true },
            });
            const studentIds = students.map((s) => s.id);
            const scores = await index_1.prisma.riskScore.findMany({
                where: { schoolId, studentId: { in: studentIds } },
                orderBy: { score: 'desc' },
            });
            return scores.map((s) => ({
                studentId: s.studentId,
                attendanceWeight: s.attendanceWeight,
                gradeWeight: s.gradeWeight,
                patternWeight: s.patternWeight,
                score: s.score,
                riskLevel: s.riskLevel,
                computedAt: s.computedAt,
            }));
        }
        const scores = await index_1.prisma.riskScore.findMany({
            where,
            orderBy: { score: 'desc' },
        });
        return scores.map((s) => ({
            studentId: s.studentId,
            attendanceWeight: s.attendanceWeight,
            gradeWeight: s.gradeWeight,
            patternWeight: s.patternWeight,
            score: s.score,
            riskLevel: s.riskLevel,
            computedAt: s.computedAt,
        }));
    }
    // ─── Private Helpers ────────────────────────────────────────────────────────
    /**
     * Compute attendance risk: inverse of attendance percentage.
     * 100% attendance = 0 risk, 0% attendance = 100 risk.
     */
    async _computeAttendanceRisk(studentId, schoolId, classId) {
        // Get total sessions for the student's class (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        let totalExpected = 0;
        if (classId) {
            totalExpected = await index_1.prisma.attendanceSession.count({
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
        const presentCount = await index_1.prisma.attendanceRecord.count({
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
    async _computePatternRisk(studentId) {
        // Get last 10 attendance records ordered by date
        const recentRecords = await index_1.prisma.attendanceRecord.findMany({
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
            }
            else {
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
    _classifyRisk(score) {
        if (score < 25)
            return shared_1.RiskLevel.LOW;
        if (score < 50)
            return shared_1.RiskLevel.MEDIUM;
        if (score < 75)
            return shared_1.RiskLevel.HIGH;
        return shared_1.RiskLevel.CRITICAL;
    }
    /**
     * Notify Teacher and HOD when a student's risk level changes.
     * Requirement 11.5
     */
    async _notifyRiskLevelChange(studentId, schoolId, previousLevel, newLevel, score) {
        // Get the student's details including class and department
        const student = await index_1.prisma.user.findUnique({
            where: { id: studentId },
            select: { fullName: true, classId: true, departmentId: true, admissionNumber: true },
        });
        if (!student)
            return;
        const message = `Risk level change: ${student.fullName} (${student.admissionNumber ?? 'N/A'}) moved from ${previousLevel} to ${newLevel} (score: ${score.toFixed(1)})`;
        // Find the student's Teacher (teacher assigned to the student's class)
        if (student.classId) {
            const teachers = await index_1.prisma.user.findMany({
                where: { schoolId, classId: student.classId, role: 'TEACHER' },
                select: { id: true },
            });
            for (const teacher of teachers) {
                await notificationService_1.notificationService.sendInApp(teacher.id, {
                    title: 'Student Risk Level Changed',
                    message,
                    type: 'RISK_ALERT',
                });
            }
        }
        // Find the HOD for the student's department
        if (student.departmentId) {
            const hods = await index_1.prisma.user.findMany({
                where: { schoolId, departmentId: student.departmentId, role: 'HOD' },
                select: { id: true },
            });
            for (const hod of hods) {
                await notificationService_1.notificationService.sendInApp(hod.id, {
                    title: 'Student Risk Level Changed',
                    message,
                    type: 'RISK_ALERT',
                });
            }
        }
    }
}
exports.RiskService = RiskService;
// ─── Singleton Export ─────────────────────────────────────────────────────────
exports.riskService = new RiskService();
//# sourceMappingURL=riskService.js.map