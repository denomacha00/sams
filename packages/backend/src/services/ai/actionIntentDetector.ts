// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectedAction {
  isAction: boolean;
  action?: string; // matches ai-action endpoint schema: generate_license, suspend_school, unsuspend_school, extend_license, get_school_info, get_system_stats
  params?: Record<string, unknown>;
  requiresConfirmation: boolean;
  description?: string;
}

// ─── Action Pattern Definitions ───────────────────────────────────────────────

interface ActionPattern {
  action: string;
  patterns: RegExp[];
  extractParams: (question: string, match: RegExpMatchArray | null) => Record<string, unknown>;
  descriptionTemplate: (params: Record<string, unknown>) => string;
}

const VALID_PLAN_TIERS = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as const;

/**
 * Extract a school name from the text following an action keyword.
 * Cleans up common filler words and trims whitespace.
 */
function extractSchoolName(text: string): string {
  return text
    .replace(/^(the|school|named|called)\s+/i, '')
    .replace(/\s*(please|now|immediately|asap)\s*$/i, '')
    .trim();
}

/**
 * Extract a plan tier from the question text.
 * Returns the matched tier in uppercase or undefined if not found.
 */
function extractPlanTier(question: string): string | undefined {
  const q = question.toUpperCase();
  for (const tier of VALID_PLAN_TIERS) {
    if (q.includes(tier)) {
      return tier;
    }
  }
  return undefined;
}

/**
 * Extract a number of days from the question text.
 */
function extractDays(question: string): number | undefined {
  const match = question.match(/(\d+)\s*days?/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

// ─── Action Patterns ──────────────────────────────────────────────────────────

const ACTION_PATTERNS: ActionPattern[] = [
  {
    action: 'suspend_school',
    patterns: [
      /suspend\s+(.+)/i,
      /block\s+(.+)/i,
      /disable\s+(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
      return { schoolName };
    },
    descriptionTemplate: (params) => `Suspend school "${params.schoolName}" — this will block all users from logging in.`,
  },
  {
    action: 'unsuspend_school',
    patterns: [
      /unsuspend\s+(.+)/i,
      /unblock\s+(.+)/i,
      /reactivate\s+(.+)/i,
      /enable\s+(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
      return { schoolName };
    },
    descriptionTemplate: (params) => `Unsuspend school "${params.schoolName}" — users will be able to log in again.`,
  },
  {
    action: 'generate_license',
    patterns: [
      /generate\s+(?:a\s+)?(?:license|key)\s+(?:for\s+)?(.+)/i,
      /create\s+(?:a\s+)?(?:license|key)\s+(?:for\s+)?(.+)/i,
      /new\s+license\s+(?:for\s+)?(.+)/i,
      /new\s+(?:license|key)\s+(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const remainder = match && match[1] ? match[1].trim() : '';
      const planTier = extractPlanTier(question) || 'BASIC';
      // Remove the plan tier from the remainder to get the school name
      let schoolName = remainder;
      for (const tier of VALID_PLAN_TIERS) {
        schoolName = schoolName.replace(new RegExp(`\\b${tier}\\b`, 'i'), '').trim();
      }
      // Clean up common filler words
      schoolName = schoolName
        .replace(/^(plan|tier|with|on)\s+/i, '')
        .replace(/\s*(plan|tier|with|on)\s*$/i, '')
        .replace(/^(for|to)\s+/i, '')
        .trim();
      schoolName = extractSchoolName(schoolName);
      return { schoolName: schoolName || 'Unnamed School', planTier };
    },
    descriptionTemplate: (params) => `Generate a ${params.planTier} license key for "${params.schoolName}".`,
  },
  {
    action: 'extend_license',
    patterns: [
      /extend\s+(.+?)\s+by\s+(\d+)\s*days?/i,
      /add\s+(\d+)\s*days?\s+to\s+(.+)/i,
      /renew\s+(.+)/i,
      /extend\s+(?:license\s+(?:for\s+)?)?(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const days = extractDays(question) || 30;
      let schoolName = '';

      if (match) {
        // "extend [school] by [N] days" pattern
        if (/extend\s+(.+?)\s+by\s+\d+/i.test(question)) {
          const m = question.match(/extend\s+(.+?)\s+by\s+\d+/i);
          schoolName = m && m[1] ? extractSchoolName(m[1]) : '';
        }
        // "add [N] days to [school]" pattern
        else if (/add\s+\d+\s*days?\s+to\s+(.+)/i.test(question)) {
          const m = question.match(/add\s+\d+\s*days?\s+to\s+(.+)/i);
          schoolName = m && m[1] ? extractSchoolName(m[1]) : '';
        }
        // "renew [school]" or "extend [school]" pattern
        else {
          schoolName = match[1] ? extractSchoolName(match[1]) : '';
        }
      }

      // Clean up "license for" prefix if present
      schoolName = schoolName.replace(/^license\s+(?:for\s+)?/i, '').trim();

      return { schoolName, daysToAdd: days };
    },
    descriptionTemplate: (params) => `Extend license for "${params.schoolName}" by ${params.daysToAdd} days.`,
  },
  {
    action: 'get_school_info',
    patterns: [
      /(?:info|information)\s+(?:about|on|for)\s+(.+)/i,
      /details?\s+(?:of|about|for)\s+(.+)/i,
      /show\s+(.+?)\s+info/i,
      /what\s+about\s+(.+)/i,
      /tell\s+me\s+about\s+(.+?)\s+school/i,
      /school\s+info\s+(?:for\s+)?(.+)/i,
    ],
    extractParams: (question: string, match: RegExpMatchArray | null) => {
      const schoolName = match && match[1] ? extractSchoolName(match[1]) : '';
      return { schoolName };
    },
    descriptionTemplate: (params) => `Get information about school "${params.schoolName}".`,
  },
  {
    action: 'get_system_stats',
    patterns: [
      /system\s*stats/i,
      /platform\s*stats/i,
      /how\s+many\s+schools/i,
      /total\s+revenue/i,
      /dashboard\s*stats/i,
      /system\s*overview/i,
      /platform\s*overview/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => `Retrieve system-wide statistics (schools, users, revenue, etc.).`,
  },
];

// ─── Destructive Actions ──────────────────────────────────────────────────────

const DESTRUCTIVE_ACTIONS = new Set(['suspend_school']);

// ─── ActionIntentDetector ─────────────────────────────────────────────────────

/**
 * Classifies Super Admin messages as informational queries or action requests.
 * Uses regex/keyword pattern matching (not LLM calls) to detect actions,
 * extract parameters, and determine if confirmation is needed.
 */
class ActionIntentDetector {
  /**
   * Detect whether a question is an action request.
   * Only activates for SUPER_ADMIN role users.
   */
  detect(question: string, userRole: string): DetectedAction {
    // Only activate for SUPER_ADMIN role
    if (userRole !== 'SUPER_ADMIN') {
      return { isAction: false, requiresConfirmation: false };
    }

    const q = question.trim();
    if (!q) {
      return { isAction: false, requiresConfirmation: false };
    }

    // Try each action pattern in order
    for (const actionPattern of ACTION_PATTERNS) {
      for (const pattern of actionPattern.patterns) {
        const match = q.match(pattern);
        if (match) {
          const params = actionPattern.extractParams(q, match);
          const requiresConfirmation = this.isDestructiveAction(actionPattern.action);
          const description = actionPattern.descriptionTemplate(params);

          return {
            isAction: true,
            action: actionPattern.action,
            params,
            requiresConfirmation,
            description,
          };
        }
      }
    }

    // No action detected — treat as informational query
    return { isAction: false, requiresConfirmation: false };
  }

  /**
   * Determine if an action is destructive and requires confirmation.
   * Currently only suspend_school is considered destructive.
   */
  isDestructiveAction(action: string): boolean {
    return DESTRUCTIVE_ACTIONS.has(action);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const actionIntentDetector = new ActionIntentDetector();
