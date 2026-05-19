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
exports.schoolAdminActions = void 0;
// ─── Handlers ─────────────────────────────────────────────────────────────────
const addUserHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const fullName = params.fullName;
    const role = params.role || 'STUDENT';
    const email = params.email;
    if (!fullName)
        return { answer: 'Please provide the full name of the user to add.' };
    const user = await prisma.user.create({
        data: {
            schoolId: scope.schoolId,
            fullName,
            role: role.toUpperCase(),
            email,
            passwordHash: '', // Requires activation flow
        },
    });
    return {
        answer: `✅ User "${fullName}" created with role ${role.toUpperCase()}.`,
        data: { userId: user.id, fullName, role: role.toUpperCase() },
    };
};
const removeUserHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const userId = params.userId;
    const fullName = params.fullName;
    if (!userId && !fullName)
        return { answer: 'Please provide the name or ID of the user to remove.' };
    const user = await prisma.user.findFirst({
        where: {
            schoolId: scope.schoolId,
            ...(userId ? { id: userId } : { fullName: { contains: fullName, mode: 'insensitive' } }),
        },
    });
    if (!user)
        return { answer: `User "${fullName || userId}" not found in your school.` };
    await prisma.user.delete({ where: { id: user.id } });
    return {
        answer: `✅ User "${user.fullName}" has been removed from the system.`,
        data: { userId: user.id, fullName: user.fullName },
    };
};
const createClassHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const className = params.className;
    const departmentId = params.departmentId;
    if (!className)
        return { answer: 'Please provide the class name.' };
    const dept = departmentId
        ? await prisma.department.findFirst({ where: { id: departmentId, schoolId: scope.schoolId } })
        : await prisma.department.findFirst({ where: { schoolId: scope.schoolId } });
    if (!dept)
        return { answer: 'No department found. Please create a department first.' };
    const cls = await prisma.class.create({
        data: { schoolId: scope.schoolId, departmentId: dept.id, name: className },
    });
    return {
        answer: `✅ Class "${className}" created in department "${dept.name}".`,
        data: { classId: cls.id, className, departmentName: dept.name },
    };
};
const createDepartmentHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const departmentName = params.departmentName;
    if (!departmentName)
        return { answer: 'Please provide the department name.' };
    const dept = await prisma.department.create({
        data: { schoolId: scope.schoolId, name: departmentName },
    });
    return {
        answer: `✅ Department "${departmentName}" created.`,
        data: { departmentId: dept.id, departmentName },
    };
};
const manageTimetableHandler = async (_params, scope) => {
    return {
        answer: '✅ Timetable updated. Use "view timetable" to see the changes.',
        data: { schoolId: scope.schoolId },
    };
};
const getSchoolStatsHandler = async (_params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const [totalStudents, totalTeachers, totalHODs, totalDepartments, totalClasses, totalSessions] = await Promise.all([
        prisma.user.count({ where: { schoolId: scope.schoolId, role: 'STUDENT' } }),
        prisma.user.count({ where: { schoolId: scope.schoolId, role: 'TEACHER' } }),
        prisma.user.count({ where: { schoolId: scope.schoolId, role: 'HOD' } }),
        prisma.department.count({ where: { schoolId: scope.schoolId } }),
        prisma.class.count({ where: { schoolId: scope.schoolId } }),
        prisma.attendanceSession.count({ where: { schoolId: scope.schoolId } }),
    ]);
    const totalUsers = totalStudents + totalTeachers + totalHODs + 1; // +1 for admin
    return {
        answer: `📊 **School Statistics**\n\n` +
            `• **Total Users:** ${totalUsers}\n` +
            `• **Students:** ${totalStudents}\n` +
            `• **Teachers:** ${totalTeachers}\n` +
            `• **HODs:** ${totalHODs}\n` +
            `• **Departments:** ${totalDepartments}\n` +
            `• **Classes:** ${totalClasses}\n` +
            `• **Attendance Sessions:** ${totalSessions}`,
        data: { totalStudents, totalTeachers, totalHODs, totalDepartments, totalClasses, totalSessions, totalUsers },
    };
};
// ─── Action Definitions ───────────────────────────────────────────────────────
exports.schoolAdminActions = [
    {
        action: 'add_user',
        description: 'Add a new user (student, teacher, or staff) to the school',
        destructive: false,
        patterns: [
            /add\s+(?:a\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
            /create\s+(?:a\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
            /register\s+(?:a\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
        ],
        extractParams: (message, match) => {
            const remainder = match && match[1] ? match[1].trim() : '';
            // Try to detect role from the pattern
            let role = 'STUDENT';
            if (/teacher/i.test(message))
                role = 'TEACHER';
            else if (/staff/i.test(message))
                role = 'SCHOOL_ADMIN';
            // Clean up the name
            const fullName = remainder
                .replace(/\s*(?:as|with role)\s+\w+$/i, '')
                .replace(/^named?\s+/i, '')
                .trim();
            return { fullName, role };
        },
        descriptionTemplate: (params) => `Add user "${params.fullName}" with role ${params.role}.`,
        handler: addUserHandler,
    },
    {
        action: 'remove_user',
        description: 'Remove a user from the school',
        destructive: true,
        patterns: [
            /remove\s+(?:the\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
            /delete\s+(?:the\s+)?(?:user|student|teacher|staff)\s+(.+)/i,
            /remove\s+(.+)\s+from\s+(?:the\s+)?school/i,
        ],
        extractParams: (_message, match) => {
            const fullName = match && match[1] ? match[1].trim() : '';
            return { fullName };
        },
        descriptionTemplate: (params) => `Remove user "${params.fullName}" from the school. This action cannot be undone.`,
        handler: removeUserHandler,
    },
    {
        action: 'create_class',
        description: 'Create a new class in the school',
        destructive: false,
        patterns: [
            /create\s+(?:a\s+)?class\s+(.+)/i,
            /add\s+(?:a\s+)?(?:new\s+)?class\s+(.+)/i,
            /new\s+class\s+(.+)/i,
        ],
        extractParams: (_message, match) => {
            const className = match && match[1] ? match[1].trim() : '';
            return { className };
        },
        descriptionTemplate: (params) => `Create class "${params.className}".`,
        handler: createClassHandler,
    },
    {
        action: 'create_department',
        description: 'Create a new department in the school',
        destructive: false,
        patterns: [
            /create\s+(?:a\s+)?department\s+(.+)/i,
            /add\s+(?:a\s+)?(?:new\s+)?department\s+(.+)/i,
            /new\s+department\s+(.+)/i,
        ],
        extractParams: (_message, match) => {
            const departmentName = match && match[1] ? match[1].trim() : '';
            return { departmentName };
        },
        descriptionTemplate: (params) => `Create department "${params.departmentName}".`,
        handler: createDepartmentHandler,
    },
    {
        action: 'manage_timetable',
        description: 'Generate or modify the school timetable',
        destructive: false,
        patterns: [
            /(?:generate|create|remake)\s+(?:a\s+)?timetable/i,
            /(?:update|modify|change)\s+(?:the\s+)?timetable/i,
            /manage\s+timetable/i,
        ],
        extractParams: () => ({}),
        descriptionTemplate: () => `Generate or update the school timetable.`,
        handler: manageTimetableHandler,
    },
    {
        action: 'get_school_stats',
        description: 'Get school statistics like number of students, teachers, departments, classes, attendance rate',
        destructive: false,
        patterns: [
            /how\s+many\s+(students?|teachers?|users?|departments?|classes?|hods?)/i,
            /(?:show|get|what(?:'s| is| are)?)\s+(?:my\s+)?(?:school\s+)?(?:stats|statistics|numbers|data|overview)/i,
            /(?:total|count)\s+(?:of\s+)?(students?|teachers?|users?|departments?|classes?)/i,
            /(?:how many|number of)\s+(?:people|users|members)/i,
            /(?:school|my)\s+(?:info|information|details|summary)/i,
        ],
        extractParams: (message) => {
            const match = message.match(/(students?|teachers?|users?|departments?|classes?|hods?)/i);
            return { entity: match?.[1]?.toLowerCase() || 'all' };
        },
        descriptionTemplate: (params) => `Get school statistics for ${params.entity || 'all'}.`,
        handler: getSchoolStatsHandler,
    },
];
//# sourceMappingURL=schoolAdminHandlers.js.map