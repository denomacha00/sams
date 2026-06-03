import { type AccessTokenPayload, UserRole } from '@sams/shared';
import type { AIQueryResult } from './localEngine';
import { findAction, type ActionScope } from './roleActionRegistry';

/** Head of Department lookup — must catch bare "my hod" before LLM fallback. */
export const STUDENT_HOD_QUERY_PATTERNS: RegExp[] = [
  /^my\s+hod[\s?!.]*$/i,
  /\bmy\s+hod\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:my|our)\s+hod\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:my|our)\s+head\s+of\s+department/i,
  /head\s+of\s+(?:my|our)\s+department/i,
  /(?:my|our)\s+head\s+of\s+department/i,
  /(?:my|our)\s+(?:department\s+)?hod\b/i,
  /who\s+is\s+(?:the\s+)?hod\s+for\s+(?:my|our)\s+(?:class|department)/i,
];

export const STUDENT_TEACHERS_QUERY_PATTERNS: RegExp[] = [
  /(?:who|which)\s+(?:are\s+)?(?:my|our)\s+teachers?/i,
  /(?:name|names)\s+of\s+(?:my|our)\s+teachers?/i,
  /^my\s+teachers?[\s?!.]*$/i,
  /\bmy\s+teachers?\b/i,
  /who\s+teaches?\s+(?:me|us)/i,
  /who\s+is\s+(?:my|our)\s+(?:class\s+)?teacher/i,
  /teachers?\s+for\s+(?:my|our)\s+class/i,
  /list\s+(?:my|our)\s+teachers?/i,
];

/** Class rep before generic "my class" so rep questions are not misclassified. */
export const STUDENT_CLASS_REP_QUERY_PATTERNS: RegExp[] = [
  /who\s+is\s+(?:my|our)\s+class\s+rep(?:resentative)?/i,
  /(?:my|our)\s+class\s+rep(?:resentative)?/i,
  /class\s+rep(?:resentative)?\s+for\s+(?:my|our)\s+class/i,
  /who\s+is\s+the\s+class\s+rep(?:resentative)?/i,
];

export const STUDENT_CLASS_QUERY_PATTERNS: RegExp[] = [
  /(?:what|which)\s+class\s+am\s+i\s+(?:in|assigned\s+to)/i,
  /^my\s+class[\s?!.]*$/i,
  /\bmy\s+class\b/i,
  /what\s+is\s+(?:my|our)\s+class\s+name/i,
];

export const STUDENT_DEPARTMENT_QUERY_PATTERNS: RegExp[] = [
  /^my\s+department[\s?!.]*$/i,
  /\bmy\s+department\b/i,
  /(?:what|which)\s+department\s+am\s+i\s+in/i,
  /what\s+is\s+(?:my|our)\s+department/i,
];

const CONTEXT_ACTION_ORDER: Array<{ patterns: RegExp[]; action: string }> = [
  { patterns: STUDENT_CLASS_REP_QUERY_PATTERNS, action: 'who_is_class_rep' },
  { patterns: STUDENT_HOD_QUERY_PATTERNS, action: 'list_my_hod' },
  { patterns: STUDENT_TEACHERS_QUERY_PATTERNS, action: 'list_my_teachers' },
  { patterns: STUDENT_CLASS_QUERY_PATTERNS, action: 'describe_my_class' },
  { patterns: STUDENT_DEPARTMENT_QUERY_PATTERNS, action: 'describe_my_department' },
];

export function detectStudentContextAction(question: string): string | null {
  const q = question.trim();
  if (!q) return null;
  for (const { patterns, action } of CONTEXT_ACTION_ORDER) {
    if (patterns.some((p) => p.test(q))) return action;
  }
  return null;
}

export function isStudentContextQuery(question: string): boolean {
  return detectStudentContextAction(question) !== null;
}

/**
 * Fetch real student class/department/HOD/teachers/rep data — never LLM for these phrases.
 */
export async function queryStudentContext(
  user: AccessTokenPayload,
  question: string,
): Promise<AIQueryResult | null> {
  if (user.role !== UserRole.STUDENT) return null;

  const action = detectStudentContextAction(question);
  if (!action) return null;

  const actionDef = findAction(UserRole.STUDENT, action);
  if (!actionDef) return null;

  const scope: ActionScope = {
    userId: user.sub,
    role: user.role,
    schoolId: user.schoolId,
    departmentId: user.departmentId,
    classId: user.classId,
  };

  const result = await actionDef.handler({}, scope);
  return {
    answer: result.answer,
    intent: action,
    data: result.data,
  };
}
