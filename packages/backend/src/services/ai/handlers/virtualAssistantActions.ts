import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';
import { getActionsForRole } from '../roleActionRegistry';

// ─── Handler ──────────────────────────────────────────────────────────────────

const listCapabilitiesHandler: ActionHandler = async (_params, scope) => {
  const actions = getActionsForRole(scope.role);

  if (actions.length === 0) {
    return { answer: 'No capabilities are currently available for your role.' };
  }

  const lines: string[] = [
    `🤖 **AI Assistant Capabilities** (${scope.role})`,
    '',
    'Here is what I can do for you:',
    '',
  ];

  actions.forEach((a) => {
    lines.push(`  • **${a.action}** — ${a.description}`);
  });

  lines.push(
    '',
    `I currently support **${actions.length}** action(s) for your role.`,
    'Say "help" or the name of any action above to get started.',
  );

  return {
    answer: lines.join('\n'),
    data: { role: scope.role, actionCount: actions.length, actions: actions.map((a) => a.action) },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const virtualAssistantActions: ActionDefinition[] = [
  {
    action: 'list_capabilities',
    description: 'List all AI capabilities and commands available for your current role',
    destructive: false,
    patterns: [
      /(?:what|list|show)\s+(?:can\s+you\s+do|capabilities|help|commands|actions)/i,
      /what\s+(?:are\s+)?(?:your\s+)?(?:capabilities|commands|actions|features)/i,
      /(?:show|list)\s+(?:me\s+)?(?:all\s+)?(?:available\s+)?commands/i,
      /^help\s*$/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List all AI capabilities available for your role.',
    handler: listCapabilitiesHandler,
  },
];