import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string | number;
  icon: string;
  accent?: 'orange' | 'indigo';
}

interface QuickAction {
  to: string;
  label: string;
  subtitle: string;
  icon: string;
  variant?: 'signin' | 'attendance' | 'alert' | 'default';
}

interface QuickActionGroup {
  title: string;
  actions: QuickAction[];
}

interface RoleWorkflow {
  step: string;
  title: string;
  detail: string;
  to: string;
  icon: string;
  accent?: 'orange' | 'indigo';
}

interface DashboardStats {
  stats: StatCard[];
  loading: boolean;
}

interface TimetableInsightEntry {
  id: string;
  subject: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  class?: { name: string };
}

interface ActiveSessionReminderSession {
  id: string;
  subject: string;
  className?: string | null;
  class?: { name?: string | null };
  startedAt?: string;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const ICONS = {
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  academic: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
  session: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  link: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  building: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  fire: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
  trending: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  qr: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
  ai: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRoleLabel(role?: UserRole): string {
  switch (role) {
    case UserRole.SCHOOL_ADMIN: return 'School Admin';
    case UserRole.HOD: return 'Head of Department';
    case UserRole.TEACHER: return 'Teacher';
    case UserRole.STUDENT: return 'Student';
    default: return 'User';
  }
}

function getRoleGreeting(role?: UserRole): string {
  switch (role) {
    case UserRole.SCHOOL_ADMIN: return 'Onboard students and staff with Registration Links — your main signup path.';
    case UserRole.HOD: return 'Your department is performing well. Monitor and manage from here.';
    case UserRole.TEACHER: return "Ready to inspire today? Here's your teaching overview.";
    case UserRole.STUDENT: return "Stay on track with your attendance and schedule.";
    case UserRole.GUARDIAN: return "Monitor your children's attendance and grades from the Parent Portal.";
    default: return 'Welcome to your personalized dashboard.';
  }
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVE_SESSION_REMINDER_MS = 15_000;

function parseTimeMinutes(time: string): number {
  const [h, m] = time.split(':').map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

function findNextTimetableEntry(entries: TimetableInsightEntry[]): TimetableInsightEntry | null {
  if (!entries.length) return null;
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sorted = [...entries].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return parseTimeMinutes(a.startTime) - parseTimeMinutes(b.startTime);
  });
  for (const entry of sorted) {
    const dayOffset = entry.dayOfWeek >= todayIndex ? entry.dayOfWeek - todayIndex : entry.dayOfWeek + 7 - todayIndex;
    const endMin = parseTimeMinutes(entry.endTime);
    if (dayOffset === 0 && endMin <= nowMin) continue;
    return entry;
  }
  return sorted[0] ?? null;
}

function describeNextClass(entry: TimetableInsightEntry | null): { title: string; detail: string } {
  if (!entry) return { title: 'No upcoming class', detail: 'Check your full timetable for the week.' };
  const todayIndex = (new Date().getDay() + 6) % 7;
  const dayLabel = entry.dayOfWeek === todayIndex ? 'Today' : DAY_SHORT[entry.dayOfWeek] ?? '';
  const classLabel = entry.class?.name ? ` · ${entry.class.name}` : '';
  return { title: entry.subject, detail: `${dayLabel} ${entry.startTime}–${entry.endTime}${classLabel}` };
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; icon: string }> = ({ title, icon }) => (
  <div className="mb-5">
    <div className="flex items-center gap-3 mb-2">
      <div className="dash-card-icon dash-card-icon-secondary">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
      </div>
      <h3 className="dash-section-title">{title}</h3>
    </div>
    <div className="h-px bg-line" />
  </div>
);

const SkeletonCard: React.FC = () => (
  <div className="animate-pulse dash-stat border-l-indigo-500/30">
    <div className="w-9 h-9 rounded-lg bg-surface-elevated shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 w-24 bg-surface-elevated rounded" />
      <div className="h-7 w-14 bg-surface-elevated rounded" />
    </div>
  </div>
);

const AnimatedStatCard: React.FC<{ stat: StatCard; index: number }> = ({ stat, index }) => {
  const isOrange = stat.accent === 'orange';
  return (
    <div
      className={`dash-stat ${isOrange ? 'dash-stat-accent-orange' : 'dash-stat-accent-indigo'}`}
      style={{ animationDelay: `${index * 80}ms`, animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
    >
      <div className={`dash-card-icon ${isOrange ? 'dash-card-icon-primary' : 'dash-card-icon-secondary'}`}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={stat.icon} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="dash-stat-label">{stat.label}</p>
        <p className={`dash-stat-value mt-1 ${isOrange ? 'text-accent-orange' : 'text-ink'}`}>{stat.value}</p>
      </div>
    </div>
  );
};

const QuickActionButton: React.FC<{ action: QuickAction; index: number }> = ({ action, index }) => {
  const useIndigo = action.variant !== 'attendance';
  const cardClass = useIndigo ? 'quick-action-card--secondary' : 'quick-action-card--primary';
  const iconClass = useIndigo ? 'dash-card-icon-secondary' : 'dash-card-icon-primary';
  return (
    <Link
      to={action.to}
      className={`group quick-action-card ${cardClass}`}
      style={{ animationDelay: `${(index + 4) * 80}ms`, animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
    >
      <div className="flex items-start gap-3">
        <div className={`dash-card-icon ${iconClass}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={action.icon} />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-semibold text-ink ${useIndigo ? 'group-hover:text-indigo-300' : 'group-hover:text-accent-orange'} transition-colors`}>
            {action.label}
          </h3>
          <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{action.subtitle}</p>
        </div>
        <svg className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
};

const CommandActionCard: React.FC<{ action: QuickAction; index: number }> = ({ action, index }) => {
  const isAttendance = action.variant === 'attendance';
  return (
    <Link
      to={action.to}
      className={`group dashboard-command-card ${isAttendance ? 'dashboard-command-card--attendance' : ''}`}
      style={{ animationDelay: `${(index + 1) * 70}ms`, animation: 'fadeInUp 0.45s ease-out forwards', opacity: 0 }}
    >
      <span className={`dash-card-icon ${isAttendance ? 'dash-card-icon-primary' : 'dash-card-icon-secondary'}`}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={action.icon} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink truncate">{action.label}</span>
        <span className="block text-xs text-ink-muted truncate">{action.subtitle}</span>
      </span>
      <svg className="w-4 h-4 text-ink-subtle opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
};

const RoleWorkflowCard: React.FC<{ item: RoleWorkflow; index: number }> = ({ item, index }) => {
  const isOrange = item.accent === 'orange';
  return (
    <Link
      to={item.to}
      className={`group dashboard-workflow-card ${isOrange ? 'dashboard-workflow-card--orange' : 'dashboard-workflow-card--indigo'}`}
      style={{ animationDelay: `${(index + 1) * 70}ms`, animation: 'fadeInUp 0.45s ease-out forwards', opacity: 0 }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`dashboard-workflow-step ${isOrange ? 'dashboard-workflow-step--orange' : 'dashboard-workflow-step--indigo'}`}>
          {item.step}
        </span>
        <span className={`dash-card-icon ${isOrange ? 'dash-card-icon-primary' : 'dash-card-icon-secondary'}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={item.icon} />
          </svg>
        </span>
      </div>
      <div className="mt-4 min-w-0">
        <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
        <p className="mt-1 text-xs leading-5 text-ink-muted">{item.detail}</p>
      </div>
    </Link>
  );
};

const RoleWorkflowBoard: React.FC<{ role?: UserRole }> = ({ role }) => {
  const items = getRoleWorkflows(role);
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeader title="Workflow" icon={ICONS.clipboard} />
      <div className="dashboard-workflow-grid">
        {items.map((item, index) => (
          <RoleWorkflowCard key={`${item.step}-${item.to}`} item={item} index={index} />
        ))}
      </div>
    </section>
  );
};

// ─── Session & Attendance panels ──────────────────────────────────────────────

const AttendanceWorkflowPanel: React.FC<{ role?: UserRole }> = ({ role }) => {
  if (role !== UserRole.TEACHER && role !== UserRole.HOD) return null;
  const steps = [
    { to: '/timetable', label: 'Timetable', detail: 'Current slot', icon: ICONS.calendar },
    { to: '/sessions', label: 'Start Session', detail: 'QR and link', icon: ICONS.qr },
    { to: '/attendance', label: 'Manual', detail: 'Roll call', icon: ICONS.clipboard },
    { to: '/fingerprint/attendance', label: 'Fingerprint', detail: 'External reader', icon: ICONS.check },
    { to: '/biometric/attendance', label: 'Face Attendance', detail: 'Camera match', icon: ICONS.check },
    { to: '/reports', label: 'Reports', detail: 'After class', icon: ICONS.chart },
  ];
  return (
    <section className="mb-8 surface-panel rounded-2xl p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Attendance workflow</h3>
          <p className="text-xs text-ink-muted">Timetable-locked sessions with QR, link, manual, fingerprint, and face attendance paths.</p>
        </div>
        <Link to="/sessions" className="btn-primary px-4 py-2 text-sm w-full sm:w-auto text-center">Open Sessions</Link>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map((step, i) => (
          <Link key={step.to} to={step.to}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-3 hover:border-blue-500/50 hover:bg-surface-elevated transition-colors">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-blue-200">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={step.icon} />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-ink">{i + 1}. {step.label}</span>
              <span className="block truncate text-[11px] text-ink-subtle">{step.detail}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
};

const ActiveSessionReminder: React.FC<{ role?: UserRole; userId?: string }> = ({ role, userId }) => {
  const [sessions, setSessions] = useState<ActiveSessionReminderSession[]>([]);
  useEffect(() => {
    if (!userId || (role !== UserRole.TEACHER && role !== UserRole.HOD)) { setSessions([]); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await apiClient.get('/sessions', { params: { isActive: true, teacherId: userId } });
        if (!cancelled) setSessions(Array.isArray(data) ? data.filter((s: any) => s.isActive !== false) : []);
      } catch { if (!cancelled) setSessions([]); }
    };
    void load();
    const timer = window.setInterval(load, ACTIVE_SESSION_REMINDER_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [role, userId]);

  if (sessions.length === 0) return null;
  const first = sessions[0];
  const cName = first.className ?? first.class?.name ?? 'Class';
  const extra = sessions.length > 1 ? ` +${sessions.length - 1} more` : '';
  return (
    <section className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/12 p-4 shadow-card-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-red-400/45 bg-red-500/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-red-100">
              <span className="h-2 w-2 rounded-full bg-red-300 animate-pulse" />Live attendance session
            </span>
            <span className="text-xs text-red-100/75">Keep it open until the lesson ends, or end it from Sessions.</span>
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-ink">{first.subject} - {cName}{extra}</p>
        </div>
        <Link to="/sessions" className="btn-attendance px-4 py-2 text-sm text-center">Open / End Session</Link>
      </div>
    </section>
  );
};

const InsightRow: React.FC<{ label: string; value: React.ReactNode; valueClass?: string; hint?: string }> = ({ label, value, valueClass = 'text-ink font-semibold', hint }) => (
  <div className="surface-muted-row">
    <div className="min-w-0">
      <span className="text-sm text-ink-muted">{label}</span>
      {hint && <p className="text-xs text-ink-subtle mt-0.5 truncate">{hint}</p>}
    </div>
    <span className={`text-sm shrink-0 ml-3 ${valueClass}`}>{value}</span>
  </div>
);

const InsightsPanelShell: React.FC<{ title: string; icon: string; animStyle?: React.CSSProperties; children: React.ReactNode }> = ({ title, icon, animStyle = { animation: 'fadeInUp 0.5s ease-out 0.6s forwards', opacity: 0 }, children }) => (
  <div className="dashboard-insights-panel" style={animStyle}>
    <div className="flex items-center gap-3 mb-4">
      <div className="dash-card-icon dash-card-icon-secondary">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
      </div>
      <h3 className="dash-section-title">{title}</h3>
    </div>
    {children}
  </div>
);

const AtAGlancePanel: React.FC<{ role?: UserRole; userId?: string; departmentId?: string; classId?: string }> = ({ role, userId, departmentId, classId }) => {
  const [loading, setLoading] = useState(true);
  const [nextClass, setNextClass] = useState<{ title: string; detail: string } | null>(null);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [attendanceLabel, setAttendanceLabel] = useState('—');
  const [pendingCount, setPendingCount] = useState(0);
  const [studentStatus, setStudentStatus] = useState('—');
  const [schoolSessions, setSchoolSessions] = useState<number | string>('—');
  const [schoolAbsent, setSchoolAbsent] = useState<number | string>('—');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const timetableReq = apiClient.get('/timetable');
        const unreadReq = apiClient.get('/notifications/unread-count');
        if (role === UserRole.STUDENT) {
          const [timetableRes, attendanceRes] = await Promise.allSettled([timetableReq, apiClient.get('/attendance')]);
          if (!cancelled && timetableRes.status === 'fulfilled') {
            setNextClass(describeNextClass(findNextTimetableEntry(Array.isArray(timetableRes.value.data) ? timetableRes.value.data : [])));
          }
          if (!cancelled && attendanceRes.status === 'fulfilled') {
            const todayRecords = (Array.isArray(attendanceRes.value.data) ? attendanceRes.value.data : []).filter((r: any) => isToday(r.createdAt));
            const p = todayRecords.filter((r: any) => r.status === 'PRESENT' || r.status === 'LATE').length;
            const a = todayRecords.filter((r: any) => r.status === 'ABSENT').length;
            setStudentStatus(p > 0 ? `${p} present` : a > 0 ? `${a} absent` : 'Not marked yet');
          }
        } else if (role === UserRole.TEACHER && userId) {
          const [timetableRes, sessionsRes, reportsRes] = await Promise.allSettled([
            timetableReq, apiClient.get('/sessions', { params: { teacherId: userId, isActive: true } }),
            classId ? apiClient.get(`/reports/class/${classId}`) : Promise.reject(new Error('no class')),
          ]);
          if (!cancelled && timetableRes.status === 'fulfilled') setNextClass(describeNextClass(findNextTimetableEntry(Array.isArray(timetableRes.value.data) ? timetableRes.value.data : [])));
          if (!cancelled && sessionsRes.status === 'fulfilled') setActiveSessionCount(Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data.length : 0);
          if (!cancelled && reportsRes.status === 'fulfilled') setAttendanceLabel(`${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`);
          if (!cancelled) setPendingCount((await unreadReq).data.count ?? 0);
        } else if (role === UserRole.HOD) {
          const [timetableRes, sessionsRes, reportsRes, riskRes] = await Promise.allSettled([
            timetableReq, apiClient.get('/sessions', { params: { isActive: true } }),
            departmentId ? apiClient.get(`/reports/department/${departmentId}`) : Promise.reject(new Error('no dept')),
            apiClient.get('/risk-scores'),
          ]);
          if (!cancelled && timetableRes.status === 'fulfilled') setNextClass(describeNextClass(findNextTimetableEntry(Array.isArray(timetableRes.value.data) ? timetableRes.value.data : [])));
          if (!cancelled && sessionsRes.status === 'fulfilled') setActiveSessionCount(Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data.length : 0);
          if (!cancelled && reportsRes.status === 'fulfilled') setAttendanceLabel(`${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`);
          const unread = (await unreadReq).data.count ?? 0;
          const atRisk = riskRes.status === 'fulfilled' && Array.isArray(riskRes.value.data) ? riskRes.value.data.filter((s: any) => s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL').length : 0;
          if (!cancelled) setPendingCount(unread + atRisk);
        } else if (role === UserRole.SCHOOL_ADMIN) {
          const [sessionsRes, attendanceRes, reportsRes] = await Promise.allSettled([
            apiClient.get('/sessions'), apiClient.get('/attendance', { params: { status: 'ABSENT' } }),
            apiClient.get('/reports/school'),
          ]);
          if (!cancelled && sessionsRes.status === 'fulfilled') {
            const sessions = Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data : [];
            setSchoolSessions(sessions.filter((s: any) => isToday(s.startedAt)).length);
            setActiveSessionCount(sessions.filter((s: any) => s.isActive).length);
          }
          if (!cancelled && attendanceRes.status === 'fulfilled') setSchoolAbsent((Array.isArray(attendanceRes.value.data) ? attendanceRes.value.data : []).filter((r: any) => isToday(r.createdAt)).length);
          if (!cancelled && reportsRes.status === 'fulfilled') setAttendanceLabel(`${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`);
          if (!cancelled) setPendingCount((await unreadReq).data.count ?? 0);
        }
      } catch { /* non-critical */ }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [role, userId, departmentId, classId]);

  const title = role === UserRole.STUDENT ? 'My day' : role === UserRole.TEACHER ? 'Teaching today' : role === UserRole.HOD ? 'Department today' : role === UserRole.SCHOOL_ADMIN ? 'School today' : 'At a glance';

  return (
    <InsightsPanelShell title={title} icon={ICONS.calendar}>
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="animate-pulse h-11 rounded-xl bg-surface-elevated" />)}</div>
      ) : (
        <div className="space-y-2">
          {role === UserRole.STUDENT ? (
            <>
              <InsightRow label="Next class" value={nextClass?.title ?? '—'} hint={nextClass?.detail} valueClass="text-ink font-medium text-right max-w-[55%] truncate" />
              <InsightRow label="Today's attendance" value={studentStatus} valueClass="text-accent-orange font-semibold" />
              <Link to="/timetable" className="block text-center text-sm text-brand hover:text-brand-hover pt-2">Full timetable →</Link>
            </>
          ) : role === UserRole.TEACHER ? (
            <>
              <InsightRow label="Next class" value={nextClass?.title ?? '—'} hint={nextClass?.detail} valueClass="text-ink font-medium text-right max-w-[55%] truncate" />
              <InsightRow label="Active sessions" value={activeSessionCount} valueClass={activeSessionCount > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'} />
              <InsightRow label="Class attendance" value={attendanceLabel} valueClass="text-accent-orange font-semibold" />
              <InsightRow label="Pending actions" value={pendingCount} valueClass="text-brand font-semibold" />
              <Link to="/sessions" className="block text-center text-sm text-brand hover:text-brand-hover pt-2">Open sessions & QR →</Link>
            </>
          ) : role === UserRole.HOD ? (
            <>
              <InsightRow label="Next class" value={nextClass?.title ?? '—'} hint={nextClass?.detail} valueClass="text-ink font-medium text-right max-w-[55%] truncate" />
              <InsightRow label="Live sessions" value={activeSessionCount} valueClass={activeSessionCount > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'} />
              <InsightRow label="Dept. attendance" value={attendanceLabel} valueClass="text-accent-orange font-semibold" />
              <InsightRow label="Pending" value={pendingCount} valueClass="text-brand font-semibold" />
            </>
          ) : (
            <>
              <InsightRow label="Sessions today" value={schoolSessions} />
              <InsightRow label="Absent today" value={schoolAbsent} valueClass="text-accent-orange font-semibold" />
              <InsightRow label="School attendance" value={attendanceLabel} valueClass="text-accent-orange font-semibold" />
              <InsightRow label="Active sessions" value={activeSessionCount} valueClass={activeSessionCount > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'} />
              <InsightRow label="Unread messages" value={pendingCount} valueClass="text-brand font-semibold" />
            </>
          )}
        </div>
      )}
    </InsightsPanelShell>
  );
};

const SchoolAdminInsightsPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [activeSessions, setActiveSessions] = useState(0);
  const [sessionsToday, setSessionsToday] = useState(0);
  const [absentToday, setAbsentToday] = useState(0);
  const [attendanceRate, setAttendanceRate] = useState('—');
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([apiClient.get('/sessions', { params: { isActive: true } }), apiClient.get('/sessions'), apiClient.get('/attendance', { params: { status: 'ABSENT' } }), apiClient.get('/reports/school')])
      .then(([aR, sR, abR, rR]) => {
        if (cancelled) return;
        if (aR.status === 'fulfilled') setActiveSessions(Array.isArray(aR.value.data) ? aR.value.data.length : 0);
        if (sR.status === 'fulfilled') setSessionsToday((Array.isArray(sR.value.data) ? sR.value.data : []).filter((s: any) => isToday(s.startedAt)).length);
        if (abR.status === 'fulfilled') setAbsentToday((Array.isArray(abR.value.data) ? abR.value.data : []).filter((r: any) => isToday(r.createdAt)).length);
        if (rR.status === 'fulfilled') setAttendanceRate(`${Math.round(rR.value.data.averageAttendancePercentage ?? 0)}%`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return (
    <InsightsPanelShell title="Quick stats" icon={ICONS.chart} animStyle={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="animate-pulse h-11 rounded-xl bg-surface-elevated" />)}</div>
      ) : (
        <div className="space-y-2">
          <InsightRow label="Active sessions" value={activeSessions} valueClass={activeSessions > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'} />
          <InsightRow label="Sessions today" value={sessionsToday} />
          <InsightRow label="Absent today" value={absentToday} valueClass="text-accent-orange font-semibold" />
          <InsightRow label="Overall attendance" value={attendanceRate} valueClass="text-accent-orange font-semibold" />
          <Link to="/reports" className="block text-center text-sm text-brand hover:text-brand-hover pt-2">School reports →</Link>
        </div>
      )}
    </InsightsPanelShell>
  );
};

// ─── Quick Action Config ──────────────────────────────────────────────────────

function getQuickActionGroups(role?: UserRole): QuickActionGroup[] {
  if (role === UserRole.SCHOOL_ADMIN) return [
    { title: 'School Management', actions: [
      { to: '/admin/links', label: 'Registration Links', subtitle: 'Main signup path', icon: ICONS.link, variant: 'signin' },
      { to: '/admin/users', label: 'User Management', subtitle: 'Manual add', icon: ICONS.users },
      { to: '/admin/guardians', label: 'Guardian Management', subtitle: 'Link parents to students', icon: ICONS.users },
      { to: '/class/students', label: 'Student Workbench', subtitle: 'Classes & gaps', icon: ICONS.users },
      { to: '/admin/departments', label: 'Departments', subtitle: 'Organize faculties', icon: ICONS.building },
    ]},
    { title: 'Reports & Schedule', actions: [
      { to: '/reports', label: 'View Reports', subtitle: 'School-wide attendance', icon: ICONS.chart },
      { to: '/risk-scores', label: 'Risk Scores', subtitle: 'At-risk students', icon: ICONS.warning },
      { to: '/timetable', label: 'View Timetable', subtitle: 'Master schedule', icon: ICONS.calendar },
      { to: '/admin/exams', label: 'Exam & Grade Mgmt', subtitle: 'CATs, end-term', icon: ICONS.book },
    ]},
    { title: 'Communication', actions: [
      { to: '/notifications', label: 'Notifications', subtitle: 'Alerts & broadcasts', icon: ICONS.bell },
      { to: '/ai', label: 'AI Assistant', subtitle: 'Ask SAMS anything', icon: ICONS.ai },
    ]},
  ];
  if (role === UserRole.TEACHER) return [
    { title: 'Class & Onboarding', actions: [
      { to: '/admin/links', label: 'Registration Links', subtitle: 'Share signup links', icon: ICONS.link, variant: 'signin' },
      { to: '/class/students', label: 'My Students', subtitle: 'Class roster', icon: ICONS.users },
    ]},
    { title: 'Attendance', actions: [
      { to: '/sessions', label: 'QR / Link Session', subtitle: 'Start session', icon: ICONS.qr, variant: 'signin' },
      { to: '/attendance', label: 'Manual Attendance', subtitle: 'Roll call', icon: ICONS.clipboard, variant: 'attendance' },
      { to: '/fingerprint/attendance', label: 'Fingerprint', subtitle: 'External reader', icon: ICONS.check, variant: 'attendance' },
      { to: '/biometric/attendance', label: 'Face Attendance', subtitle: 'Camera match', icon: ICONS.check, variant: 'attendance' },
    ]},
    { title: 'Schedule & Reports', actions: [
      { to: '/timetable', label: 'My Timetable', subtitle: 'Weekly schedule', icon: ICONS.calendar },
      { to: '/reports', label: 'View Reports', subtitle: 'Class stats', icon: ICONS.chart },
      { to: '/risk-scores', label: 'Risk Scores', subtitle: 'Follow-up needed', icon: ICONS.warning },
      { to: '/admin/exams', label: 'Enter Marks', subtitle: 'CAT & end-term', icon: ICONS.clipboard },
    ]},
    { title: 'Communication', actions: [
      { to: '/notifications', label: 'Notifications', subtitle: 'School messages', icon: ICONS.bell },
      { to: '/ai', label: 'AI Assistant', subtitle: 'SAMS help', icon: ICONS.ai },
    ]},
  ];
  if (role === UserRole.STUDENT) return [
    { title: 'Today', actions: [
      { to: '/sessions/scan', label: 'Scan QR', subtitle: 'Check in to class', icon: ICONS.qr, variant: 'attendance' },
      { to: '/timetable', label: 'View Timetable', subtitle: 'Classes & rooms', icon: ICONS.calendar },
    ]},
    { title: 'Stay Informed', actions: [
      { to: '/notifications', label: 'Messages', subtitle: 'School announcements', icon: ICONS.bell },
      { to: '/reports', label: 'My Reports', subtitle: 'Attendance history', icon: ICONS.chart },
      { to: '/ai', label: 'AI Assistant', subtitle: 'Help with SAMS', icon: ICONS.ai },
    ]},
    { title: 'Account', actions: [
      { to: '/profile', label: 'Profile', subtitle: 'Photo & account info', icon: ICONS.profile },
    ]},
  ];
  if (role === UserRole.HOD) return [
    { title: 'Department', actions: [
      { to: '/hod/department', label: 'Department Mgmt', subtitle: 'Staff & structure', icon: ICONS.building },
      { to: '/admin/links', label: 'Registration Links', subtitle: 'Share signup links', icon: ICONS.link, variant: 'signin' },
      { to: '/admin/users', label: 'Manage Users', subtitle: 'Dept. accounts', icon: ICONS.users },
      { to: '/class/students', label: 'Dept Students', subtitle: 'Class lists', icon: ICONS.users },
    ]},
    { title: 'Attendance', actions: [
      { to: '/sessions', label: 'Sign In Students', subtitle: 'QR, link, manual', icon: ICONS.qr, variant: 'signin' },
      { to: '/attendance', label: 'Mark Attendance', subtitle: 'Override', icon: ICONS.clipboard, variant: 'attendance' },
    ]},
    { title: 'Schedule & Insights', actions: [
      { to: '/timetable', label: 'View Timetable', subtitle: 'Dept. schedule', icon: ICONS.calendar },
      { to: '/reports', label: 'View Reports', subtitle: 'Dept. analytics', icon: ICONS.chart },
      { to: '/risk-scores', label: 'Risk Scores', subtitle: 'At-risk students', icon: ICONS.warning },
      { to: '/admin/exams', label: 'Exam & Grade Mgmt', subtitle: 'CATs, end-term', icon: ICONS.book },
    ]},
    { title: 'Communication', actions: [
      { to: '/notifications', label: 'Notifications', subtitle: 'Dept. alerts', icon: ICONS.bell },
      { to: '/ai', label: 'AI Assistant', subtitle: 'SAMS help', icon: ICONS.ai },
    ]},
  ];
  return [];
}

function getRoleWorkflows(role?: UserRole): RoleWorkflow[] {
  if (role === UserRole.SCHOOL_ADMIN) return [
    { step: '01', title: 'Set up the school', detail: 'Departments, HODs, registration links, users, and guardian links stay together.', to: '/admin/departments', icon: ICONS.building },
    { step: '02', title: 'Run today', detail: 'Watch timetable activity, active sessions, and attendance movement during the day.', to: '/sessions', icon: ICONS.session, accent: 'orange' },
    { step: '03', title: 'Check evidence', detail: 'Use reports and risk scores for names, counts, absences, and follow-up.', to: '/reports', icon: ICONS.chart },
    { step: '04', title: 'Communicate', detail: 'Send in-app notices and keep school messages separate from attendance work.', to: '/notifications', icon: ICONS.bell },
  ];
  if (role === UserRole.HOD) return [
    { step: '01', title: 'Plan department', detail: 'Manage department classes, teachers, class reps, timetable, and exam plans.', to: '/hod/department', icon: ICONS.building },
    { step: '02', title: 'Open sessions', detail: 'Start only the active timetable lesson, then use QR, link, manual, face, or fingerprint.', to: '/sessions', icon: ICONS.qr, accent: 'orange' },
    { step: '03', title: 'Track learners', detail: 'Review department students by class, attendance gaps, risk scores, and reports.', to: '/class/students', icon: ICONS.users },
    { step: '04', title: 'Manage exams', detail: 'Create CAT, Practical, and End Term plans, then follow marks and report cards.', to: '/admin/exams', icon: ICONS.book },
  ];
  if (role === UserRole.TEACHER) return [
    { step: '01', title: 'See today', detail: 'Start with your timetable and assigned classes before opening attendance.', to: '/timetable', icon: ICONS.calendar },
    { step: '02', title: 'Start attendance', detail: 'Open the live lesson session and choose QR, link, manual, face, or fingerprint.', to: '/sessions', icon: ICONS.qr, accent: 'orange' },
    { step: '03', title: 'Follow students', detail: 'Use the student workbench and reports to see present, late, absent, and excused learners.', to: '/class/students', icon: ICONS.users },
    { step: '04', title: 'Enter marks', detail: 'Record CATs, optional practicals, and end-term marks for classes you teach.', to: '/admin/exams', icon: ICONS.clipboard },
  ];
  if (role === UserRole.STUDENT) return [
    { step: '01', title: 'Attend class', detail: 'Scan the QR or open the attendance link when the class session is active.', to: '/sessions/scan', icon: ICONS.qr, accent: 'orange' },
    { step: '02', title: 'Know your day', detail: 'Use the timetable to see now, later, and past classes clearly.', to: '/timetable', icon: ICONS.calendar },
    { step: '03', title: 'Check records', detail: 'Review attendance history and any gaps before they become a problem.', to: '/reports', icon: ICONS.chart },
    { step: '04', title: 'Stay updated', detail: 'Read school notices, class messages, and alerts in one place.', to: '/notifications', icon: ICONS.bell },
  ];
  return [];
}

function getPrimaryActions(role?: UserRole): QuickAction[] {
  if (role === UserRole.SCHOOL_ADMIN) return [
    { to: '/admin/links', label: 'Registration Links', subtitle: 'Students, staff, parents', icon: ICONS.link, variant: 'signin' },
    { to: '/class/students', label: 'Student Workbench', subtitle: 'Class lists and gaps', icon: ICONS.users },
    { to: '/reports', label: 'Attendance Reports', subtitle: 'School evidence', icon: ICONS.chart },
    { to: '/admin/departments', label: 'Departments', subtitle: 'Structure and HODs', icon: ICONS.building },
  ];
  if (role === UserRole.TEACHER) return [
    { to: '/admin/links', label: 'Registration Links', subtitle: 'Class signup links', icon: ICONS.link, variant: 'signin' },
    { to: '/sessions', label: 'Open Session', subtitle: 'QR, link, manual, face', icon: ICONS.qr, variant: 'signin' },
    { to: '/class/students', label: 'My Students', subtitle: 'Class workbench', icon: ICONS.users },
    { to: '/admin/exams', label: 'Enter Marks', subtitle: 'CATs and practicals', icon: ICONS.clipboard },
    { to: '/reports', label: 'Class Reports', subtitle: 'After lesson follow-up', icon: ICONS.chart },
  ];
  if (role === UserRole.HOD) return [
    { to: '/admin/links', label: 'Registration Links', subtitle: 'Dept signup links', icon: ICONS.link, variant: 'signin' },
    { to: '/hod/department', label: 'Department', subtitle: 'Classes and teachers', icon: ICONS.building },
    { to: '/sessions', label: 'Open Session', subtitle: 'Attendance tools', icon: ICONS.qr, variant: 'signin' },
    { to: '/admin/exams', label: 'Exam Plans', subtitle: 'CATs, practicals, end-term', icon: ICONS.book },
    { to: '/reports', label: 'Dept Reports', subtitle: 'Attendance evidence', icon: ICONS.chart },
  ];
  if (role === UserRole.STUDENT) return [
    { to: '/sessions/scan', label: 'Scan QR', subtitle: 'Mark attendance', icon: ICONS.qr, variant: 'attendance' },
    { to: '/timetable', label: 'Timetable', subtitle: 'Now, later, past', icon: ICONS.calendar },
    { to: '/reports', label: 'My Reports', subtitle: 'Attendance history', icon: ICONS.chart },
    { to: '/notifications', label: 'Messages', subtitle: 'School updates', icon: ICONS.bell },
  ];
  return [];
}

function getDefaultStats(role?: UserRole): StatCard[] {
  switch (role) {
    case UserRole.SCHOOL_ADMIN: return [
      { label: 'Total Students', value: '—', icon: ICONS.users, accent: 'indigo' },
      { label: 'Total Teachers', value: '—', icon: ICONS.academic, accent: 'indigo' },
      { label: 'Active Sessions', value: '—', icon: ICONS.session, accent: 'indigo' },
      { label: 'Attendance Rate', value: '—', icon: ICONS.chart, accent: 'orange' },
    ];
    case UserRole.TEACHER: return [
      { label: 'My Students', value: '—', icon: ICONS.users, accent: 'indigo' },
      { label: "Today's Sessions", value: '—', icon: ICONS.session, accent: 'indigo' },
      { label: 'Attendance Rate', value: '—', icon: ICONS.chart, accent: 'orange' },
      { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, accent: 'indigo' },
    ];
    case UserRole.STUDENT: return [
      { label: 'My Attendance %', value: '—', icon: ICONS.check, accent: 'orange' },
      { label: 'Classes Today', value: '—', icon: ICONS.calendar, accent: 'indigo' },
      { label: 'Risk Score', value: '—', icon: ICONS.warning, accent: 'indigo' },
      { label: 'Days Present', value: '—', icon: ICONS.fire, accent: 'indigo' },
    ];
    case UserRole.HOD: return [
      { label: 'Dept. Students', value: '—', icon: ICONS.users, accent: 'indigo' },
      { label: 'Dept. Teachers', value: '—', icon: ICONS.academic, accent: 'indigo' },
      { label: 'Attendance Rate', value: '—', icon: ICONS.chart, accent: 'orange' },
      { label: 'At-Risk Students', value: '—', icon: ICONS.warning, accent: 'indigo' },
    ];
    default: return [];
  }
}

// ─── Data Fetching Hook ───────────────────────────────────────────────────────

function useDashboardStats(user?: { id: string; role?: UserRole; classId?: string; departmentId?: string }): DashboardStats {
  const role = user?.role;
  const [stats, setStats] = useState<StatCard[]>(getDefaultStats(role));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        if (role === UserRole.SCHOOL_ADMIN) {
          const [sR, tR, sesR, repR] = await Promise.allSettled([
            apiClient.get('/users', { params: { role: 'STUDENT' } }),
            apiClient.get('/users', { params: { role: 'TEACHER' } }),
            apiClient.get('/sessions', { params: { isActive: true } }),
            apiClient.get('/reports/school'),
          ]);
          if (!cancelled) setStats([
            { label: 'Total Students', value: sR.status === 'fulfilled' ? (Array.isArray(sR.value.data) ? sR.value.data.length : '—') : '—', icon: ICONS.users, accent: 'indigo' },
            { label: 'Total Teachers', value: tR.status === 'fulfilled' ? (Array.isArray(tR.value.data) ? tR.value.data.length : '—') : '—', icon: ICONS.academic, accent: 'indigo' },
            { label: 'Active Sessions', value: sesR.status === 'fulfilled' ? (Array.isArray(sesR.value.data) ? sesR.value.data.length : 0) : '—', icon: ICONS.session, accent: 'indigo' },
            { label: 'Attendance Rate', value: repR.status === 'fulfilled' ? `${Math.round(repR.value.data.averageAttendancePercentage ?? 0)}%` : '—', icon: ICONS.chart, accent: 'orange' },
          ]);
        } else if (role === UserRole.TEACHER) {
          const [studR, sesR] = await Promise.allSettled([
            apiClient.get('/users/class-roster'), apiClient.get('/sessions', { params: { teacherId: user?.id } }),
          ]);
          const classId = user?.classId;
          const repR = classId ? (await Promise.allSettled([apiClient.get(`/reports/class/${classId}`)]))[0] : { status: 'rejected' as const, reason: new Error('') };
          if (!cancelled) setStats([
            { label: 'My Students', value: studR.status === 'fulfilled' ? (Array.isArray(studR.value.data) ? studR.value.data.length : 0) : '—', icon: ICONS.users, accent: 'indigo' },
            { label: "Today's Sessions", value: sesR.status === 'fulfilled' ? (Array.isArray(sesR.value.data) ? sesR.value.data.length : 0) : '—', icon: ICONS.session, accent: 'indigo' },
            { label: 'Attendance Rate', value: repR.status === 'fulfilled' ? `${Math.round(repR.value.data.averageAttendancePercentage ?? 0)}%` : '—', icon: ICONS.chart, accent: 'orange' },
            { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, accent: 'indigo' },
          ]);
        } else if (role === UserRole.STUDENT) {
          const [repR, tR, riskR] = await Promise.allSettled([
            apiClient.get(`/reports/student/${user?.id}`), apiClient.get('/timetable'), apiClient.get('/risk-scores/me'),
          ]);
          if (!cancelled) setStats([
            { label: 'My Attendance %', value: repR.status === 'fulfilled' ? `${Math.round(repR.value.data.attendancePercentage ?? 0)}%` : '—', icon: ICONS.check, accent: 'orange' },
            { label: 'Classes Today', value: tR.status === 'fulfilled' ? (Array.isArray(tR.value.data) ? tR.value.data.length : 0) : '—', icon: ICONS.calendar, accent: 'indigo' },
            { label: 'Risk Score', value: riskR.status === 'fulfilled' ? (riskR.value.data.riskLevel ?? '—') : '—', icon: ICONS.warning, accent: 'indigo' },
            { label: 'Days Present', value: repR.status === 'fulfilled' ? (repR.value.data.totalPresent ?? '—') : '—', icon: ICONS.fire, accent: 'indigo' },
          ]);
        } else if (role === UserRole.HOD) {
          const depId = user?.departmentId;
          const [sR, tR, repR, riskR] = await Promise.allSettled([
            apiClient.get('/users', { params: { role: 'STUDENT' } }),
            apiClient.get('/users', { params: { role: 'TEACHER' } }),
            depId ? apiClient.get(`/reports/department/${depId}`) : Promise.reject(new Error('')),
            apiClient.get('/risk-scores'),
          ]);
          const atRisk = riskR.status === 'fulfilled' && Array.isArray(riskR.value.data) ? riskR.value.data.filter((s: any) => s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL').length : '—';
          if (!cancelled) setStats([
            { label: 'Dept. Students', value: sR.status === 'fulfilled' ? (Array.isArray(sR.value.data) ? sR.value.data.length : '—') : '—', icon: ICONS.users, accent: 'indigo' },
            { label: 'Dept. Teachers', value: tR.status === 'fulfilled' ? (Array.isArray(tR.value.data) ? tR.value.data.length : '—') : '—', icon: ICONS.academic, accent: 'indigo' },
            { label: 'Attendance Rate', value: repR.status === 'fulfilled' ? `${Math.round(repR.value.data.averageAttendancePercentage ?? 0)}%` : '—', icon: ICONS.chart, accent: 'orange' },
            { label: 'At-Risk Students', value: atRisk, icon: ICONS.warning, accent: 'indigo' },
          ]);
        }
      } catch { /* keep defaults */ }
      finally { if (!cancelled) setLoading(false); }
    }
    fetchStats();
    return () => { cancelled = true; };
  }, [role, user?.id, user?.classId, user?.departmentId]);
  return { stats, loading };
}

// ─── Main Dashboard Component ────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // Guardians redirect
  useEffect(() => {
    if (user?.role === UserRole.GUARDIAN) navigate('/parent', { replace: true });
  }, [user?.role, navigate]);

  const { stats, loading: statsLoading } = useDashboardStats(user ?? undefined);
  const primaryActions = getPrimaryActions(user?.role);
  const primaryActionPaths = new Set(primaryActions.map((action) => action.to));
  const quickActionGroups = getQuickActionGroups(user?.role)
    .map((group) => ({ ...group, actions: group.actions.filter((action) => !primaryActionPaths.has(action.to)) }))
    .filter((group) => group.actions.length > 0);
  const todayLabel = `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
  const [departmentName, setDepartmentName] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== UserRole.HOD || !user?.departmentId) { setDepartmentName(null); return; }
    apiClient.get('/departments').then(({ data }) => {
      const depts = Array.isArray(data) ? data : [];
      setDepartmentName(depts.find((d: any) => d.id === user.departmentId)?.name ?? null);
    }).catch(() => setDepartmentName(null));
  }, [user?.role, user?.departmentId]);

  let qi = 0;
  return (
    <div className="page-shell px-6 lg:px-8 py-6">
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <ActiveSessionReminder role={user?.role} userId={user?.id} />

      {/* Welcome Banner */}
      <div className="relative mb-8 dashboard-hero p-6 lg:p-7" style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}>
        <div className="relative z-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,430px)] lg:items-center">
          <div className="min-w-0">
            <span className="dashboard-kicker">SAMS Workbench</span>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-1">
              <h2 className="text-2xl lg:text-3xl font-bold text-ink tracking-tight">
                Welcome back, {user?.fullName?.split(' ')[0] || 'User'}
              </h2>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-brand bg-brand-light border border-brand/20 w-fit">
                {getRoleLabel(user?.role)}
              </span>
              {user?.role === UserRole.HOD && departmentName && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium text-brand bg-brand-light border border-brand/15 w-fit">{departmentName}</span>
              )}
            </div>
            <p className="text-ink-muted text-base max-w-lg">{getRoleGreeting(user?.role)}</p>
            <p className="text-xs text-ink-subtle mt-1">{todayLabel}</p>
            <div className="dashboard-signal-row">
              <span className="dashboard-signal">{quickActionGroups.length + (primaryActions.length > 0 ? 1 : 0)} work areas</span>
              <span className="dashboard-signal">Role: {getRoleLabel(user?.role)}</span>
              <Link to="/ai" className="dashboard-signal dashboard-signal--accent hover:border-accent-orange/45 hover:bg-accent-orange/15">
                AI assistant ready
              </Link>
            </div>
            {user?.role === UserRole.TEACHER && !user?.classId && (
              <p className="mt-3 text-sm text-ink-muted max-w-lg">Taught classes come from timetable and class-teacher assignments. If a class is missing, ask your HOD to update the timetable.</p>
            )}
          </div>

          {primaryActions.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {primaryActions.map((action, index) => (
                <CommandActionCard key={action.to} action={action} index={index} />
              ))}
            </div>
          )}
        </div>
      </div>

      <RoleWorkflowBoard role={user?.role} />

      {/* Stats */}
      <section className="mb-8">
        <SectionHeader title="Overview" icon={ICONS.chart} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {statsLoading ? [1, 2, 3, 4].map((i) => <SkeletonCard key={i} />) : stats.map((stat, i) => <AnimatedStatCard key={stat.label} stat={stat} index={i} />)}
        </div>
      </section>

      {/* Quick Actions */}
      <section className="mb-8">
        <SectionHeader title="Quick Actions" icon={ICONS.trending} />
        <div className="space-y-6">
          {quickActionGroups.map((group) => (
            <div key={group.title}>
              <h4 className="dash-group-label">{group.title}</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {group.actions.map((action) => {
                  const idx = qi++;
                  return <QuickActionButton key={`${group.title}-${action.to}`} action={action} index={idx} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom Insights */}
      <section>
        <SectionHeader title={user?.role === UserRole.STUDENT ? 'My day' : user?.role === UserRole.TEACHER ? 'Teaching today' : user?.role === UserRole.HOD ? 'Department today' : user?.role === UserRole.SCHOOL_ADMIN ? 'School today' : 'At a glance'} icon={ICONS.trending} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AtAGlancePanel role={user?.role} userId={user?.id} departmentId={user?.departmentId} classId={user?.classId} />
          {user?.role === UserRole.SCHOOL_ADMIN && <SchoolAdminInsightsPanel />}
          {user?.role === UserRole.STUDENT && (
            <div className="surface-panel" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="dash-card-icon dash-card-icon-primary">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.fire} />
                  </svg>
                </div>
                <h3 className="dash-section-title">Attendance Streak</h3>
              </div>
              <div className="text-center py-6">
                <p className="dash-stat-value text-accent-orange text-4xl mb-2">{stats.find((s) => s.label === 'Days Present')?.value ?? '—'}</p>
                <p className="text-sm text-ink-muted">days present (term total)</p>
              </div>
              <Link to="/reports" className="block text-center text-sm text-brand hover:text-brand-hover">View full attendance history →</Link>
            </div>
          )}
          {user?.role === UserRole.TEACHER && (
            <div className="surface-panel" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="dash-card-icon dash-card-icon-secondary">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.academic} />
                  </svg>
                </div>
                <div><h3 className="dash-section-title">My Class</h3></div>
              </div>
              <p className="text-sm text-ink-muted">Attendance rate: {stats.find((s) => s.label === 'Attendance Rate')?.value ?? '—'}</p>
              <div className="flex gap-2 mt-4">
                <Link to="/class/students" className="btn-primary text-xs py-2 px-4">My Students</Link>
                <Link to="/class-roster" className="text-xs py-2 px-4 rounded-xl border border-line text-ink-muted hover:bg-surface-muted">Class Roster →</Link>
              </div>
            </div>
          )}
          {(user?.role === UserRole.HOD || user?.role === UserRole.GUARDIAN) && (
            <div className="surface-panel" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
              <h3 className="dash-section-title mb-3">Quick Links</h3>
              <div className="space-y-2">
                {user?.role === UserRole.HOD && <Link to="/hod/department" className="block text-sm text-brand">Department Management →</Link>}
                <Link to="/reports" className="block text-sm text-brand">View Reports →</Link>
                <Link to="/notifications" className="block text-sm text-brand">Notifications →</Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default DashboardPage;
