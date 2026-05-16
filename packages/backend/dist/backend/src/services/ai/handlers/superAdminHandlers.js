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
exports.superAdminActions = void 0;
// ─── Helper Utilities (migrated from actionIntentDetector.ts) ─────────────────
const VALID_PLAN_TIERS = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'];
function extractSchoolName(text) {
    return text
        .replace(/^(the|school|named|called)\s+/i, '')
        .replace(/\s*(please|now|immediately|asap)\s*$/i, '')
        .trim();
}
function extractPlanTier(question) {
    const q = question.toUpperCase();
    for (const tier of VALID_PLAN_TIERS) {
        if (q.includes(tier))
            return tier;
    }
    return undefined;
}
function extractDays(question) {
    const match = question.match(/(\d+)\s*days?/i);
    return match ? parseInt(match[1], 10) : undefined;
}
// ─── Handlers ─────────────────────────────────────────────────────────────────
const suspendSchoolHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const { licenseService } = await Promise.resolve().then(() => __importStar(require('../../licenseService')));
    const { auditService } = await Promise.resolve().then(() => __importStar(require('../../auditService')));
    const schoolName = params.schoolName;
    if (!schoolName)
        return { answer: 'School name is required.' };
    const school = await prisma.school.findFirst({
        where: { name: { contains: schoolName, mode: 'insensitive' } },
    });
    if (!school)
        return { answer: `School "${schoolName}" not found.` };
    if (school.isSuspended)
        return { answer: `⚠️ School "${school.name}" is already suspended.` };
    await licenseService.suspendSchool(school.id);
    await auditService.log({
        eventType: 'SCHOOL_SUSPENDED',
        actorId: scope.userId,
        actorRole: scope.role,
        schoolId: school.id,
        resourceSnapshot: { action: 'SCHOOL_SUSPENDED_VIA_AI', schoolName: school.name },
    });
    return {
        answer: `✅ School "${school.name}" has been suspended.\n\n• All active sessions revoked\n• Users cannot log in\n• Audit log entry created`,
        data: { schoolId: school.id, schoolName: school.name },
    };
};
const unsuspendSchoolHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const { auditService } = await Promise.resolve().then(() => __importStar(require('../../auditService')));
    const schoolName = params.schoolName;
    if (!schoolName)
        return { answer: 'School name is required.' };
    const school = await prisma.school.findFirst({
        where: { name: { contains: schoolName, mode: 'insensitive' } },
    });
    if (!school)
        return { answer: `School "${schoolName}" not found.` };
    if (!school.isSuspended)
        return { answer: `ℹ️ School "${school.name}" is not currently suspended.` };
    await prisma.school.update({
        where: { id: school.id },
        data: { isSuspended: false },
    });
    await auditService.log({
        eventType: 'SCHOOL_SUSPENDED',
        actorId: scope.userId,
        actorRole: scope.role,
        schoolId: school.id,
        resourceSnapshot: { action: 'SCHOOL_UNSUSPENDED_VIA_AI', schoolName: school.name },
    });
    return {
        answer: `✅ School "${school.name}" has been unsuspended.\n\n• Users can now log in\n• Full access restored`,
        data: { schoolId: school.id, schoolName: school.name },
    };
};
const generateLicenseHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const { auditService } = await Promise.resolve().then(() => __importStar(require('../../auditService')));
    const { createHash } = await Promise.resolve().then(() => __importStar(require('crypto')));
    const { encodeLicenseKey } = await Promise.resolve().then(() => __importStar(require('@sams/shared')));
    const schoolName = params.schoolName || '';
    if (!schoolName) {
        return {
            answer: 'What school name should I use for the license? Please say: "generate license for [School Name]"',
        };
    }
    const planTier = params.planTier || 'BASIC';
    const daysValid = params.daysValid || 365;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysValid);
    const secret = process.env.LICENSE_SECRET || process.env.JWT_SECRET || 'default-license-secret';
    const rawKey = encodeLicenseKey({ schoolName, planTier: planTier, expiresAt }, secret);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    await prisma.licenseKey.create({
        data: { keyHash, planTier: planTier, schoolName, expiresAt },
    });
    await auditService.log({
        eventType: 'LICENSE_ACTIVATION',
        actorId: scope.userId,
        actorRole: scope.role,
        resourceSnapshot: { action: 'LICENSE_GENERATED_VIA_AI', schoolName, planTier },
    });
    return {
        answer: `✅ License generated!\n\n**Key:** \`${rawKey}\`\n\n• School: ${schoolName}\n• Plan: ${planTier}\n• Expires: ${expiresAt.toLocaleDateString()}\n\n⚠️ Store this key securely.`,
        data: { licenseKey: rawKey, schoolName, planTier },
    };
};
const extendLicenseHandler = async (params, scope) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const { licenseService } = await Promise.resolve().then(() => __importStar(require('../../licenseService')));
    const schoolName = params.schoolName;
    const daysToAdd = params.daysToAdd || 30;
    if (!schoolName)
        return { answer: 'School name is required.' };
    const school = await prisma.school.findFirst({
        where: { name: { contains: schoolName, mode: 'insensitive' } },
    });
    if (!school)
        return { answer: `School "${schoolName}" not found.` };
    const baseDate = school.licenseExpiresAt > new Date() ? school.licenseExpiresAt : new Date();
    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + daysToAdd);
    await licenseService.extendLicense(school.id, newExpiry);
    return {
        answer: `✅ License extended for "${school.name}".\n\n• Previous expiry: ${school.licenseExpiresAt.toLocaleDateString()}\n• New expiry: ${newExpiry.toLocaleDateString()}\n• Days added: ${daysToAdd}`,
        data: { schoolId: school.id, newExpiry: newExpiry.toISOString() },
    };
};
const getSchoolInfoHandler = async (params) => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const schoolName = params.schoolName;
    if (!schoolName)
        return { answer: 'School name is required.' };
    const school = await prisma.school.findFirst({
        where: { name: { contains: schoolName, mode: 'insensitive' } },
        include: { _count: { select: { users: true, sessions: true, payments: true } } },
    });
    if (!school)
        return { answer: `School "${schoolName}" not found.` };
    return {
        answer: `📋 **${school.name}**\n\n• Code: ${school.schoolCode}\n• Plan: ${school.planTier}\n• Expires: ${school.licenseExpiresAt.toLocaleDateString()}\n• Suspended: ${school.isSuspended ? 'Yes ⚠️' : 'No ✅'}\n• Users: ${school._count.users}\n• Sessions: ${school._count.sessions}\n• Payments: ${school._count.payments}`,
        data: school,
    };
};
const getSystemStatsHandler = async () => {
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../../../index')));
    const [totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools] = await Promise.all([
        prisma.school.count(),
        prisma.user.count({ where: { role: 'STUDENT' } }),
        prisma.user.count({ where: { role: 'TEACHER' } }),
        prisma.attendanceSession.count({ where: { isActive: true } }),
        prisma.school.count({ where: { isSuspended: true } }),
    ]);
    const revenue = await prisma.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
    });
    return {
        answer: `📊 **System Stats**\n\n• Schools: ${totalSchools}\n• Students: ${totalStudents}\n• Teachers: ${totalTeachers}\n• Active Sessions: ${activeSessions}\n• Suspended: ${suspendedSchools}\n• Revenue: KES ${(revenue._sum.amount || 0).toLocaleString()}`,
        data: { totalSchools, totalStudents, totalTeachers, activeSessions, suspendedSchools },
    };
};
// ─── Action Definitions ───────────────────────────────────────────────────────
exports.superAdminActions = [
    {
        action: 'suspend_school',
        description: 'Suspend a school, blocking all users from logging in',
        destructive: true,
        patterns: [/suspend\s+(.+)/i, /block\s+(.+)/i, /disable\s+(.+)/i],
        extractParams: (message, match) => {
            const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
            return { schoolName };
        },
        descriptionTemplate: (params) => `Suspend school "${params.schoolName}" — this will block all users from logging in.`,
        handler: suspendSchoolHandler,
    },
    {
        action: 'unsuspend_school',
        description: 'Unsuspend a school, restoring user access',
        destructive: false,
        patterns: [/unsuspend\s+(.+)/i, /unblock\s+(.+)/i, /reactivate\s+(.+)/i, /enable\s+(.+)/i],
        extractParams: (message, match) => {
            const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
            return { schoolName };
        },
        descriptionTemplate: (params) => `Unsuspend school "${params.schoolName}" — users will be able to log in again.`,
        handler: unsuspendSchoolHandler,
    },
    {
        action: 'generate_license',
        description: 'Generate a new license key for a school',
        destructive: false,
        patterns: [
            /generate\s+(?:a\s+)?(?:license|key)\s+(?:for\s+)?(.+)/i,
            /create\s+(?:a\s+)?(?:license|key)\s+(?:for\s+)?(.+)/i,
            /new\s+license\s+(?:for\s+)?(.+)/i,
            /new\s+(?:license|key)\s+(.+)/i,
        ],
        extractParams: (question, match) => {
            const remainder = match && match[1] ? match[1].trim() : '';
            const planTier = extractPlanTier(question) || 'BASIC';
            let schoolName = remainder;
            for (const tier of VALID_PLAN_TIERS) {
                schoolName = schoolName.replace(new RegExp(`\\b${tier}\\b`, 'i'), '').trim();
            }
            schoolName = schoolName
                .replace(/^(plan|tier|with|on)\s+/i, '')
                .replace(/\s*(plan|tier|with|on)\s*$/i, '')
                .replace(/^(for|to)\s+/i, '')
                .trim();
            schoolName = extractSchoolName(schoolName);
            return { schoolName: schoolName || 'Unnamed School', planTier };
        },
        descriptionTemplate: (params) => `Generate a ${params.planTier} license key for "${params.schoolName}".`,
        handler: generateLicenseHandler,
    },
    {
        action: 'extend_license',
        description: 'Extend a school license by a number of days',
        destructive: false,
        patterns: [
            /extend\s+(.+?)\s+by\s+(\d+)\s*days?/i,
            /add\s+(\d+)\s*days?\s+to\s+(.+)/i,
            /renew\s+(.+)/i,
            /extend\s+(?:license\s+(?:for\s+)?)?(.+)/i,
        ],
        extractParams: (question, match) => {
            const days = extractDays(question) || 30;
            let schoolName = '';
            if (match) {
                if (/extend\s+(.+?)\s+by\s+\d+/i.test(question)) {
                    const m = question.match(/extend\s+(.+?)\s+by\s+\d+/i);
                    schoolName = m && m[1] ? extractSchoolName(m[1]) : '';
                }
                else if (/add\s+\d+\s*days?\s+to\s+(.+)/i.test(question)) {
                    const m = question.match(/add\s+\d+\s*days?\s+to\s+(.+)/i);
                    schoolName = m && m[1] ? extractSchoolName(m[1]) : '';
                }
                else {
                    schoolName = match[1] ? extractSchoolName(match[1]) : '';
                }
            }
            schoolName = schoolName.replace(/^license\s+(?:for\s+)?/i, '').trim();
            return { schoolName, daysToAdd: days };
        },
        descriptionTemplate: (params) => `Extend license for "${params.schoolName}" by ${params.daysToAdd} days.`,
        handler: extendLicenseHandler,
    },
    {
        action: 'get_school_info',
        description: 'Get detailed information about a school',
        destructive: false,
        patterns: [
            /(?:info|information)\s+(?:about|on|for)\s+(.+)/i,
            /details?\s+(?:of|about|for)\s+(.+)/i,
            /show\s+(.+?)\s+info/i,
            /what\s+about\s+(.+)/i,
            /tell\s+me\s+about\s+(.+?)\s+school/i,
            /school\s+info\s+(?:for\s+)?(.+)/i,
        ],
        extractParams: (_message, match) => {
            const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
            return { schoolName };
        },
        descriptionTemplate: (params) => `Get information about school "${params.schoolName}".`,
        handler: getSchoolInfoHandler,
    },
    {
        action: 'get_system_stats',
        description: 'Retrieve system-wide statistics (schools, users, revenue)',
        destructive: false,
        patterns: [
            /system\s*stats/i,
            /platform\s*stats/i,
            /how\s+many\s+schools/i,
            /total\s+revenue/i,
            /dashboard\s*stats/i,
            /system\s*overview/i,
            /platform\s*overview/i,
        ],
        extractParams: () => ({}),
        descriptionTemplate: () => `Retrieve system-wide statistics (schools, users, revenue, etc.).`,
        handler: getSystemStatsHandler,
    },
];
//# sourceMappingURL=superAdminHandlers.js.map