/**
 * HumanResponseFormatter
 *
 * Transforms raw database answers into natural, human-sounding responses.
 * The goal: SAMS talks like a real person — warm, direct, uses contractions,
 * thinks out loud in phases, and never sounds like a bot.
 *
 * Instead of: "The attendance rate is 87.5% (42 present/late out of 48 total records)"
 * Now: "Sawa, lemme check your attendance... You're at 87% — doing great. 42 out of 48 sessions."
 *
 * Instead of: "3 student(s) marked absent today: Alice, Bob, Charlie"
 * Now: "3 students are out today: Alice, Bob, and Charlie. Want me to notify their guardians?"
 */

// ─── Patterns ────────────────────────────────────────────────────────────

const PERCENTAGE_RE = /(\d+\.?\d*)%\s*\((\d+).+?(\d+)\s*total/i;
const ABSENT_COUNT_RE = /(\d+)\s*student\(?s?\)?\s*marked\s*absent\s*today:\s*(.+)/i;
const ABSENT_COUNT_SHORT_RE = /^(\d+)\s*student\(?s?\)?\s*marked\s*absent/i;
const TOP_STUDENTS_RE = /Top\s+students?\s*by\s*attendance:\s*([\s\S]+)/i;
const RISK_SCORE_RE = /(\d+)\s*student\(?s?\)?\s*at\s+(?:high\/critical\s+)?risk/i;
const CLASS_COMPARISON_RE = /Class\s+attendance\s+comparison:\s*([\s\S]+)/i;
const TIMETABLE_RE = /📅\s*(?:Timetable|Your\s*Timetable|Today)/i;
const NO_DATA_RE = /(?:No|no)\s+(attendance|records|students|entries|sessions?)/i;
const STATS_COUNT_RE = /(?:There\s+are|Total:?)?\s*(\d+)\s*(student|teacher|user|school|class)/i;
const ACTIVE_SESSIONS_RE = /(\d+)\s*active\s*session/i;
const SESSION_NO_ACTIVE_RE = /(?:No|no)\s+active\s+sessions/i;
const TIMETABLE_TODAY_RE = /📅\s*Today.+?No classes are scheduled/i;
const SESSION_STARTED_RE = /(?:started|created|launched)\s+session/i;
const GENERATED_TIMETABLE_RE = /Timetable.*generated|generated.*timetable|✅ Timetable/i;

// ─── Quality indicators ──────────────────────────────────────────────────

function qualityLabel(pct: number): string {
  if (pct >= 95) return 'near perfect — that\'s impressive';
  if (pct >= 85) return 'solid work';
  if (pct >= 75) return 'decent — room to improve';
  if (pct >= 60) return 'concerning — needs attention';
  return 'critical — we need to talk about this';
}

function qualityEmoji(pct: number): string {
  if (pct >= 95) return '💪';
  if (pct >= 85) return '✅';
  if (pct >= 75) return '👌';
  if (pct >= 60) return '⚠️';
  return '🚨';
}

// ─── Kenyan casual greetings ─────────────────────────────────────────────

function getGreeting(userName?: string): string {
  const greetings = [
    'Sawa,',
    'Alright,',
    'Okay,',
    'One sec —',
    'Lemme check... ',
    'Hang on... ',
  ];
  const prefix = greetings[Math.floor(Math.random() * greetings.length)];
  // Ensure a trailing space so "Alright," + "You've got..." doesn't collapse
  // into "Alright,You've got...".
  if (!userName) return prefix.replace(/\s*$/, ' ');
  return `${prefix} ${userName} — `;
}

function getTransition(): string {
  const transitions = [
    'Okay here\'s what I got:',
    'So here\'s the deal:',
    'Here\'s what I found:',
    'Right, so:',
    'Got it:',
    'Here:',
  ];
  return transitions[Math.floor(Math.random() * transitions.length)];
}

// ─── Main formatter ──────────────────────────────────────────────────────

export interface FormattedSuggestion {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface HumanResponse {
  text: string;
  suggestions: FormattedSuggestion[];
}

/**
 * Convert a raw database answer into a warm, human-sounding response.
 * Uses the user's actual name when available.
 */
export function formatHumanResponse(
  raw: string,
  context?: { role?: string; className?: string; hasActiveSession?: boolean; userName?: string },
): HumanResponse {
  const suggestions: FormattedSuggestion[] = [];
  let text = raw;

  // ─── Phase 0: Clean up raw text universal issues ───────────────────
  // Remove "(s)" nonsense like "student(s)" → "students"
  text = text.replace(/\(s\)/g, 's');

  // Fix "There are X student(s)" patterns
  text = text.replace(
    /There (?:is|are)\s+(\d+)\s+student(?:s)?\s+in\s+(?:the\s+)?(school|class|department)/gi,
    (_, count, scope) => {
      const n = parseInt(count, 10);
      const scopeName = scope?.toLowerCase() || 'school';
      const prefix = n === 0 ? "There aren't any" : n === 1 ? 'There is 1' : `There are ${n}`;
      return `${prefix} students in the ${scopeName}`;
    },
  );

  // Fix "No X found for your scope" → friendlier versions
  text = text.replace(
    /No\s+(attendance records|students|classes|sessions|entries)(\s+found)?\s+(?:within\s+)?(?:your\s+)?(scope|class|department)/gi,
    (_, entity) => `No ${entity.toLowerCase()} yet`,
  );

  // ─── Case 1: Attendance percentage ──────────────────────────────────
  const pctMatch = text.match(PERCENTAGE_RE);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const present = parseInt(pctMatch[2], 10);
    const total = parseInt(pctMatch[3], 10);
    const label = qualityLabel(pct);
    const emoji = qualityEmoji(pct);

    const userName = context?.userName || '';
    const greeting = getGreeting(userName);
    const subject = context?.role === 'STUDENT' ? "you're" : "it's";

    const userPhrase = userName ? `${userName}, ` : '';

    if (pct >= 95) {
      text = `${greeting}${emoji} Damn, ${subject} at **${pct}%** — ${label}. ${present} out of ${total} sessions. Keep it up!`;
    } else if (pct >= 85) {
      text = `${greeting}${emoji} ${subject} at **${pct}%** — ${label}. ${present} out of ${total} sessions.`;
    } else if (pct >= 75) {
      text = `${greeting}${emoji} ${subject} at **${pct}%** — ${label}. ${present} out of ${total} sessions. You can do better.`;
    } else {
      text = `${greeting}${emoji} ${subject} at **${pct}%** — ${label}. Only ${present} out of ${total} sessions. Let's work on this.`;
    }

    // Suggestions based on percentage
    if (pct < 75 && context?.role === 'STUDENT') {
      suggestions.push({
        label: '📅 See my timetable',
        action: 'view_timetable',
      });
    }
    if (context?.role === 'TEACHER' || context?.role === 'HOD' || context?.role === 'SCHOOL_ADMIN') {
      if (pct < 80) {
        suggestions.push({
          label: '📋 Show absent students',
          action: 'view_class_attendance',
        });
      }
    }

    return { text, suggestions };
  }

  // ─── Case 2: Absent students with names ─────────────────────────────
  const absentMatch = text.match(ABSENT_COUNT_RE);
  if (absentMatch) {
    const count = parseInt(absentMatch[1], 10);
    const names = absentMatch[2].replace(/,([^,]*)$/, ', and$1'); // Oxford comma
    const userName = context?.userName || '';
    const greeting = getGreeting(userName);

    if (count === 0) {
      text = `${greeting}No absent students today. Everyone's here. 👍`;
    } else {
      text = `${greeting}${count} student${count === 1 ? ' is' : 's are'} out today: **${names}**.`;
    }

    if (count > 0) {
      suggestions.push({
        label: count === 1 ? '👤 Mark them present?' : '📝 Notify guardians?',
        action: 'send_class_notification',
        params: { message: `Your child was absent today.` },
      });
    }

    return { text, suggestions };
  }

  // ─── Case 3: Absent count only (no names) ───────────────────────────
  const absentShortMatch = text.match(ABSENT_COUNT_SHORT_RE);
  if (absentShortMatch) {
    const count = parseInt(absentShortMatch[1], 10);
    const userName = context?.userName || '';
    const greeting = getGreeting(userName);

    text = `${greeting}${count} student${count === 1 ? '' : 's'} absent today.`;
    suggestions.push(
      { label: '👤 Show names', action: 'view_class_attendance' },
      { label: '📩 Notify parents', action: 'send_class_notification', params: { message: 'Your child was absent today.' } },
    );

    return { text, suggestions };
  }

  // ─── Case 4: Top students ───────────────────────────────────────────
  const topMatch = text.match(TOP_STUDENTS_RE);
  if (topMatch) {
    const list = topMatch[1].trim();
    text = `🏆 **Top performers:**\n${list}`;
    suggestions.push(
      { label: '📊 See bottom performers', action: 'view_risk_scores' },
      { label: '📋 Full class comparison', action: 'view_class_attendance' },
    );

    return { text, suggestions };
  }

  // ─── Case 5: Risk scores ────────────────────────────────────────────
  const riskMatch = text.match(RISK_SCORE_RE);
  if (riskMatch) {
    const count = parseInt(riskMatch[1], 10);
    if (count > 0) {
      text = `🚨 **${count} student${count === 1 ? '' : 's'} at risk.** Here's the breakdown:\n\n${text.replace(/^\d+\s+student.*risk\.\s*/i, '')}`;
      suggestions.push(
        { label: '📩 Send intervention notice', action: 'send_class_notification', params: { message: 'Attendance intervention needed for at-risk students.' } },
      );
    } else {
      text = 'No students at risk right now. All clear. ✅';
    }

    return { text, suggestions };
  }

  // ─── Case 6: Class comparison ───────────────────────────────────────
  const classMatch = text.match(CLASS_COMPARISON_RE);
  if (classMatch) {
    text = `📊 ${classMatch[1].trim()}`;
    suggestions.push({ label: '📈 Show risk scores', action: 'view_risk_scores' });

    return { text, suggestions };
  }

  // ─── Case 7: Stats counts ───────────────────────────────────────────
  // Skip pre-formatted status messages (action confirmations, errors). A
  // confirmation like "✅ In-app message sent to 12 user(s)..." must NOT be
  // rewritten into the "You've got 12 users in your school" stats template.
  const isStatusMessage = /^(?:✅|❌|⚠️|📩|📤)/.test(text) || /\bsent to\b/i.test(text);
  const statsMatch = isStatusMessage ? null : text.match(STATS_COUNT_RE);
  if (statsMatch) {
    const count = parseInt(statsMatch[1], 10);
    const entity = statsMatch[2].toLowerCase();
    const userName = context?.userName || '';
    const greeting = getGreeting(userName);

    const plural = entity + (count !== 1 ? 's' : '');
    const location = context?.role === 'SUPER_ADMIN' ? 'the platform' : 'your school';
    text = `${greeting}You've got **${count}** ${plural} in ${location}.`;

    suggestions.push(
      entity === 'student'
        ? { label: '📋 Show student list', action: 'view_class_roster' }
        : entity === 'teacher'
          ? { label: '👥 List teachers', action: 'view_school_teachers' }
          : { label: '📊 More stats', action: 'get_school_stats' },
    );

    return { text, suggestions };
  }

  // ─── Case 8: Timetable ──────────────────────────────────────────────
  if (TIMETABLE_RE.test(text)) {
    // Keep the timetable as-is (already nicely formatted), just add suggestions
    suggestions.push({ label: '📅 What\'s today?', action: 'view_today_schedule' });

    return { text, suggestions };
  }

  // ─── Case 9: No active sessions ─────────────────────────────────────
  if (SESSION_NO_ACTIVE_RE.test(text)) {
    text = text.replace(/No\s+active\s+sessions?\s+right\s*now\.?/i, 'No active sessions going on right now.');
    if (context?.role === 'TEACHER') {
      suggestions.push({ label: '▶️ Start a session', action: 'start_session' });
    }

    return { text, suggestions };
  }

  // ─── Case 10: Active sessions ───────────────────────────────────────
  const activeMatch = text.match(ACTIVE_SESSIONS_RE);
  if (activeMatch) {
    const count = parseInt(activeMatch[1], 10);
    const userName = context?.userName || '';
    const greeting = getGreeting(userName);
    text = `${greeting}${count} session${count === 1 ? ' is' : 's are'} live right now:\n\n${text.replace(/^\d+\s*active\s*session.*?:\s*/i, '')}`;

    return { text, suggestions };
  }

  // ─── Case 11: No data ───────────────────────────────────────────────
  if (NO_DATA_RE.test(text)) {
    text = text.replace(/No\s+(attendance records|students|classes|entries|sessions)\./gi, "I couldn't find any $1.");

    return { text, suggestions };
  }

  // ─── Case 12: Session started ───────────────────────────────────────
  if (SESSION_STARTED_RE.test(text)) {
    text = text.replace(/(?:started|created|launched)\s+session/i, 'started the session');
    text = `✅ Done. ${text}`;

    return { text, suggestions };
  }

  // ─── Case 13: Timetable generated ───────────────────────────────────
  if (GENERATED_TIMETABLE_RE.test(text)) {
    text = `✅ All set! ${text}`;

    return { text, suggestions };
  }

  // ─── Fallback: pass through with minor cleanups ─────────────────────
  // Add a conversational prefix when the text is data-like
  if (text.length > 10 && text.length < 200 && !text.startsWith('❌') && !text.startsWith('⚠️') && !text.startsWith('✅') && !text.startsWith('📊') && !text.startsWith('📅') && !text.startsWith('📝') && !text.startsWith('📋') && !text.startsWith('👤') && !text.startsWith('🏆') && !text.startsWith('🚨') && !text.startsWith('📩') && !text.startsWith('📈')) {
    // If it looks like a data dump, try to make it more human
    const userName = context?.userName || '';
    if (userName && !text.includes(userName)) {
      text = `${userName}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
  }

  return { text, suggestions };
}

/**
 * Make raw database output sound human in the simplest cases.
 * Used for quick inline fixes before the main formatter runs.
 */
export function humanize(raw: string, userName?: string): string {
  if (!raw) return raw;

  let result = raw
    // Fix "(s)" patterns
    .replace(/\(s\)/gi, 's')
    .replace(/\bstudent\(s\)\b/gi, 'students')
    .replace(/\bteacher\(s\)\b/gi, 'teachers')
    // Fix "X student(s) marked absent"
    .replace(
      /(\d+)\s*student(?:s)?\s*marked\s+absent/gi,
      (_, count) => `${count} student${parseInt(count, 10) === 1 ? '' : 's'} absent`,
    )
    // Fix "There are X student(s)"
    .replace(
      /There\s+(?:are|is)\s+(\d+)\s+student(?:s)?/gi,
      (_, count) => {
        const n = parseInt(count, 10);
        return n === 0 ? "There aren't any students" : n === 1 ? 'There is 1 student' : `There are ${n} students`;
      },
    )
    // Fix "The attendance rate is X%" → just "X%"
    .replace(/^The\s+attendance\s+rate\s+is\s+/i, '')
    // Remove trailing period from percentages
    .replace(/(\d{1,2}\.\d%)\.$/, '$1');

  return result;
}
