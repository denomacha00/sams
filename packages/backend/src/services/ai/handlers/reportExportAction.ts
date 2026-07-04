import { UserRole } from '@sams/shared';
import type { ActionDefinition, ActionHandler, ActionScope } from '../roleActionRegistry';

type ReportFormat = 'pdf' | 'excel' | 'csv';
type ReportType = 'student' | 'class' | 'department' | 'school';

const REPORT_EXPORT_PATTERNS: RegExp[] = [
  /(?:export|download|generate|prepare)\s+(?:my\s+)?(?:attendance\s+)?report(?:\s+as\s+(pdf|excel|csv|xlsx))?/i,
  /(?:export|download|generate|prepare)\s+(?:a\s+)?(pdf|excel|csv|xlsx)\s+(?:attendance\s+)?report/i,
  /(?:export|download|generate|prepare)\s+(?:my\s+)?(?:student|class|department|school)?\s*(?:attendance\s+)?report\s+as\s+(pdf|excel|csv|xlsx)/i,
  /(?:attendance\s+)?report\s+(?:pdf|excel|csv|xlsx|download|export)/i,
  // More flexible patterns - don't require "attendance report" specifically
  /(?:export|download|generate|prepare)\s+(?:my\s+)?report/i,
  /(?:export|download)\s+(?:my\s+)?(?:pdf|attendance|report)/i,
  /(?:i\s+)?(?:need|want)\s+(?:a\s+)?(?:(?:pdf|attendance)\s+)?report/i,
];

function normalizeFormat(value?: string): ReportFormat {
  const format = value?.toLowerCase();
  if (format === 'csv') return 'csv';
  if (format === 'excel' || format === 'xlsx') return 'excel';
  return 'pdf';
}

function detectFormat(message: string, match: RegExpMatchArray | null): ReportFormat {
  return normalizeFormat(match?.[1] || message.match(/\b(pdf|excel|csv|xlsx)\b/i)?.[1]);
}

function detectReportType(message: string, scope: ActionScope): ReportType {
  if (scope.role === UserRole.STUDENT) return 'student';
  if (scope.role === UserRole.SCHOOL_ADMIN) {
    if (/\bdepartment\b|\bdept\b/i.test(message)) return 'department';
    if (/\bclass\b/i.test(message)) return 'class';
    return 'school';
  }
  if (scope.role === UserRole.HOD) {
    if (/\bdepartment\b|\bdept\b/i.test(message)) return 'department';
    return 'class';
  }
  return 'class';
}

function extractClassName(message: string): string | undefined {
  const match = message.match(/\bclass\s+["']?([^"',.]+?)["']?(?:\s+(?:report|pdf|excel|csv|attendance)|$)/i);
  return match?.[1]?.trim();
}

function buildReportId(type: ReportType, targetId?: string): string {
  return targetId ? `${type}:${targetId}` : type;
}

function extensionFor(format: ReportFormat): string {
  return format === 'pdf' ? 'pdf' : format === 'csv' ? 'csv' : 'xlsx';
}

async function resolveTeacherClass(scope: ActionScope, params: Record<string, unknown>) {
  const { prisma } = await import('../../../lib/prisma');
  const { resolveTeacherTeachingClassIds } = await import('../../../lib/teacherScope');
  const classIds = await resolveTeacherTeachingClassIds(scope.userId, scope.classId);
  if (classIds.length === 0) return null;

  const classes = await prisma.class.findMany({
    where: { schoolId: scope.schoolId, id: { in: classIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const classId = typeof params.classId === 'string' ? params.classId : undefined;
  if (classId) return classes.find((cls) => cls.id === classId) ?? null;

  const className = typeof params.className === 'string' ? params.className.trim().toLowerCase() : '';
  if (className) return classes.find((cls) => cls.name.toLowerCase().includes(className)) ?? null;

  return classes.length === 1 ? classes[0] : null;
}

async function resolveScopedClass(scope: ActionScope, params: Record<string, unknown>) {
  const { prisma } = await import('../../../lib/prisma');
  const classId = typeof params.classId === 'string' ? params.classId : undefined;
  const className = typeof params.className === 'string' ? params.className.trim() : '';

  if (classId) {
    return prisma.class.findFirst({
      where: {
        id: classId,
        schoolId: scope.schoolId,
        ...(scope.role === UserRole.HOD ? { departmentId: scope.departmentId } : {}),
      },
      select: { id: true, name: true },
    });
  }

  if (!className) return null;
  return prisma.class.findFirst({
    where: {
      schoolId: scope.schoolId,
      ...(scope.role === UserRole.HOD ? { departmentId: scope.departmentId } : {}),
      name: { contains: className, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  });
}

export const exportReportHandler: ActionHandler = async (params, scope) => {
  const format = normalizeFormat(params.format as string | undefined);
  const type = (params.reportType as ReportType | undefined) ?? (
    scope.role === UserRole.STUDENT
      ? 'student'
      : scope.role === UserRole.HOD
        ? 'department'
        : scope.role === UserRole.SCHOOL_ADMIN
          ? 'school'
          : 'class'
  );

  let targetId: string | undefined;
  let label = '';

  if (type === 'student') {
    targetId = scope.userId;
    label = 'your attendance report';
  } else if (type === 'department') {
    if (!scope.departmentId && scope.role === UserRole.HOD) {
      return { answer: 'Your account is not linked to a department, so I cannot prepare a department report.' };
    }
    targetId = scope.departmentId;
    label = 'department attendance report';
  } else if (type === 'school') {
    label = 'school attendance report';
  } else {
    const cls = scope.role === UserRole.TEACHER
      ? await resolveTeacherClass(scope, params)
      : await resolveScopedClass(scope, params);
    if (!cls) {
      return {
        answer:
          'Which class report should I export? Reply with the class name, then I will prepare the download.',
      };
    }
    targetId = cls.id;
    label = `${cls.name} attendance report`;
  }

  const reportId = buildReportId(type, targetId);
  const endpoint = `/reports/${encodeURIComponent(reportId)}/export?format=${format}`;
  const filename = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'attendance-report'}.${extensionFor(format)}`;

  return {
    answer:
      `I prepared the real **${format.toUpperCase()}** export for **${label}**. Use the download button below. ` +
      'SAMS will still enforce your role permissions before the file downloads.',
    data: {
      download: {
        kind: 'report',
        endpoint,
        filename,
        label: `Download ${format.toUpperCase()}`,
      },
    },
  };
};

export const exportReportActionDef: ActionDefinition = {
  action: 'export_attendance_report',
  description: 'Export an attendance report as PDF, Excel, or CSV within the user role scope',
  destructive: true,
  patterns: REPORT_EXPORT_PATTERNS,
  extractParams: (message, match) => ({
    format: detectFormat(message, match),
    reportType: detectReportType(message, {
      userId: '',
      role: UserRole.STUDENT,
      schoolId: '',
    } as ActionScope),
    className: extractClassName(message),
  }),
  descriptionTemplate: (params) =>
    `Export attendance report as ${String(params.format || 'pdf').toUpperCase()}.`,
  handler: exportReportHandler,
};

export function buildExportReportActionDefForRole(role: UserRole): ActionDefinition {
  return {
    ...exportReportActionDef,
    extractParams: (message, match) => ({
      format: detectFormat(message, match),
      reportType: detectReportType(message, { userId: '', role, schoolId: '' } as ActionScope),
      className: extractClassName(message),
    }),
  };
}
