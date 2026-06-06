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
  resolveTeacherManagedClassIds: vi.fn().mockResolvedValue(['class-teacher-1']),
  resolveTeacherTeachingClassIds: vi.fn().mockResolvedValue(['class-teacher-1']),
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

  it('asks message only for bare HOD department notification (no department picker)', async () => {
    const slot = await getNextMissingSlot(hodUser as any, 'send_department_notification', {});
    expect(slot).toBe('message');
  });

  it('is ready to confirm when HOD department message is provided', async () => {
    const slot = await getNextMissingSlot(hodUser as any, 'send_department_notification', {
      message: 'Staff meeting at 3pm',
    });
    expect(slot).toBeNull();
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

  it('HOD create_registration_link asks targetRole first', async () => {
    const slot = await getNextMissingSlot(hodUser as any, 'create_registration_link', {});
    expect(slot).toBe('targetRole');
  });

  it('HOD create_registration_link asks class after student role', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([
      { id: 'c1', name: 'Form 1A' },
      { id: 'c2', name: 'Form 1B' },
    ] as any);

    const slot = await getNextMissingSlot(hodUser as any, 'create_registration_link', {
      targetRole: 'STUDENT',
    });
    expect(slot).toBe('classId');
  });

  it('HOD create_registration_link skips class for teacher role', async () => {
    const slot = await getNextMissingSlot(hodUser as any, 'create_registration_link', {
      targetRole: 'TEACHER',
    });
    expect(slot).toBe('maxUses');
  });

  it('teacher create_registration_link asks maxUses when class is set', async () => {
    const teacher = {
      sub: 't1',
      role: UserRole.TEACHER,
      schoolId: 'school-1',
      departmentId: 'dept-1',
      classId: 'class-1',
    };
    const slot = await getNextMissingSlot(teacher as any, 'create_registration_link', {
      classId: 'class-1',
    });
    expect(slot).toBe('maxUses');
  });

  it('Super Admin generate_license asks for schoolName when missing', async () => {
    const superAdmin = {
      sub: 'super-1',
      role: UserRole.SUPER_ADMIN,
      schoolId: 'platform',
    };
    const slot = await getNextMissingSlot(superAdmin as any, 'generate_license', {});
    expect(slot).toBe('schoolName');
  });

  it('Super Admin generate_license accepts a real school name answer', () => {
    const { params } = applySlotAnswer(
      'generate_license',
      'schoolName',
      'school called Mwihoko',
      {},
      UserRole.SUPER_ADMIN,
    );
    expect(params.schoolName).toBe('Mwihoko');
  });

  it('Super Admin generate_license ignores filler school name answers', () => {
    const { params } = applySlotAnswer(
      'generate_license',
      'schoolName',
      'come on',
      {},
      UserRole.SUPER_ADMIN,
    );
    expect(params.schoolName).toBeUndefined();
  });

  it('teacher send_class_message only needs message when one taught class exists', async () => {
    vi.mocked(prisma.class.findMany).mockResolvedValue([
      { id: 'class-teacher-1', name: 'Form 1A' },
    ] as any);

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
