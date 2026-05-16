import { type Request, type Response, type NextFunction } from 'express';
import { type AccessTokenPayload } from '@sams/shared';
declare global {
    namespace Express {
        interface Request {
            user: AccessTokenPayload;
        }
    }
}
export declare function authenticate(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map