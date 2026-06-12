import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskLevel } from '@sams/shared';
import { RiskService } from './riskService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    riskScore: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    attendanceSession: {
      count: vi.fn(),
    },
    attendanceRecord: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('./notificationService', () => ({
  notificationService: {
    sendInApp: vi.fn(),
  },
}));

describe('RiskService.getRiskScores', () => {
  const service = new RiskService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns student names with listed risk scores', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'student-1', fullName: 'Jane Student', admissionNumber: 'ADM-1' },
    ] as never);
    vi.mocked(prisma.riskScore.findMany).mockResolvedValue([
      {
        studentId: 'student-1',
        attendanceWeight: 20,
        gradeWeight: 50,
        patternWeight: 0,
        score: 28,
        riskLevel: RiskLevel.MEDIUM,
        computedAt: new Date('2026-06-12T08:00:00.000Z'),
      },
    ] as never);

    const scores = await service.getRiskScores('school-1');

    expect(scores).toEqual([
      expect.objectContaining({
        studentId: 'student-1',
        studentName: 'Jane Student',
        admissionNumber: 'ADM-1',
        riskLevel: RiskLevel.MEDIUM,
      }),
    ]);
  });
});
