import { afterEach, describe, expect, it } from 'vitest';
import { buildRoleActionsPromptSection, isConversationMemoryEnabled } from './roleActionsPrompt';
import { UserRole } from '@sams/shared';

describe('buildRoleActionsPromptSection', () => {
  it('includes super admin actions for SUPER_ADMIN role', () => {
    const section = buildRoleActionsPromptSection(UserRole.SUPER_ADMIN);
    expect(section).toContain('ROLE ACTIONS');
    expect(section.length).toBeGreaterThan(50);
  });

  it('returns scope-only section for unknown role', () => {
    expect(buildRoleActionsPromptSection('UNKNOWN_ROLE')).toBe('');
  });

  it('lists teacher actions and forbidden admin operations', () => {
    const section = buildRoleActionsPromptSection(UserRole.TEACHER);
    expect(section).toContain('start_session');
    expect(section).toContain('view_class_roster');
    expect(section).toContain('send_class_message');
    expect(section).toContain('create_registration_link');
    expect(section).toContain('FORBIDDEN');
    expect(section).toContain('add_user');
    expect(section).not.toContain('add_knowledge');
  });

  it('lists student actions without admin verbs', () => {
    const section = buildRoleActionsPromptSection(UserRole.STUDENT);
    expect(section).toContain('view_attendance');
    expect(section).toContain('FORBIDDEN');
    expect(section).toContain('add_user');
  });
});

describe('isConversationMemoryEnabled', () => {
  const previous = process.env.CONVERSATION_MASTER_KEY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.CONVERSATION_MASTER_KEY;
    } else {
      process.env.CONVERSATION_MASTER_KEY = previous;
    }
  });

  it('is false when key is missing or too short', () => {
    delete process.env.CONVERSATION_MASTER_KEY;
    expect(isConversationMemoryEnabled()).toBe(false);
    process.env.CONVERSATION_MASTER_KEY = 'short';
    expect(isConversationMemoryEnabled()).toBe(false);
  });

  it('is true when key has at least 32 characters', () => {
    process.env.CONVERSATION_MASTER_KEY = 'a'.repeat(32);
    expect(isConversationMemoryEnabled()).toBe(true);
  });
});
