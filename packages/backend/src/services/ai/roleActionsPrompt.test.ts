import { describe, expect, it } from 'vitest';
import { buildRoleActionsPromptSection } from './roleActionsPrompt';
import { UserRole } from '@sams/shared';

describe('buildRoleActionsPromptSection', () => {
  it('includes super admin actions for SUPER_ADMIN role', () => {
    const section = buildRoleActionsPromptSection(UserRole.SUPER_ADMIN);
    expect(section).toContain('ROLE ACTIONS');
    expect(section.length).toBeGreaterThan(50);
  });

  it('returns empty string for unknown role', () => {
    expect(buildRoleActionsPromptSection('UNKNOWN_ROLE')).toBe('');
  });
});
