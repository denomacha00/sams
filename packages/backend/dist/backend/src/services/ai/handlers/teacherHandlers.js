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
exports.teacherActions = void 0;
// ─── Handlers ─────────────────────────────────────────────────────────────────
const startSessionHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const subject = params.subject;
    if (!scope.classId) {
        return { answer: 'Your account is not associated with a class.' };
    }
    const session = await prisma.attendanceSession.create({
        data: {
            schoolId: scope.schoolId,
            classId: scope.classId,
            teacherId: scope.userId,
            subject: subject || 'General',
            isActive: true,
        },
    });
    return {
        answer: `✅ Attendance session started for "${subject || 'General'}".`,
        data: { sessionId: session.id },
    };
};
const endSessionHandler = async (_params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const activeSession = await prisma.attendanceSession.findFirst({
        where: { teacherId: scope.userId, isActive: true },
    });
    if (!activeSession)
        return { answer: 'No active session found.' };
    await prisma.attendanceSession.update({
        where: { id: activeSession.id },
        data: { isActive: false, endedAt: new Date() },
    });
    return {
        answer: `✅ Session "${activeSession.subject}" ended.`,
        data: { sessionId: activeSession.id },
    };
};
const markAttendanceHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const studentName = params.studentName;
    const status = params.status || 'PRESENT';
    if (!studentName)
        return { answer: 'Please provide the student name.' };
    const activeSession = await prisma.attendanceSession.findFirst({
        where: { teacherId: scope.userId, isActive: true },
    });
    if (!activeSession)
        return { answer: 'No active session. Start a session first.' };
    const student = await prisma.user.findFirst({
        where: {
            schoolId: scope.schoolId,
            role: 'STUDENT',
            fullName: { contains: studentName, mode: 'insensitive' },
        },
    });
    if (!student)
        return { answer: `Student "${studentName}" not found.` };
    await prisma.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: activeSession.id, studentId: student.id } },
        create: {
            schoolId: scope.schoolId,
            sessionId: activeSession.id,
            studentId: student.id,
            status: status.toUpperCase(),
            method: 'MANUAL',
            scannedAt: new Date(),
        },
        update: { status: status.toUpperCase() },
    });
    return {
        answer: `✅ ${student.fullName} marked as ${status.toUpperCase()}.`,
        data: { studentId: student.id, status: status.toUpperCase() },
    };
};
const addKnowledgeHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const title = params.title;
    const content = params.content;
    const category = params.category || 'general';
    if (!title || !content) {
        return { answer: 'Please provide both a title and content for the knowledge entry.' };
    }
    const entry = await prisma.aIKnowledge.create({
        data: { title, content, category, schoolId: scope.schoolId, createdById: scope.userId },
    });
    return {
        answer: `✅ Knowledge entry "${title}" added.`,
        data: { entryId: entry.id },
    };
};
// ─── Action Definitions ───────────────────────────────────────────────────────
exports.teacherActions = [
    {
        action: 'start_session',
        description: 'Start an attendance session for your class',
        destructive: false,
        patterns: [
            /start\s+(?:a\s+)?(?:session|class|attendance)/i,
            /begin\s+(?:a\s+)?(?:session|class|attendance)/i,
            /open\s+(?:a\s+)?(?:session|attendance)/i,
        ],
        extractParams: (message) => {
            // Try to extract subject from "start session for Math" or "start Math session"
            const forMatch = message.match(/(?:session|class|attendance)\s+(?:for\s+)?(.+)/i);
            const subject = forMatch && forMatch[1] ? forMatch[1].trim() : undefined;
            return { subject };
        },
        descriptionTemplate: (params) => `Start an attendance session${params.subject ? ` for "${params.subject}"` : ''}.`,
        handler: startSessionHandler,
    },
    {
        action: 'end_session',
        description: 'End the currently active attendance session',
        destructive: true,
        patterns: [
            /end\s+(?:the\s+)?(?:session|class|attendance)/i,
            /stop\s+(?:the\s+)?(?:session|class|attendance)/i,
            /close\s+(?:the\s+)?(?:session|attendance)/i,
        ],
        extractParams: () => ({}),
        descriptionTemplate: () => `End the active attendance session. This will finalize attendance records.`,
        handler: endSessionHandler,
    },
    {
        action: 'mark_attendance',
        description: 'Mark a student as present, absent, or late',
        destructive: false,
        patterns: [
            /mark\s+(.+?)\s+(?:as\s+)?(?:present|absent|late)/i,
            /record\s+(.+?)\s+(?:as\s+)?(?:present|absent|late)/i,
            /(.+?)\s+is\s+(?:present|absent|late)/i,
        ],
        extractParams: (message, match) => {
            const studentName = match && match[1] ? match[1].trim() : '';
            // Extract status
            const statusMatch = message.match(/(?:as\s+)?(present|absent|late)/i);
            const status = statusMatch ? statusMatch[1].toUpperCase() : 'PRESENT';
            return { studentName, status };
        },
        descriptionTemplate: (params) => `Mark "${params.studentName}" as ${params.status}.`,
        handler: markAttendanceHandler,
    },
    {
        action: 'add_knowledge',
        description: 'Add a knowledge base entry for the AI assistant',
        destructive: false,
        patterns: [
            /add\s+(?:a\s+)?knowledge\s+(?:entry\s+)?(.+)/i,
            /create\s+(?:a\s+)?knowledge\s+(?:entry\s+)?(.+)/i,
            /new\s+knowledge\s+(.+)/i,
        ],
        extractParams: (message, match) => {
            const remainder = match && match[1] ? match[1].trim() : '';
            // Try to split title and content by common separators
            const colonSplit = remainder.split(':');
            if (colonSplit.length >= 2) {
                return { title: colonSplit[0].trim(), content: colonSplit.slice(1).join(':').trim() };
            }
            return { title: remainder, content: '' };
        },
        descriptionTemplate: (params) => `Add knowledge entry "${params.title}".`,
        handler: addKnowledgeHandler,
    },
];
//# sourceMappingURL=teacherHandlers.js.map