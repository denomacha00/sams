"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.hodActions = void 0;
// ─── Handlers ─────────────────────────────────────────────────────────────────
const addTeacherHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const teacherName = params.teacherName;
    if (!teacherName)
        return { answer: 'Please provide the teacher name.' };
    if (!scope.departmentId) {
        return { answer: 'Your account is not associated with a department.' };
    }
    const teacher = await prisma.user.findFirst({
        where: {
            schoolId: scope.schoolId,
            role: 'TEACHER',
            fullName: { contains: teacherName, mode: 'insensitive' },
        },
    });
    if (!teacher)
        return { answer: `Teacher "${teacherName}" not found in your school.` };
    await prisma.user.update({
        where: { id: teacher.id },
        data: { departmentId: scope.departmentId },
    });
    return {
        answer: `✅ Teacher "${teacher.fullName}" assigned to your department.`,
        data: { teacherId: teacher.id, departmentId: scope.departmentId },
    };
};
const viewDepartmentStatsHandler = async (_params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    if (!scope.departmentId) {
        return { answer: 'Your account is not associated with a department.' };
    }
    const [teacherCount, classCount] = await Promise.all([
        prisma.user.count({
            where: { schoolId: scope.schoolId, departmentId: scope.departmentId, role: 'TEACHER' },
        }),
        prisma.class.count({
            where: { schoolId: scope.schoolId, departmentId: scope.departmentId },
        }),
    ]);
    return {
        answer: `📊 **Department Stats**\n\n• Teachers: ${teacherCount}\n• Classes: ${classCount}`,
        data: { teacherCount, classCount, departmentId: scope.departmentId },
    };
};
// ─── Action Definitions ───────────────────────────────────────────────────────
exports.hodActions = [
    {
        action: 'add_teacher',
        description: 'Assign a teacher to your department',
        destructive: false,
        patterns: [
            /add\s+teacher\s+(.+)/i,
            /assign\s+(.+)\s+to\s+(?:my\s+)?department/i,
            /add\s+(.+)\s+to\s+(?:my\s+)?department/i,
        ],
        extractParams: (_message, match) => {
            const teacherName = match && match[1] ? match[1].trim() : '';
            return { teacherName };
        },
        descriptionTemplate: (params) => `Assign teacher "${params.teacherName}" to your department.`,
        handler: addTeacherHandler,
    },
    {
        action: 'view_department_stats',
        description: 'View statistics for your department',
        destructive: false,
        patterns: [
            /department\s+stats/i,
            /my\s+department/i,
            /show\s+department\s+(?:stats|statistics|info)/i,
            /view\s+department/i,
        ],
        extractParams: () => ({}),
        descriptionTemplate: () => `View department statistics (teachers, classes, attendance).`,
        handler: viewDepartmentStatsHandler,
    },
];
//# sourceMappingURL=hodHandlers.js.map