import { UserRole } from '@sams/shared';
import { superAdminActions } from './handlers/superAdminHandlers';
import { schoolAdminActions } from './handlers/schoolAdminHandlers';
import { hodActions } from './handlers/hodHandlers';
import { teacherActions } from './handlers/teacherHandlers';
import { studentActions } from './handlers/studentHandlers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionDefinition {
  action: string;
  description: string;
  destructive: boolean;
  patterns: RegExp[];
  extractParams: (message: string, match: RegExpMatchArray | null) => Record<string, unknown>;
  descriptionTemplate: (params: Record<string, unknown>) => string;
  handler: ActionHandler;
}

export type ActionHandler = (
  params: Record<string, unknown>,
  scope: ActionScope,
) => Promise<ActionResult>;

export interface ActionScope {
  userId: string;
  role: UserRole;
  schoolId: string;
  departmentId?: string;
  classId?: string;
}

export interface ActionResult {
  answer: string;
  data?: unknown;
}

export type RoleActionMap = Record<string, ActionDefinition[]>;

// ─── Registry ─────────────────────────────────────────────────────────────────

// Registry - populated by handler imports
export const roleActionRegistry: RoleActionMap = {};

roleActionRegistry['SUPER_ADMIN'] = superAdminActions;
roleActionRegistry['SCHOOL_ADMIN'] = schoolAdminActions;
roleActionRegistry['HOD'] = hodActions;
roleActionRegistry['TEACHER'] = teacherActions;
roleActionRegistry['STUDENT'] = studentActions;

// ─── Lookup Utilities ─────────────────────────────────────────────────────────

export function getActionsForRole(role: string): ActionDefinition[] {
  return roleActionRegistry[role] ?? [];
}

export function findAction(role: string, actionName: string): ActionDefinition | undefined {
  return getActionsForRole(role).find((a) => a.action === actionName);
}

export function isActionPermitted(role: string, actionName: string): boolean {
  return getActionsForRole(role).some((a) => a.action === actionName);
}

export function getActionNames(role: string): string[] {
  return getActionsForRole(role).map((a) => a.action);
}
