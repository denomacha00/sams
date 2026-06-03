import { getActionsForRole } from './roleActionRegistry';

/**
 * Summarize executable actions for the user's role (injected into the LLM system prompt).
 */
export function buildRoleActionsPromptSection(role: string): string {
  const actions = getActionsForRole(role);
  if (actions.length === 0) return '';

  const lines = actions.map(
    (a) =>
      `• ${a.action}: ${a.description}${a.destructive ? ' [requires user confirmation]' : ''}`,
  );

  return (
    '\n\nROLE ACTIONS (backend executes these when the user asks in natural language; ' +
    'destructive actions require confirmation first):\n' +
    lines.join('\n')
  );
}

export function isConversationMemoryEnabled(): boolean {
  const key = process.env.CONVERSATION_MASTER_KEY;
  return Boolean(key && key.length >= 32);
}
