import { getActionsForRole } from './roleActionRegistry';
import { getForbiddenActionNames, getRoleScopeNote } from './roleRestrictions';

/**
 * Summarize executable actions for the user's role (injected into the LLM system prompt).
 */
export function buildRoleActionsPromptSection(role: string): string {
  const actions = getActionsForRole(role);
  const scopeNote = getRoleScopeNote(role);
  const forbidden = getForbiddenActionNames(role);

  if (actions.length === 0) {
    if (!scopeNote) return '';
    return (
      '\n\nROLE ACTIONS: None are executable via chat for your role. ' +
      'Answer questions within your data scope only; do not offer administrative actions.\n' +
      `Scope: ${scopeNote}`
    );
  }

  const lines = actions.map(
    (a) =>
      `• ${a.action}: ${a.description}${a.destructive ? ' [requires user confirmation]' : ''}`,
  );

  let section =
    '\n\nROLE ACTIONS (ONLY these can be executed by the backend when the user asks in natural language; ' +
    'destructive actions require confirmation first — never invent other actions):\n' +
    lines.join('\n');

  if (scopeNote) {
    section += `\n\nRole scope: ${scopeNote}`;
  }

  if (forbidden.length > 0) {
    section +=
      '\n\nFORBIDDEN for your role (never offer, never claim you did these): ' +
      forbidden.join(', ') +
      '. If asked, refuse politely and list permitted actions above.';
  }

  return section;
}

export function isConversationMemoryEnabled(): boolean {
  const key = process.env.CONVERSATION_MASTER_KEY;
  return Boolean(key && key.length >= 32);
}

/**
 * Concise CAN / CANNOT block for LLM system prompts (role capability matrix).
 */
export function buildRoleCapabilityMatrix(role: string): string {
  const scopeNote = getRoleScopeNote(role);
  const forbidden = getForbiddenActionNames(role);
  const actions = getActionsForRole(role);

  const canList =
    actions.length > 0
      ? actions.slice(0, 12).map((a) => a.action).join(', ') +
        (actions.length > 12 ? ', …' : '')
      : 'read scoped SAMS data via chat (attendance, timetable, reports)';

  let block = `\n\nROLE CAPABILITY MATRIX (${role}):\n• You CAN: ${canList}.`;
  if (scopeNote) block += `\n• Scope: ${scopeNote}`;
  if (forbidden.length > 0) {
    block += `\n• You CANNOT: ${forbidden.slice(0, 10).join(', ')}${forbidden.length > 10 ? ', …' : ''}.`;
  }
  block +=
    '\n• NEVER invent attendance %, student names, schedules, or counts — use database handlers or say data was not found.';

  return block;
}
