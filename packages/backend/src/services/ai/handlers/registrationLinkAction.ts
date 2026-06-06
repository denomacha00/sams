import { UserRole } from '@sams/shared';
import type { ActionHandler, ActionResult, ActionScope } from '../roleActionRegistry';
import { resolveTeacherManagedClassIds } from '../../../lib/teacherScope';
import { registrationLinkService } from '../../registrationLinkService';

/** Regex patterns for inviting students via registration link (not direct user create). */
export const INVITE_STUDENT_PATTERNS: RegExp[] = [
  /^(?:add|register|enroll|invite)\s+(?:a\s+)?(?:new\s+)?student\s*$/i,
  /add\s+(?:a\s+)?(?:new\s+)?student\s+(.+)/i,
  /(?:register|invite|enroll)\s+(?:a\s+)?(?:new\s+)?student\s+(.+)/i,
  /(?:generate|create)\s+(?:an?\s+)?(?:registration|enrollment)\s+link/i,
  /(?:student\s+)?(?:registration|enrollment)\s+link/i,
  /(?:enrollment|invite)\s+link(?:\s+for\s+(?:a\s+)?student)?/i,
];

export function extractInviteStudentParams(
  message: string,
  match: RegExpMatchArray | null,
): Record<string, unknown> {
  let studentName = '';
  if (match?.[1]) {
    studentName = match[1]
      .replace(/\s*(?:to|in|for)\s+(?:class|my class).*$/i, '')
      .replace(/^named?\s+/i, '')
      .trim();
  }

  const classMatch = message.match(
    /(?:in|for|to)\s+(?:class\s+)?["']?([^"'.]+?)["']?(?:\s+class)?\s*$/i,
  );
  const className = classMatch?.[1]?.trim();

  return {
    studentName,
    className,
    targetRole: 'STUDENT',
  };
}

function formatExpiry(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatShareableLink(url: string, label: string): string {
  return `[${label}](${url})`;
}

function uiGuideForRole(role: UserRole): string {
  if (role === UserRole.TEACHER) {
    return (
      '\n\n**In the app:** open **Registration Links** from your dashboard ' +
      '(or go to `/admin/links`) → **Generate Link** → choose your class → share the URL with the student.'
    );
  }
  if (role === UserRole.HOD) {
    return (
      '\n\n**In the app:** **Registration Links** (`/admin/links`) → **Generate Link** → ' +
      'target **Student** and select the class → share the URL.'
    );
  }
  return '';
}

export const createRegistrationLinkHandler: ActionHandler = async (
  params,
  scope,
): Promise<ActionResult> => {
  const studentName = (params.studentName as string)?.trim();
  const targetRole = ((params.targetRole as string) || 'STUDENT') as 'STUDENT' | 'TEACHER' | 'HOD';
  let classId = params.classId as string | undefined;

  if (scope.role === UserRole.TEACHER) {
    if (!scope.departmentId) {
      return {
        answer:
          'Your account is not linked to a department yet, so registration links cannot be created. ' +
          'Ask your School Admin to assign your department, then use **Registration Links** on your dashboard.',
      };
    }

    const managedClassIds = await resolveTeacherManagedClassIds(scope.userId, scope.classId);
    if (classId && !managedClassIds.includes(classId)) {
      return {
        answer:
          'You can only generate student registration links for classes you manage as class teacher. ' +
          'Use **Registration Links** (`/admin/links`) after your HOD or School Admin assigns the class to you.',
      };
    }
    if (!classId && managedClassIds.length === 1) {
      classId = managedClassIds[0];
    }
    if (!classId) {
      return {
        answer:
          'You need an assigned class before generating a student registration link. ' +
          'Ask your HOD or School Admin to assign you as class teacher, or pick a class under **Registration Links** (`/admin/links`).',
      };
    }
  }

  if (!scope.departmentId && scope.role === UserRole.HOD) {
    return {
      answer:
        'Your account is not associated with a department. Contact your School Admin before generating links.',
    };
  }

  const maxUses =
    typeof params.maxUses === 'number' && params.maxUses > 0 ? params.maxUses : 50;
  const expiryDays =
    typeof params.expiryDays === 'number' && params.expiryDays > 0 ? params.expiryDays : 30;

  const link = await registrationLinkService.generateLink(
    scope.userId,
    scope.role,
    scope.schoolId,
    scope.departmentId,
    classId,
    { targetRole, maxUses, expiryDays },
  );

  const url = link.url;
  const roleLabel =
    targetRole === 'STUDENT' ? 'Student' : targetRole === 'TEACHER' ? 'Teacher' : 'HOD';
  const namePart = studentName ? ` (for **${studentName}**)` : '';
  const linkLabel = studentName ? `Register ${studentName}` : 'Open registration page';
  const shareLink = formatShareableLink(url, linkLabel);

  const signupHint =
    targetRole === 'STUDENT'
      ? 'They complete signup with their name, username, and password — you cannot add them directly in chat.'
      : 'Share the link so they can complete self-registration.';

  return {
    answer:
      `✅ **${roleLabel} registration link** created${namePart}.\n\n` +
      `**Share this link:** ${shareLink}\n\n` +
      `Valid until **${formatExpiry(link.expiresAt)}** · up to **${link.maxUses}** registrations. ` +
      `${signupHint}` +
      uiGuideForRole(scope.role),
    data: {
      linkId: link.id,
      token: link.token,
      url,
      classId: link.classId,
      targetRole: link.targetRole,
      studentName: studentName || undefined,
    },
  };
};

export const createRegistrationLinkActionDef = {
  action: 'create_registration_link' as const,
  description:
    'Generate a student self-registration link (same as Registration Links on the dashboard — not direct user creation)',
  destructive: false,
  patterns: INVITE_STUDENT_PATTERNS,
  extractParams: extractInviteStudentParams,
  descriptionTemplate: (params: Record<string, unknown>) => {
    const name = params.studentName ? ` for "${params.studentName}"` : '';
    const cls = params.className ? ` (class: ${params.className})` : '';
    return `Generate a student registration link${name}${cls}.`;
  },
  handler: createRegistrationLinkHandler,
};
