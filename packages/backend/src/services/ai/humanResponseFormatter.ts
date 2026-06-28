/**
 * HumanResponseFormatter
 *
 * Transforms raw database answers into natural, human-sounding responses.
 * No LLM needed — just pattern-matching and templates.
 *
 * Instead of: "The attendance rate is 87.5% (42 present/late out of 48 total records)"
 * Now: "John's doing well — 87.5% attendance (42 of 48 sessions)."
 *
 * Instead of: "3 student(s) marked absent today: Alice, Bob, Charlie"
 * Now: "3 students are out today: Alice, Bob, Charlie. Want me to notify their guardians?"
 */

// ─── Patterns ────────────────────────────────────────────────────────────

const PERCENTAGE_RE = /(\d+\.?\d*)%\s*\((\d+).+?(\d+)\s*total/i;
const ABSENT_COUNT_RE = /(\d+)\s*student\(?s?\)?\s*marked\s*absent\s*today:\s*(.+)/i;
const ABSENT_COUNT_SHORT_RE = /^(\d+)\s*student\(?s?\)?\s*marked\s*absent/i;
const TOP_STUDENTS_RE = /Top\s+students?\s+by\s+attendance:\s*([\s\S]+)/i;
const RISK_SCORE_RE = /(\d+)\s*student\(?s?\)?\s*at\s+(?:high\/critical\s+)?risk/i;
const CLASS_COMPARISON_RE = /Class\s+attendance\s+comparison:\s*([\s\S]+)/i;
const TIMETABLE_RE = /📅\s*(?:Timetable|Your\s*Timetable|Today)/i;
const NO_DATA_RE = /(?:No|no)\s+(attendance|records|students|entries|sessions?)/i;
const STATS_COUNT_RE = /(?:There\s+are|Total:?)?\s*(\d+)\s*(student|teacher|user|school|class)/i;

// ─── Quality indicators ──────────────────────────────────────────────────

function qualityLabel(pct: number): string {
  if (pct >= 95) return 'excellent — near perfect';
  if (pct >= 85) return 'doing great';
  if (pct >= 75) return 'okay — room to improve';
  if (pct >= 60) return 'concerning — needs attention';
  return 'critical — urgent intervention needed';
}

function qualityEmoji(pct: number): string {
  if (pct >= 95) return '⭐';
  if (pct >= 85) return '✅';
  if (pct >= 75) return '👌';
  if (pct >= 60) return '⚠️';
  return '🚨';
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

export function formatHumanResponse(
  raw: string,
  context?: { role?: string; className?: string; hasActiveSession?: boolean },
): HumanResponse {
  const suggestions: FormattedSuggestion[] = [];

  // 1. Attendance percentage
  const pctMatch = raw.match(PERCENTAGE_RE);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    const present = parseInt(pctMatch[2], 10);
    const total = parseInt(pctMatch[3], 10);
    const label = qualityLabel(pct);
    const emoji = qualityEmoji(pct);
    const studentName = context?.role === 'STUDENT' ? 'You have' : 'The rate is';

    let text = `${emoji} ${studentName} **${pct}%** attendance — ${label} (${present} of ${total} sessions).`;

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
          action: 'absent_students',
        });
      }
    }

    return { text, suggestions };
  }

  // 2. Absent students (with names)
  const absentMatch = raw.match(ABSENT_COUNT_RE);
  if (absentMatch) {
    const count = parseInt(absentMatch[1], 10);
    const names = absentMatch[2];
    let text = `${count} student${count === 1 ? ' is' : 's are'} out today: **${names}**.`;
    if (count === 0) text = 'No absent students today. 👍';

    suggestions.push({
      label: count === 1 ? '👤 Mark them present?' : '📝 Mark all present?',
      action: 'mark_attendance',
    });

    return { text, suggestions };
  }

  // 3. Absent count only (no names)
  const absentShortMatch = raw.match(ABSENT_COUNT_SHORT_RE);
  if (absentShortMatch) {
    const count = parseInt(absentShortMatch[1], 10);
    return {
      text: `${count} student${count === 1 ? '' : 's'} absent today.`,
      suggestions: [
        { label: '👤 Show names', action: 'absent_students' },
        { label: '📩 Notify parents', action: 'send_class_notification', params: { message: 'Your child was absent today.' } },
      ],
    };
  }

  // 4. Top students
  const topMatch = raw.match(TOP_STUDENTS_RE);
  if (topMatch) {
    const list = topMatch[1].trim();
    return {
      text: `🏆 **Top performers:**\n${list}`,
      suggestions: [
        { label: '📊 See bottom performers', action: 'risk_scores' },
        { label: '📋 Full class comparison', action: 'class_comparison' },
      ],
    };
  }

  // 5. Risk scores
  const riskMatch = raw.match(RISK_SCORE_RE);
  if (riskMatch) {
    const count = parseInt(riskMatch[1], 10);
    return {
      text: count > 0
        ? `🚨 **${count} student${count === 1 ? '' : 's'} at risk.** Here are the details:\n\n${raw.replace(/^\d+\s+student.*risk\.\s*/i, '')}`
        : 'No students at risk right now. ✅',
      suggestions: count > 0
        ? [{ label: '📩 Send intervention notice', action: 'send_class_notification', params: { message: 'Attendance intervention needed for at-risk students.' } }]
        : [],
    };
  }

  // 6. Class comparison
  const classMatch = raw.match(CLASS_COMPARISON_RE);
  if (classMatch) {
    return {
      text: `📊 ${classMatch[1].trim()}`,
      suggestions: [
        { label: '📈 Show risk scores', action: 'risk_scores' },
      ],
    };
  }

  // 7. Stats counts (how many students, teachers, etc.)
  const statsMatch = raw.match(STATS_COUNT_RE);
  if (statsMatch) {
    const count = parseInt(statsMatch[1], 10);
    const entity = statsMatch[2].toLowerCase();
    const plural = entity + (count !== 1 ? 's' : '');
    const verb = count === 1 ? 'is' : 'are';
    return {
      text: `**${count}** ${plural} ${verb} in your ${context?.role === 'SUPER_ADMIN' ? 'platform' : 'school'}.`,
      suggestions: entity === 'student'
        ? [{ label: '📋 Show class list', action: 'view_class_roster' }]
        : entity === 'teacher'
          ? [{ label: '👥 List teachers', action: 'view_school_teachers' }]
          : [],
    };
  }

  // 8. Timetable — keep as-is, just add suggestion
  if (TIMETABLE_RE.test(raw)) {
    return {
      text: raw,
      suggestions: [
        { label: '📅 What\'s today?', action: 'view_today_schedule' },
      ],
    };
  }

  // 9. Session status
  if (raw.includes('active session') && raw.includes('No')) {
    return {
      text: raw,
      suggestions: context?.role === 'TEACHER'
        ? [{ label: '▶️ Start a session', action: 'start_session' }]
        : [],
    };
  }

  // Fallback: keep original, suggest generic actions
  if (raw.length < 300 && !raw.startsWith('❌') && !raw.startsWith('⚠️')) {
    return {
      text: raw,
      suggestions: [],
    };
  }

  return { text: raw, suggestions: [] };
}

/**
 * Make a single string more human for simple cases.
 */
export function humanize(raw: string, userName?: string): string {
  if (!raw) return raw;

  // Replace "X student(s)" with natural phrasing
  let result = raw
    .replace(/\(?(\d+)\s*student\(s\)\)?/gi, (_, count) => {
      const n = parseInt(count, 10);
      return n === 1 ? '1 student' : `${n} students`;
    })
    .replace(/\bstudent\(s\)\b/gi, 'students')
    .replace(/\bteacher\(s\)\b/gi, 'teachers')
    .replace(/\(s\)\b/gi, 's');

  // Replace leading "The attendance rate is" with just the number
  result = result.replace(/^The attendance rate is\s+(\d+\.?\d*)%/i, (_, pct) => {
    const n = parseFloat(pct);
    const label = qualityLabel(n);
    const emoji = qualityEmoji(n);
    return `${emoji} ${pct}% — ${label}`;
  });

  return result;
}
