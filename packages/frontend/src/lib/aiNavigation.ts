export interface AiNavigationTarget {
  path: string;
  label: string;
}

const NAV_TARGETS: Array<AiNavigationTarget & { patterns: RegExp[] }> = [
  { path: '/dashboard', label: 'Dashboard', patterns: [/dash\s*board/i, /home/i] },
  { path: '/timetable', label: 'Timetable', patterns: [/time\s*table/i, /schedule/i] },
  { path: '/admin/timetable', label: 'Timetable Management', patterns: [/manage\s+time\s*table/i, /edit\s+time\s*table/i] },
  { path: '/sessions', label: 'Attendance Sessions', patterns: [/sessions?/i, /attendance\s+session/i] },
  { path: '/attendance', label: 'Manual Attendance', patterns: [/manual\s+attendance/i, /mark\s+attendance/i] },
  { path: '/biometric/attendance', label: 'Biometric Attendance', patterns: [/bio(?:metric)?\s+attendance/i] },
  { path: '/fingerprint/attendance', label: 'Fingerprint Attendance', patterns: [/finger\s*print/i] },
  { path: '/reports', label: 'Reports', patterns: [/reports?/i, /attendance\s+report/i] },
  { path: '/notifications', label: 'Notifications', patterns: [/notifications?/i, /messages?/i, /inbox/i, /alerts?/i] },
  { path: '/admin/links', label: 'Registration Links', patterns: [/registration\s+links?/i, /invite\s+links?/i, /enroll(?:ment)?\s+links?/i] },
  { path: '/admin/users', label: 'User Management', patterns: [/users?/i, /manage\s+users?/i, /student\s+list/i, /teacher\s+list/i] },
  { path: '/class/students', label: 'Student Workbench', patterns: [/student\s+workbench/i, /class\s+students?/i] },
  { path: '/class-roster', label: 'Class Representatives', patterns: [/class\s+reps?/i, /class\s+representatives?/i] },
  { path: '/risk-scores', label: 'Risk Scores', patterns: [/risk\s+scores?/i, /at\s+risk/i] },
  { path: '/admin/exams', label: 'Exams', patterns: [/exams?/i, /grades?/i, /marks?/i] },
  { path: '/admin/departments', label: 'Departments', patterns: [/departments?/i] },
  { path: '/admin/guardians', label: 'Guardians', patterns: [/guardians?/i, /parents?/i] },
  { path: '/admin/knowledge', label: 'Knowledge Management', patterns: [/knowledge/i, /ops\s+book/i, /documentation/i] },
  { path: '/hod/department', label: 'Department Management', patterns: [/department\s+management/i, /my\s+department/i] },
  { path: '/profile', label: 'Profile', patterns: [/profile/i, /dp/i, /avatar/i] },
  { path: '/settings', label: 'Settings', patterns: [/settings?/i] },
  { path: '/ai', label: 'AI Assistant', patterns: [/ai\s+assistant/i, /^ai$/i] },
  { path: '/parent', label: 'Parent Portal', patterns: [/parent/i, /guardian\s+portal/i] },
];

// Matches: "open timetable", "show me attendance", "go to dashboard",
// "can you open", "I want to see my", "take me to", "navigate to",
// "show reports", "open my sessions"
const NAV_COMMAND_RE = /\b(?:take|go|open|show|move|navigate|send)\s+(?:me\s+)?(?:to\s+)?(.+)|i\s+(?:want\s+to\s+)?(?:see|view|check)\s+(?:my\s+)?(.+)|can\s+you\s+(?:open|show|take)\s+(?:me\s+)?(?:to\s+)?(.+)/i;

export function detectAiNavigationRequest(message: string): AiNavigationTarget | null {
  const match = message.trim().match(NAV_COMMAND_RE);
  if (!match) return null;

  // Pick the first non-empty capture group (3 alternatives in the regex)
  const rawTarget = match[1] || match[2] || match[3] || '';
  if (!rawTarget?.trim()) return null;

  // Strip articles (the, a, an, my) so voice transcription like "go to my timetable" → "timetable"
  const targetText = rawTarget.trim().replace(/^(?:my|the|a|an)\s+/i, '');
  if (!targetText) return null;

  return NAV_TARGETS.find((target) => target.patterns.some((pattern) => pattern.test(targetText))) ?? null;
}
