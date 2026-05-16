import { UserRole } from '@sams/shared';
export interface ActionDefinition {
    action: string;
    description: string;
    destructive: boolean;
    patterns: RegExp[];
    extractParams: (message: string, match: RegExpMatchArray | null) => Record<string, unknown>;
    descriptionTemplate: (params: Record<string, unknown>) => string;
    handler: ActionHandler;
}
export type ActionHandler = (params: Record<string, unknown>, scope: ActionScope) => Promise<ActionResult>;
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
export declare const roleActionRegistry: RoleActionMap;
export declare function getActionsForRole(role: string): ActionDefinition[];
export declare function findAction(role: string, actionName: string): ActionDefinition | undefined;
export declare function isActionPermitted(role: string, actionName: string): boolean;
export declare function getActionNames(role: string): string[];
//# sourceMappingURL=roleActionRegistry.d.ts.map