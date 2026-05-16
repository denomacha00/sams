import { RiskLevel } from '@sams/shared';
export interface RiskScoreResult {
    studentId: string;
    attendanceWeight: number;
    gradeWeight: number;
    patternWeight: number;
    score: number;
    riskLevel: RiskLevel;
    computedAt: Date;
}
export declare class RiskService {
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
    computeRiskScore(schoolId: string, studentId: string): Promise<RiskScoreResult>;
    /**
     * Get risk scores for a school, optionally filtered by department.
     */
    getRiskScores(schoolId: string, departmentId?: string): Promise<RiskScoreResult[]>;
    /**
     * Compute attendance risk: inverse of attendance percentage.
     * 100% attendance = 0 risk, 0% attendance = 100 risk.
     */
    private _computeAttendanceRisk;
    /**
     * Compute pattern risk based on consecutive recent absences.
     * 0 consecutive = 0, 1 = 20, 2 = 40, 3 = 60, 4 = 80, 5+ = 100
     */
    private _computePatternRisk;
    /**
     * Classify risk level based on score.
     * LOW: score < 25
     * MEDIUM: 25 <= score < 50
     * HIGH: 50 <= score < 75
     * CRITICAL: score >= 75
     */
    private _classifyRisk;
    /**
     * Notify Teacher and HOD when a student's risk level changes.
     * Requirement 11.5
     */
    private _notifyRiskLevelChange;
}
export declare const riskService: RiskService;
//# sourceMappingURL=riskService.d.ts.map