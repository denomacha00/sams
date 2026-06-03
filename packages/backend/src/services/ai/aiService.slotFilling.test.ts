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

import { actionIntentDetector } from './actionIntentDetector';
import { AIService } from '../aiService';

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

  it('turn 1: bare post notification asks scope', async () => {
    vi.mocked(actionIntentDetector.detect).mockResolvedValue({
      isAction: true,
      action: 'send_department_notification',
      params: { message: '' },
      requiresConfirmation: true,
      description: 'Send notification',
    });

    const r = await service.query(hodUser as any, 'post a notification');
    expect(r.intent).toBe('action_slot_fill');
    expect(r.pendingAction?.awaitingSlot).toBe('notifyScope');
    expect(r.answer).toMatch(/department/i);
  });

  it('turn 2: scope answer asks message', async () => {
    const r = await service.query(hodUser as any, 'department', {
      pendingAction: {
        action: 'send_department_notification',
        params: {},
        description: 'Notify',
        awaitingSlot: 'notifyScope',
      },
    });
    expect(r.intent).toBe('action_slot_fill');
    expect(r.pendingAction?.awaitingSlot).toBe('message');
  });

  it('turn 3: message triggers confirmation', async () => {
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

  it('turn 4: confirm executes sendScopedNotification', async () => {
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
});
