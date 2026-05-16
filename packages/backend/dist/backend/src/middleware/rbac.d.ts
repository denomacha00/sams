import { type Request, type Response, type NextFunction } from 'express';
import { UserRole } from '@sams/shared';
declare global {
    namespace Express {
        interface Request {
            schoolId: string;
        }
    }
}
export type Permission = 'manage:users' | 'start:session' | 'mark:attendance' | 'view:reports' | 'manage:timetable' | 'view:risk' | 'manage:payments' | 'manage:knowledge' | 'super:admin';
export declare const ROLE_PERMISSIONS: Record<UserRole, Permission[]>;
export declare function requirePermission(permission: Permission): (req: Request, res: Response, next: NextFunction) => void;
export declare function enforceSchoolScope(req: Request, res: Response, next: NextFunction): void;
export type AuthRequest = Request & {
    user: NonNullable<Request['user']>;
};
export declare function assertSchoolOwnership(resource: {
    schoolId: string;
}, req: AuthRequest): void;
export declare function requireHODScope(req: Request, res: Response, next: NextFunction): void;
export declare function requireStudentSelf(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=rbac.d.ts.map