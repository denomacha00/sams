import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';
import { applySlotAnswer, getNextMissingSlot } from './actionSlotFilling';
import { extractMessageBody, parseNotificationTargetRole } from './notificationActionParams';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    class: { findMany: vi.fn(), findFirst: vi.fn() },
    department: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock('../../lib/teacherScope', () => ({
  resolveTeacherClassId: vi.fn().mockResolvedValue('class-teacher-1'),
}));

import { prisma } from '../../lib/prisma';

const hodUser = {
  sub: 'hod-1',
  role: UserRole.HOD,
  schoolId: 'school-1',
  departmentId: 'dept-1',
};

describe('actionSlotFilling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applySlotAnswer maps HOD department scope', () => {
    const { action, params } = applySlotAnswer(
      'send_department_notification',
      'notifyScope',
      'department',
      {},
      UserRole.HOD,
    );
    expect(action).toBe('send_department_notification');
    expect(params.notifyScope).toBe('department');
  });

  it('applySlotAnswer maps HOD class name to send_class_notification', () => {
    const { action, params } = applySlotAnswer(
      'send_department_notification',
      'notifyScope',
      'Form 2A',
      {},
      UserRole.HOD,
    );
    expect(action).toBe('send_class_notification');
    expect(params.className).toBe('Form 2A');
  });

  it('asks notifyScope for bare HOD department notification', async () => {
    const slot = await getNextMissingSlot(hodUser as any, 'send_department_notification', {});
    expect(slot).toBe('notifyScope');
  });

  it('asks message after scope is set for HOD', async () => {
    const slot = await getNextMissingSlot(hodUser as any, 'send_department_notification', {
      notifyScope: 'department',
    });
    expect(slot).toBe('message');
  });

  it('asks classId when HOD targets a class with multiple classes', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([
      { id: 'c1', name: 'Form 1A' },
      { id: 'c2', name: 'Form 1B' },
    ] as any);

    const slot = await getNextMissingSlot(hodUser as any, 'send_class_notification', {
      notifyScope: 'class',
    });
    expect(slot).toBe('classId');
  });

  it('teacher send_class_message only needs message', async () => {
    const teacher = {
      sub: 't1',
      role: UserRole.TEACHER,
      schoolId: 'school-1',
      classId: 'class-1',
    };
    const slot = await getNextMissingSlot(teacher as any, 'send_class_message', {});
    expect(slot).toBe('message');
  });
});

describe('notificationActionParams', () => {
  it('parses student-only audience', () => {
    expect(parseNotificationTargetRole('notify department students')).toBe('STUDENT');
  });

  it('extracts message body from regex match', () => {
    const m = 'notify school: Holiday Friday'.match(/school\s*[:,-]?\s*(.+)/i);
    expect(extractMessageBody(m)).toBe('Holiday Friday');
  });
});
