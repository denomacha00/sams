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
exports.studentActions = void 0;
// ─── Handlers ─────────────────────────────────────────────────────────────────
const viewAttendanceHandler = async (_params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const records = await prisma.attendanceRecord.findMany({
        where: { studentId: scope.userId, schoolId: scope.schoolId },
        orderBy: { scannedAt: 'desc' },
        take: 20,
        include: { session: { select: { subject: true } } },
    });
    if (records.length === 0) {
        return { answer: 'No attendance records found.' };
    }
    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    const percentage = ((present / total) * 100).toFixed(1);
    const recent = records.slice(0, 5).map((r) => {
        const date = r.scannedAt.toLocaleDateString();
        return `• ${date} — ${r.session?.subject || 'General'}: ${r.status}`;
    });
    return {
        answer: `📊 **Your Attendance**\n\nOverall: ${percentage}% (${present}/${total} sessions)\n\n**Recent:**\n${recent.join('\n')}`,
        data: { percentage: parseFloat(percentage), total, present, records: records.length },
    };
};
const viewTimetableHandler = async (_params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    if (!scope.classId) {
        return { answer: 'Your account is not associated with a class.' };
    }
    const timetable = await prisma.timetableEntry.findMany({
        where: { classId: scope.classId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    if (timetable.length === 0) {
        return { answer: 'No timetable entries found for your class.' };
    }
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const grouped = timetable.reduce((acc, entry) => {
        const day = days[entry.dayOfWeek - 1] || `Day ${entry.dayOfWeek}`;
        if (!acc[day])
            acc[day] = [];
        acc[day].push(`${entry.startTime}–${entry.endTime}: ${entry.subject}`);
        return acc;
    }, {});
    const formatted = Object.entries(grouped)
        .map(([day, entries]) => `**${day}**\n${entries.map((e) => `  • ${e}`).join('\n')}`)
        .join('\n\n');
    return {
        answer: `📅 **Your Timetable**\n\n${formatted}`,
        data: { classId: scope.classId, entryCount: timetable.length },
    };
};
// ─── Action Definitions ───────────────────────────────────────────────────────
exports.studentActions = [
    {
        action: 'view_attendance',
        description: 'View your own attendance records and percentage',
        destructive: false,
        patterns: [
            /my\s+attendance/i,
            /show\s+(?:my\s+)?attendance/i,
            /view\s+(?:my\s+)?attendance/i,
            /attendance\s+(?:record|history|report)/i,
        ],
        extractParams: () => ({}),
        descriptionTemplate: () => `View your attendance records and overall percentage.`,
        handler: viewAttendanceHandler,
    },
    {
        action: 'view_timetable',
        description: 'View your class timetable',
        destructive: false,
        patterns: [
            /my\s+timetable/i,
            /show\s+(?:my\s+)?(?:timetable|schedule)/i,
            /view\s+(?:my\s+)?(?:timetable|schedule)/i,
            /class\s+(?:timetable|schedule)/i,
        ],
        extractParams: () => ({}),
        descriptionTemplate: () => `View your class timetable and schedule.`,
        handler: viewTimetableHandler,
    },
];
//# sourceMappingURL=studentHandlers.js.map