/**
 * Shared timetable view vs manage detection for local engine, role actions, and AI routing.
 */

/** User wants to create/regenerate a timetable — not view. */
export const TIMETABLE_MANAGE_PATTERNS: RegExp[] = [
  /remake\s*(a\s*)?timetable/i,
  /regenerate\s*(a\s*)?timetable/i,
  /redo\s*(a\s*)?timetable/i,
  /re[\s-]*generate\s*(a\s*)?timetable/i,
  /re[\s-]*create\s*(a\s*)?timetable/i,
  /delete\s*and\s*(re)?create\s*(a\s*)?timetable/i,
  /reset\s*(a\s*)?timetable/i,
  /rebuild\s*(a\s*)?timetable/i,
  /fresh\s*timetable/i,
  /generate\s*(a\s*)?timetable/i,
  /create\s*(a\s*)?timetable/i,
  /make\s*(a\s*)?timetable/i,
  /auto[\s-]*generate\s*(a\s*)?timetable/i,
  /build\s*(a\s*)?timetable/i,
  /new\s*timetable/i,
  /set\s*up\s*(a\s*)?timetable/i,
];

/** User wants to see their schedule — matches informal phrasing like "MY TIME TABLE". */
export const TIMETABLE_VIEW_PATTERNS: RegExp[] = [
  /show\s*(me\s*)?(the\s*)?(?:my\s+)?(?:time\s*table|timetable|schedule)/i,
  /view\s*(the\s*)?(?:my\s+)?(?:time\s*table|timetable|schedule)/i,
  /display\s*(the\s*)?(?:my\s+)?(?:time\s*table|timetable|schedule)/i,
  /my\s+(?:time\s*table|timetable|schedule)/i,
  /(?:want|need|get|give\s+me|i\s+want).{0,40}(?:time\s*table|timetable|schedule)/i,
  /what(?:'s| is)\s*(the\s*)?(?:my\s+)?(?:class\s*)?(?:time\s*table|timetable|schedule)/i,
  /class\s+(?:time\s*table|timetable|schedule)/i,
  /when\s+do\s+(?:i|we)\s+have\s+(?:class|classes|lesson|lessons)/i,
  /what\s*(classes|lessons)\s*(do\s*(i|we)\s*have|are\s*there)/i,
  /today(?:'s)?\s*(?:time\s*table|timetable|schedule|classes)/i,
  /(?:time\s*table|timetable)\s*(?:for|of)/i,
  /^(?:time\s*table|timetable|schedule)[\s?!.]*$/i,
  /\b(?:time\s*table|timetable)\b/i,
];

export function isTimetableManageQuery(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  return TIMETABLE_MANAGE_PATTERNS.some((p) => p.test(q));
}

export function isTimetableViewQuery(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (isTimetableManageQuery(q)) return false;
  return TIMETABLE_VIEW_PATTERNS.some((p) => p.test(q));
}
