"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.riskScoresRouter = void 0;
const express_1 = require("express");
const shared_1 = require("@sams/shared");
const rbac_1 = require("../middleware/rbac");
const riskService_1 = require("../services/riskService");
const errors_1 = require("../middleware/errors");
// ─── Router ───────────────────────────────────────────────────────────────────
exports.riskScoresRouter = (0, express_1.Router)();
/**
 * GET /api/v1/risk-scores
 * List risk scores scoped to the requesting user's permitted scope.
 * - School Admin: all scores for the school (optionally filtered by departmentId query param)
 * - HOD: automatically scoped to the HOD's department
 * Requirement 11.3
 */
exports.riskScoresRouter.get('/', (0, rbac_1.requirePermission)('view:risk'), async (req, res) => {
    try {
        let departmentId = req.query.departmentId;
        // HOD users are automatically scoped to their own department
        if (req.user.role === shared_1.UserRole.HOD) {
            departmentId = req.user.departmentId;
        }
        const scores = await riskService_1.riskService.getRiskScores(req.schoolId, departmentId);
        res.status(200).json(scores);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get risk scores');
    }
});
/**
 * GET /api/v1/risk-scores/:studentId
 * Get or compute risk score for a specific student.
 * Enforces school scoping via RiskService (returns 403 if student belongs to another school).
 * Requirement 11.3
 */
exports.riskScoresRouter.get('/:studentId', (0, rbac_1.requirePermission)('view:risk'), async (req, res) => {
    try {
        const score = await riskService_1.riskService.computeRiskScore(req.schoolId, req.params.studentId);
        res.status(200).json(score);
    }
    catch (err) {
        if (err instanceof errors_1.AppError)
            throw err;
        throw new errors_1.AppError(500, 'INTERNAL_ERROR', 'Failed to get risk score');
    }
});
//# sourceMappingURL=riskScores.js.map