import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { UserRole } from '@sams/shared';
import { authRouter } from './auth';

const {
  validateLoginCredentialsMock,
  finalizePasswordLoginMock,
  loginMock,
  createOtpMock,
  deliverOtpMock,
} = vi.hoisted(() => ({
  validateLoginCredentialsMock: vi.fn(),
  finalizePasswordLoginMock: vi.fn(),
  loginMock: vi.fn(),
  createOtpMock: vi.fn(),
  deliverOtpMock: vi.fn(),
}));

vi.mock('../middleware/loginRateLimiter', () => ({
  loginRateLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../middleware/otpResendRateLimiter', () => ({
  otpResendRateLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../services/authService', () => ({
  authService: {
    validateLoginCredentials: validateLoginCredentialsMock,
    finalizePasswordLogin: finalizePasswordLoginMock,
    login: loginMock,
    refresh: vi.fn(),
    logout: vi.fn(),
    generateTokensForUser: vi.fn(),
  },
}));

vi.mock('../services/otpService', () => ({
  isOtpLoginEnabled: () => true,
  isOtpPasswordResetEnabled: () => false,
  assertOtpResendAllowed: vi.fn(),
  createOtp: createOtpMock,
  createOtpChallenge: vi.fn(() => 'otp-challenge'),
  deliverOtp: deliverOtpMock,
  recordOtpResend: vi.fn(),
  verifyOtp: vi.fn(),
  verifyOtpChallenge: vi.fn(),
}));

vi.mock('../config/email', () => ({
  EMAIL_NOT_CONFIGURED_MESSAGE: 'Email is not configured',
  isEmailConfigured: () => false,
}));

vi.mock('../config/africasTalking', () => ({
  isSmsConfigured: () => false,
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    school: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../services/notificationService', () => ({
  notificationService: {
    sendEmail: vi.fn(),
    sendSMS: vi.fn(),
  },
}));

function createAuthApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  return app;
}

describe('auth login routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets SUPER_ADMIN sign in with password even when OTP login is enabled', async () => {
    validateLoginCredentialsMock.mockResolvedValue({
      id: 'super-1',
      schoolId: 'platform-school',
      role: UserRole.SUPER_ADMIN,
      departmentId: null,
      classId: null,
      email: 'admin@smart-managment.com',
      admissionNumber: null,
    });
    finalizePasswordLoginMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    const res = await request(createAuthApp())
      .post('/auth/login')
      .send({
        schoolCode: 'SUPERADMIN',
        identifier: 'admin@smart-managment.com',
        password: 'correct-password',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    expect(finalizePasswordLoginMock).toHaveBeenCalledWith(expect.objectContaining({ role: UserRole.SUPER_ADMIN }));
    expect(createOtpMock).not.toHaveBeenCalled();
    expect(deliverOtpMock).not.toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
  });
});
