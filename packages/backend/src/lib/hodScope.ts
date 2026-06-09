import { UserRole, type AccessTokenPayload } from '@sams/shared';
import { prisma } from './prisma';

export const HOD_DEPARTMENT_UNLINKED_MESSAGE =
  'Your account is not linked to a department — contact school admin.';

/** Actions that require an HOD to have departmentId on their account. */
const HOD_DEPARTMENT_SCOPED_ACTIONS = new Set([
  'send_department_notification',
  'send_class_notification',
  'add_teacher',
  'view_department_stats',
  'create_class',
  'start_session',
  'end_session',
  'mark_attendance',
  'create_registration_link',
]);

/**
 * Resolve departmentId for HOD from JWT, falling back to the user record
 * (stale tokens may omit departmentId after admin assignment).
 */
export async function resolveHodDepartmentId(
  user: Pick<AccessTokenPayload, 'sub' | 'role' | 'departmentId'>,
): Promise<string | undefined> {
  if (user.role !== UserRole.HOD) return user.departmentId;
  if (user.departmentId) return user.departmentId;
  const row = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { departmentId: true },
  });
  return row?.departmentId ?? undefined;
}

export function getHodDepartmentBlocker(
  user: Pick<AccessTokenPayload, 'role' | 'departmentId'>,
  action: string,
  resolvedDepartmentId?: string,
): string | null {
  if (user.role !== UserRole.HOD) return null;
  if (!HOD_DEPARTMENT_SCOPED_ACTIONS.has(action)) return null;
  if (user.departmentId || resolvedDepartmentId) return null;
  return HOD_DEPARTMENT_UNLINKED_MESSAGE;
}
