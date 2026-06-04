import { UserRole } from '@sams/shared';

/** Head of Department lookup — must catch bare "my hod" before LLM fallback. */
export const STUDENT_HOD_QUERY_PATTERNS: RegExp[] = [
  /^my\s+hod[\s?!.]*$/i,
  /\bmy\s+hod\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:my|our)\s+hod\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:the\s+)?hod\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:my|our)\s+head\s+of\s+department/i,
  /head\s+of\s+(?:my|our)\s+department/i,
  /(?:my|our)\s+head\s+of\s+department/i,
  /(?:my|our)\s+(?:department\s+)?hod\b/i,
  /who\s+is\s+(?:the\s+)?hod\s+for\s+(?:my|our)\s+(?:class|department)/i,
  /who\s+is\s+(?:the\s+)?hod\s+of\s+(?:this|my|our)\s+(?:dep(?:artment)?|dept)\b/i,
  /(?:this|my|our)\s+(?:dep(?:artment)?|dept)(?:'s)?\s+hod\b/i,
];

/** School administrator lookup — students, teachers, and HODs may ask. */
export const SCHOOL_ADMIN_QUERY_PATTERNS: RegExp[] = [
  /^school\s+admin[\s?!.]*$/i,
  /\b(?:my|our)\s+school\s+admin(?:istrator)?\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:the\s+)?(?:school\s+)?(?:admin|adim)(?:istrator)?(?:\s+of\s+(?:this|my|our)\s+school)?\b/i,
  /(?:who|which)\s+(?:are\s+)?(?:is\s+)?(?:the\s+)?school\s+admin(?:istrator)?\b/i,
  /\b(?:school\s+)?admin(?:istrator)?\s+of\s+(?:this|my|our)\s+school\b/i,
  /\bwho\s+is\s+(?:the\s+)?adim\b/i,
];

/** Roles that may resolve school admin via DB (not LLM). */
export const SCHOOL_ADMIN_LOOKUP_ROLES: UserRole[] = [
  UserRole.STUDENT,
  UserRole.TEACHER,
  UserRole.HOD,
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
  { patterns: SCHOOL_ADMIN_QUERY_PATTERNS, action: 'list_school_admin' },
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

/** SAMS personnel lookups (HOD, school admin) — block LLM even when phrased as "who is …". */
export function isSchoolPersonnelQuery(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (isStudentContextQuery(q)) return true;
  return (
    STUDENT_HOD_QUERY_PATTERNS.some((p) => p.test(q)) ||
    SCHOOL_ADMIN_QUERY_PATTERNS.some((p) => p.test(q))
  );
}

/**
 * Fetch real student class/department/HOD/teachers/rep data — never LLM for these phrases.
 * @deprecated Prefer queryRoleContext — kept for existing imports.
 */
export { queryRoleContext as queryStudentContext } from './roleContextQuery';
