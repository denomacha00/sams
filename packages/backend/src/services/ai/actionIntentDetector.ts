import { getActionsForRole, isActionPermitted, normalizeActionPatterns } from './roleActionRegistry';
import { classifyIntent } from './llmActionClassifier';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectedAction {
  isAction: boolean;
  action?: string;
  params?: Record<string, unknown>;
  requiresConfirmation: boolean;
  description?: string;
}

// ─── ActionIntentDetector ─────────────────────────────────────────────────────

/**
 * Classifies user messages as informational queries or action requests.
 * Uses a hybrid approach:
 *   1. Regex patterns from the Role-Action Registry (fast path)
 *   2. LLM fallback classification with role-scoped candidates (slow path)
 *
 * Supports all roles — no longer restricted to SUPER_ADMIN.
 */
class ActionIntentDetector {
  /**
   * Detect whether a message is an action request for the given role.
   * Step 1: Try regex patterns from the registry for this role.
   * Step 2: If no regex match, invoke LLM fallback with role-scoped candidates.
   */
  async detect(message: string, userRole: string): Promise<DetectedAction> {
    const trimmed = message.trim();
    if (!trimmed) {
      return { isAction: false, requiresConfirmation: false };
    }

    // Step 1: Regex matching against role-specific patterns
    const regexResult = this.detectByRegex(trimmed, userRole);
    if (regexResult.isAction) {
      return regexResult;
    }

    if (this.isClearlyForbiddenActionPhrase(trimmed, userRole)) {
      return { isAction: false, requiresConfirmation: false };
    }

    if (!this.mightBeActionRequest(trimmed)) {
      return { isAction: false, requiresConfirmation: false };
    }

    // Step 2: LLM fallback with role-scoped action candidates
    const llmResult = await this.detectByLLM(trimmed, userRole);
    return llmResult;
  }

  private mightBeActionRequest(message: string): boolean {
    const q = message.toLowerCase();
    if (/^@\w+/.test(q)) return true;
    if (
      /\b(?:send|message|notify|email|sms|export|download|generate|create|add|delete|remove|clear|update|change|set|reset|suspend|unsuspend|start|stop|end|open|close|trigger|run|mark|register|remind)\b/.test(q)
    ) {
      return true;
    }
    if (
      /\b(?:show|view|list|pull\s+up|bring\s+up|check|read|get|find)\b/.test(q) &&
      /\b(?:attendance|timetable|schedule|report|risk|students?|teachers?|classes?|department|school|session|notifications?|messages?|parents?|guardians?|license|licence|payments?)\b/.test(q)
    ) {
      return true;
    }
    if (
      /\bhow\s+many\b/.test(q) &&
      /\b(?:students?|teachers?|classes?|users?|schools?|sessions?|departments?)\b/.test(q)
    ) {
      return true;
    }
    return false;
  }

  private isClearlyForbiddenActionPhrase(message: string, role: string): boolean {
    const q = message.toLowerCase();
    if (
      /\bhow\s+many\s+(?:teachers|students|classes|users)\b/.test(q) &&
      !isActionPermitted(role, 'get_school_stats') &&
      !isActionPermitted(role, 'view_department_stats')
    ) {
      return true;
    }

    const checks: Array<[RegExp, string]> = [
      [/^@\w+/, 'run_terminal_command'],
      [/\b(?:add|create|register)\s+(?:a\s+)?(?:user|teacher|staff|admin)\b/, 'add_user'],
      [/\b(?:my|show\s+my|view\s+my)\s+attendance\b/, 'view_attendance'],
      [/\b(?:notify|message|send\s+(?:a\s+)?(?:message|notification|notice)\s+to)\s+(?:the\s+)?school\b/, 'send_school_notification'],
      [/\b(?:notify|message|send\s+(?:a\s+)?(?:message|notification|notice)\s+to)\s+(?:the\s+)?department\b/, 'send_department_notification'],
      [/\b(?:reset|change|new)\s+(?:user\s+)?pass\s*word\b/, 'reset_user_password'],
      [/\b(?:suspend|unsuspend|block|unblock)\s+(?:the\s+)?school\b/, 'suspend_school'],
      [/\b(?:generate|create|new)\s+(?:a\s+)?(?:license|licence|key)\b/, 'generate_license'],
    ];

    return checks.some(([pattern, action]) => pattern.test(q) && !isActionPermitted(role, action));
  }

  /**
   * Regex-based detection. Iterates patterns for the user's role only.
   */
  private detectByRegex(message: string, role: string): DetectedAction {
    const actions = getActionsForRole(role);

    for (const actionDef of actions) {
      const patterns = normalizeActionPatterns(actionDef.patterns);
      for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
          const params = actionDef.extractParams(message, match);
          return {
            isAction: true,
            action: actionDef.action,
            params,
            requiresConfirmation: actionDef.destructive,
            description: actionDef.descriptionTemplate(params),
          };
        }
      }
    }

    return { isAction: false, requiresConfirmation: false };
  }

  /**
   * LLM fallback detection. Sends the message and role-permitted action
   * list to the LLM for classification.
   */
  private async detectByLLM(message: string, role: string): Promise<DetectedAction> {
    const actions = getActionsForRole(role);
    if (actions.length === 0) {
      return { isAction: false, requiresConfirmation: false };
    }
    if (!actions.some((a) => normalizeActionPatterns(a.patterns).length > 0)) {
      return { isAction: false, requiresConfirmation: false };
    }

    const candidates = actions.map((a) => ({
      action: a.action,
      description: a.description,
    }));

    // Call LLM classifier with role-scoped candidates
    const classification = await classifyIntent(message, candidates);

    if (!classification || classification.action === 'none') {
      return { isAction: false, requiresConfirmation: false };
    }

    // Find the matched action definition
    const actionDef = actions.find((a) => a.action === classification.action);
    if (!actionDef) {
      return { isAction: false, requiresConfirmation: false };
    }

    // Extract params from LLM response or re-parse from message
    const params = classification.params ?? actionDef.extractParams(message, null);

    return {
      isAction: true,
      action: actionDef.action,
      params,
      requiresConfirmation: actionDef.destructive,
      description: actionDef.descriptionTemplate(params),
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const actionIntentDetector = new ActionIntentDetector();
