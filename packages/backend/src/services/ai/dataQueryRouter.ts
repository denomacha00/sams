import type { AccessTokenPayload } from '@sams/shared';
import {
  detectIntent,
  localQuery,
  type AIQueryResult,
  type DetectedIntent,
} from './localEngine';
import { isTimetableManageQuery, isTimetableViewQuery } from './timetableQuery';
import {
  isSchoolPersonnelQuery,
  isStudentContextQuery,
  queryRoleContext,
} from './roleContextQuery';

/** Broad SAMS data keywords — used only when intent is still unknown. */
const SAMS_DATA_KEYWORD_RE =
  /\b(?:attendance|absent|present\s+today|timetable|time\s*table|schedule|risk\s*score|at[\s-]?risk|roster|class\s+list|active\s+session|student\s+count|how\s+many\s+students)\b/i;

/** Questions that are general knowledge / how-to, not live SAMS data pulls. */
const NON_DATA_QUESTION_RE =
  /^(?:what\s+is|who\s+is|when\s+was|where\s+is|why\s+is|explain|define|describe|how\s+do\s+you\s+spell|tell\s+me\s+about)\s+(?!sams\b|attendance\s+system)/i;

const INFORMATIONAL_INTENTS: DetectedIntent[] = ['about_sams', 'super_admin_help', 'custom_knowledge'];

export const SAMS_DATA_NOT_FOUND_MESSAGE =
  "I couldn't find that in SAMS with your current wording. Try a specific question like \"show my timetable\", \"what is my attendance\", or \"who is absent today\" — or check the dashboard for the full view.";

/**
 * Detect SAMS data intent (alias for detectIntent — patterns live in localEngine).
 */
export function detectDataIntent(question: string): DetectedIntent {
  return detectIntent(question);
}

/**
 * True when the user is asking for live SAMS data (not general chat or platform actions).
 */
export function isSamsDataQuery(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  if (isTimetableViewQuery(q) || isTimetableManageQuery(q)) return true;
  if (isStudentContextQuery(q)) return true;
  if (isSchoolPersonnelQuery(q)) return true;

  const intent = detectDataIntent(q);
  if (intent !== 'unknown' && !INFORMATIONAL_INTENTS.includes(intent)) return true;

  if (NON_DATA_QUESTION_RE.test(q)) {
    if (isSchoolPersonnelQuery(q)) return true;
    return false;
  }

  return SAMS_DATA_KEYWORD_RE.test(q);
}

/**
 * Second-pass local data fetch after core localQuery returned unknown.
 */
export async function querySamsDataFallback(
  user: AccessTokenPayload,
  question: string,
): Promise<AIQueryResult | null> {
  const { queryTimetableView } = await import('./localEngine');
  const timetable = await queryTimetableView(user, question);
  if (timetable) return timetable;

  const studentContext = await queryRoleContext(user, question);
  if (studentContext) return studentContext;

  if (detectDataIntent(question) === 'unknown') return null;

  const result = await localQuery(user, question);
  if (result.intent !== 'unknown') return result;
  return null;
}
