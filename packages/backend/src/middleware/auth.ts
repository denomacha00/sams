import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { type AccessTokenPayload, UserRole } from '@sams/shared';

// ─── Augment Express Request ──────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AccessTokenPayload;
    }
  }
}

// ─── authenticate middleware ──────────────────────────────────────────────────
// Verifies the `Authorization: Bearer <token>` header, decodes the JWT using
// JWT_SECRET, and attaches the decoded payload to `req.user`.
// Returns 401 on missing, expired, or invalid tokens.

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Misconfiguration — treat as server error but surface as 401 to avoid leaking internals
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as AccessTokenPayload;

    // Validate that the payload has the required fields
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.schoolId !== 'string' ||
      !Object.values(UserRole).includes(payload.role)
    ) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }

    req.user = {
      sub: payload.sub,
      schoolId: payload.schoolId,
      role: payload.role,
      departmentId: payload.departmentId,
      classId: payload.classId,
      iat: payload.iat,
      exp: payload.exp,
    };

    next();
  } catch {
    // Covers TokenExpiredError, JsonWebTokenError, NotBeforeError
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
}
