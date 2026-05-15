import { getActionsForRole, type ActionDefinition } from './roleActionRegistry';
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

    // Step 2: LLM fallback with role-scoped action candidates
    const llmResult = await this.detectByLLM(trimmed, userRole);
    return llmResult;
  }

  /**
   * Regex-based detection. Iterates patterns for the user's role only.
   */
  private detectByRegex(message: string, role: string): DetectedAction {
    const actions = getActionsForRole(role);

    for (const actionDef of actions) {
      for (const pattern of actionDef.patterns) {
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
