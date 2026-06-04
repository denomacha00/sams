import { describe, expect, it } from 'vitest';
import { formatSessionForClient } from './sessionResponse';

describe('formatSessionForClient', () => {
  it('maps currentQRToken to qrToken and includes className', () => {
    const formatted = formatSessionForClient({
      id: 'sess1',
      schoolId: 'school1',
      classId: 'class1',
      teacherId: 'teacher1',
      timetableEntryId: 'tt1',
      subject: 'Math',
      lateThresholdMin: 15,
      locationLat: -1.2,
      locationLng: 36.8,
      locationRadiusM: 100,
      currentQRToken: 'jwt-token',
      qrRefreshedAt: new Date('2026-06-04T10:00:00Z'),
      currentLinkToken: null,
      linkExpiresAt: null,
      startedAt: new Date('2026-06-04T10:00:00Z'),
      endedAt: null,
      isActive: true,
      class: { name: 'Form 2A' },
    });

    expect(formatted.qrToken).toBe('jwt-token');
    expect(formatted.currentQRToken).toBe('jwt-token');
    expect(formatted.className).toBe('Form 2A');
  });
});
