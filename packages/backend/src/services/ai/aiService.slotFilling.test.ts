import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UserRole } from '@sams/shared';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    class: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'c1', name: 'Form 1A' },
        { id: 'c2', name: 'Form 1B' },
      ]),
      findFirst: vi.fn(),
    },
    department: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
  },
}));

vi.mock('../conversationMemoryService', () => ({
  conversationMemoryService: {
    resolveThread: vi.fn().mockResolvedValue('thread-1'),
    persistRecord: vi.fn().mockResolvedValue(undefined),
    getContextWindow: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../auditService', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./actionIntentDetector', () => ({
  actionIntentDetector: {
    detect: vi.fn(),
  },
}));

vi.mock('./localEngine', () => ({
  localQuery: vi.fn().mockResolvedValue({ answer: 'unknown', intent: 'unknown' }),
}));

vi.mock('./openaiEngine', () => ({
  openaiQueryWithHistory: vi.fn(),
}));

vi.mock('./aiProviderConfig', () => ({
  hasPrimaryAIKey: vi.fn().mockReturnValue(false),
  hasAtomesusAIKey: vi.fn().mockReturnValue(false),
  getMissingAIKeyMessage: vi.fn().mockReturnValue('no key'),
  formatProviderError: vi.fn(),
}));

vi.mock('./roleActionsPrompt', () => ({
  isConversationMemoryEnabled: vi.fn().mockReturnValue(false),
}));

const mockSendScoped = vi.fn().mockResolvedValue({
  success: true,
  recipientCount: 12,
  batchId: 'batch-1',
});

vi.mock('../scopedNotificationSend', () => ({
  assertAiNotificationChannels: vi.fn(),
  ScopedNotificationError: class ScopedNotificationError extends Error {},
  sendScopedNotification: (...args: unknown[]) => mockSendScoped(...args),
}));

vi.mock('../../lib/teacherScope', () => ({
  resolveTeacherClassId: vi.fn().mockResolvedValue('class-1'),
  resolveTeacherManagedClassIds: vi.fn().mockResolvedValue(['class-1']),
  resolveTeacherTeachingClassIds: vi.fn().mockResolvedValue(['class-1']),
}));

import { actionIntentDetector } from './actionIntentDetector';
import { AIService } from '../aiService';
import { prisma } from '../../lib/prisma';

describe('AIService multi-turn notification flow', () => {
  const service = new AIService();
  const hodUser = {
    sub: 'hod-1',
    role: UserRole.HOD,
    schoolId: 'school-1',
    departmentId: 'dept-1',
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turn 1: bare post notification asks message (department auto-scoped)', async () => {
    vi.mocked(actionIntentDetector.detect).mockResolvedValue({
      isAction: true,
      action: 'send_department_notification',
      params: { message: '' },
      requiresConfirmation: true,
      description: 'Send notification',
    });

    const r = await service.query(hodUser as any, 'post a notification');
    expect(r.intent).toBe('action_slot_fill');
    expect(r.pendingAction?.awaitingSlot).toBe('message');
  });

  it('turn 2: message triggers confirmation', async () => {
    const r = await service.query(hodUser as any, 'Staff meeting at 3pm', {
      pendingAction: {
        action: 'send_department_notification',
        params: { notifyScope: 'department' },
        description: 'Notify dept',
        awaitingSlot: 'message',
      },
    });
    expect(r.intent).toBe('action_confirmation');
    expect(r.requiresConfirmation).toBe(true);
    expect(r.pendingAction?.params.message).toBe('Staff meeting at 3pm');
  });

  it('turn 3: confirm executes sendScopedNotification', async () => {
    const r = await service.query(hodUser as any, 'yes', {
      confirmAction: true,
      pendingAction: {
        action: 'send_department_notification',
        params: { notifyScope: 'department', message: 'Staff meeting at 3pm' },
        description: 'Send in-app notification to your department',
      },
    });
    expect(r.intent).toBe('action_executed');
    expect(mockSendScoped).toHaveBeenCalled();
    expect(r.answer).toMatch(/sent to/i);
  });

  it('teacher send_class_message: yes without confirmAction still executes', async () => {
    vi.mocked(actionIntentDetector.detect).mockResolvedValue({ isAction: false });
    vi.mocked(prisma.class.findMany).mockResolvedValueOnce([
      { id: 'class-1', name: 'Form 1A' },
    ] as any);
    const teacherUser = {
      sub: 'teacher-1',
      role: UserRole.TEACHER,
      schoolId: 'school-1',
      classId: 'class-stale',
    } as const;

    const r = await service.query(teacherUser as any, 'yes', {
      pendingAction: {
        action: 'send_class_message',
        params: { message: 'Homework due Friday' },
        description: 'Send in-app message to your class',
      },
    });

    expect(r.intent).toBe('action_executed');
    expect(mockSendScoped).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'teacher-1', role: UserRole.TEACHER }),
      expect.objectContaining({
        scope: 'class',
        message: 'Homework due Friday',
        channels: ['inapp'],
      }),
    );
  });

  it('super admin control actions always ask for confirmation before executing', async () => {
    vi.mocked(actionIntentDetector.detect).mockResolvedValue({
      isAction: true,
      action: 'run_terminal_command',
      params: { command: '@check ai' },
      requiresConfirmation: true,
      description: 'Run AI diagnostics.',
    });

    const superAdmin = {
      sub: 'super-1',
      role: UserRole.SUPER_ADMIN,
      schoolId: 'platform',
    } as const;

    const r = await service.query(superAdmin as any, '@check ai');

    expect(r.intent).toBe('action_confirmation');
    expect(r.requiresConfirmation).toBe(true);
    expect(r.pendingAction).toMatchObject({
      action: 'run_terminal_command',
      params: { command: '@check ai' },
    });
    expect(mockSendScoped).not.toHaveBeenCalled();
  });
});
