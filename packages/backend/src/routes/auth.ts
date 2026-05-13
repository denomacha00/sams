import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/loginRateLimiter';
import { authService } from '../services/authService';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const loginSchema = z.object({
  schoolCode: z.string().min(3),
  identifier: z.string().min(1),
  password: z.string().min(8),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Error Code → HTTP Status Mapping ────────────────────────────────────────

function errorCodeToStatus(code: string): number {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 401;
    case 'ACCOUNT_LOCKED':
      return 401;
    case 'INVALID_REFRESH_TOKEN':
      return 401;
    case 'REFRESH_TOKEN_EXPIRED':
      return 401;
    case 'USER_NOT_FOUND':
      return 401;
    default:
      return 500;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const authRouter = Router();

/**
 * POST /api/v1/auth/login
 * Authenticate a user with schoolCode + identifier + password.
 * Requirements: 3.7, 3.8
 */
authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
      requestId: req.id,
    });
    return;
  }

  const { schoolCode, identifier, password } = parsed.data;

  try {
    const tokenPair = await authService.login(schoolCode, identifier, password);
    res.status(200).json(tokenPair);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = errorCodeToStatus(code);
    res.status(status).json({
      error: code === 'ACCOUNT_LOCKED' ? 'Account is locked' : 'Invalid credentials',
      code,
      requestId: req.id,
    });
  }
});

/**
 * POST /api/v1/auth/refresh
 * Exchange a valid refresh token for a new token pair.
 * Requirements: 3.8
 */
authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
      requestId: req.id,
    });
    return;
  }

  const { refreshToken } = parsed.data;

  try {
    const tokenPair = await authService.refresh(refreshToken);
    res.status(200).json(tokenPair);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = errorCodeToStatus(code);
    res.status(status).json({
      error: 'Invalid or expired refresh token',
      code,
      requestId: req.id,
    });
  }
});

/**
 * POST /api/v1/auth/logout
 * Invalidate a refresh token. Requires authentication.
 * Requirements: 3.7
 */
authRouter.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
      requestId: req.id,
    });
    return;
  }

  const { refreshToken } = parsed.data;
  const userId = req.user.sub;

  try {
    await authService.logout(userId, refreshToken);
    res.status(204).send();
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    res.status(500).json({
      error: 'Logout failed',
      code,
      requestId: req.id,
    });
  }
});
