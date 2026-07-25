import { getActionsForRole, isActionPermitted, normalizeActionPatterns } from './roleActionRegistry';
import { classifyIntent } from './llmActionClassifier';

// ─── Fuzzy matching (typo tolerance) ────────────────────────────────────────────
// Real people mistype. "susspend", "notifiy", "sesson", "genrate", "adim" must
// still reach the classifier instead of dying at the keyword gate. We compare
// each token against known action verbs/nouns with a bounded edit distance so a
// slip of one or two characters still counts as a match.

/** Levenshtein edit distance, capped early once it exceeds `max` (perf guard). */
function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // whole row already over budget
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/** Edit-distance budget that scales with word length (longer words tolerate more). */
function fuzzyBudget(word: string): number {
  if (word.length <= 4) return 1;
  if (word.length <= 8) return 2;
  return 2;
}

/**
 * True when any token in `tokens` matches `keyword` exactly OR within its fuzzy
 * budget. Short keywords (<=3 chars) require an exact match to avoid noise.
 */
function tokenFuzzyMatches(tokens: string[], keyword: string): boolean {
  if (keyword.length <= 3) return tokens.includes(keyword);
  const budget = fuzzyBudget(keyword);
  return tokens.some((t) => {
    if (t === keyword) return true;
    if (Math.abs(t.length - keyword.length) > budget) return false;
    return editDistance(t, keyword, budget) <= budget;
  });
}

/** True when the message contains a fuzzy hit for ANY of the supplied keywords. */
function anyKeywordFuzzy(tokens: string[], keywords: readonly string[]): boolean {
  return keywords.some((kw) => tokenFuzzyMatches(tokens, kw));
}

// Domain nouns — the SAMS things an action usually targets.
const DOMAIN_NOUNS: readonly string[] = [
  'attendance', 'timetable', 'schedule', 'report', 'risk', 'student', 'students',
  'teacher', 'teachers', 'class', 'classes', 'department', 'school', 'schools',
  'session', 'sessions', 'notification', 'notifications', 'message', 'messages',
  'parent', 'parents', 'guardian', 'guardians', 'license', 'licence', 'payment',
  'payments', 'roster', 'admin', 'user', 'users', 'password', 'reminder',
  'reminders', 'hod', 'stats', 'statistics',
];

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

    // Tokenize on non-letters so "notify:" / "sesson." / "students," still split
    // into clean words for fuzzy comparison.
    const tokens = q.split(/[^a-z]+/).filter(Boolean);
    if (tokens.length === 0) return false;

    // Any strong action verb (fuzzy) is enough on its own — mirrors the old
    // "verb anywhere" rule but now tolerates typos like "susspend"/"notifiy".
    const STRONG_VERBS = [
      'send', 'notify', 'email', 'export', 'download', 'generate', 'create',
      'add', 'delete', 'remove', 'clear', 'update', 'change', 'reset', 'suspend',
      'unsuspend', 'block', 'unblock', 'start', 'stop', 'trigger', 'run', 'mark',
      'register', 'remind', 'extend', 'renew', 'reactivate',
    ] as const;
    if (anyKeywordFuzzy(tokens, STRONG_VERBS)) return true;

    // Read/lookup verbs count only when a domain noun is also present (fuzzy on
    // both) — "show attendance", "pul up my timetabel", "chek the roster".
    const READ_VERBS = [
      'show', 'view', 'list', 'check', 'read', 'get', 'find', 'pull', 'bring',
      'display', 'lookup', 'search', 'open',
    ] as const;
    if (anyKeywordFuzzy(tokens, READ_VERBS) && anyKeywordFuzzy(tokens, DOMAIN_NOUNS)) {
      return true;
    }

    // "how many <thing>" headcount questions (typo-tolerant on the noun).
    if (
      /\bhow\s+many\b/.test(q) &&
      anyKeywordFuzzy(tokens, [
        'students', 'teachers', 'classes', 'users', 'schools', 'sessions', 'departments',
      ])
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
