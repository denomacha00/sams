import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { io as socketIo } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../services/apiClient';
import { UserAvatar } from '../components/UserAvatar';
import { useTheme } from '../hooks/useTheme';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string | number;
  icon: string;
  /** Orange accent only for attendance / risk metrics */
  accent?: 'orange' | 'indigo';
}

interface QuickAction {
  to: string;
  label: string;
  subtitle: string;
  icon: string;
  /** Sign-in tile uses indigo; other attendance CTAs use solid orange accent */
  variant?: 'signin' | 'attendance' | 'alert' | 'default';
}

interface QuickActionGroup {
  title: string;
  actions: QuickAction[];
}

interface DashboardStats {
  stats: StatCard[];
  loading: boolean;
}

// ─── Icons (SVG paths) ───────────────────────────────────────────────────────

const ICONS = {
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  academic: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
  session: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  link: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  building: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  qr: 'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z',
  ai: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  moon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  fire: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
  trending: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
};


// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
    case UserRole.TEACHER: return 'Ready to inspire today? Here\'s your teaching overview.';
    case UserRole.STUDENT: return 'Stay on track with your attendance and schedule.';
    default: return 'Welcome to your personalized dashboard.';
  }
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
    const dayOffset =
      entry.dayOfWeek >= todayIndex ? entry.dayOfWeek - todayIndex : entry.dayOfWeek + 7 - todayIndex;
    const endMin = parseTimeMinutes(entry.endTime);
    const startMin = parseTimeMinutes(entry.startTime);
    if (dayOffset === 0 && endMin <= nowMin) continue;
    return entry;
  }
  return sorted[0] ?? null;
}

function describeNextClass(entry: TimetableInsightEntry | null): { title: string; detail: string } {
  if (!entry) {
    return { title: 'No upcoming class', detail: 'Check your full timetable for the week.' };
  }
  const todayIndex = (new Date().getDay() + 6) % 7;
  const dayLabel = entry.dayOfWeek === todayIndex ? 'Today' : DAY_SHORT[entry.dayOfWeek] ?? '';
  const classLabel = entry.class?.name ? ` · ${entry.class.name}` : '';
  return {
    title: entry.subject,
    detail: `${dayLabel} ${entry.startTime}–${entry.endTime}${classLabel}`,
  };
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

// ─── Section Header Component ────────────────────────────────────────────────

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

// ─── Skeleton Loader ─────────────────────────────────────────────────────────

const SkeletonCard: React.FC = () => (
  <div className="animate-pulse dash-stat border-l-indigo-500/30">
    <div className="w-9 h-9 rounded-lg bg-surface-elevated shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3 w-24 bg-surface-elevated rounded" />
      <div className="h-7 w-14 bg-surface-elevated rounded" />
    </div>
  </div>
);

// ─── Stat Card Component ─────────────────────────────────────────────────────

const AnimatedStatCard: React.FC<{ stat: StatCard; index: number }> = ({ stat, index }) => {
  const isOrange = stat.accent === 'orange';
  return (
    <div
      className={`dash-stat ${isOrange ? 'dash-stat-accent-orange' : 'dash-stat-accent-indigo'}`}
      style={{
        animationDelay: `${index * 80}ms`,
        animation: 'fadeInUp 0.5s ease-out forwards',
        opacity: 0,
      }}
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

// ─── Quick Action Button ─────────────────────────────────────────────────────

const QuickActionButton: React.FC<{ action: QuickAction; index: number }> = ({ action, index }) => {
  const isSignIn = action.variant === 'signin';
  const isAttendance = action.variant === 'attendance';
  const useIndigo = isSignIn || !isAttendance;
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
        <svg
          className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
};


// ─── Role-specific "At a glance" (replaces duplicate timetable on dashboard) ─

const AttendanceWorkflowPanel: React.FC<{ role?: UserRole }> = ({ role }) => {
  if (role !== UserRole.TEACHER && role !== UserRole.HOD) return null;

  const steps = [
    { to: '/timetable', label: 'Timetable', detail: 'Current slot', icon: ICONS.calendar },
    { to: '/sessions', label: 'Start Session', detail: 'QR and link', icon: ICONS.qr },
    { to: '/attendance', label: 'Manual', detail: 'Roll call', icon: ICONS.clipboard },
    { to: '/biometric/attendance', label: 'Face Attendance', detail: 'Camera match', icon: ICONS.check },
    { to: '/reports', label: 'Reports', detail: 'After class', icon: ICONS.chart },
  ];

  return (
    <section className="mb-8 surface-panel rounded-2xl p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Attendance workflow</h3>
          <p className="text-xs text-ink-muted">Timetable-locked sessions with QR, link, manual, and face attendance paths.</p>
        </div>
        <Link to="/sessions" className="btn-primary px-4 py-2 text-sm w-full sm:w-auto text-center">
          Open Sessions
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => (
          <Link
            key={step.to}
            to={step.to}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-3 hover:border-blue-500/50 hover:bg-surface-elevated transition-colors"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-light text-blue-200">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={step.icon} />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-ink">{index + 1}. {step.label}</span>
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
    if (!userId || (role !== UserRole.TEACHER && role !== UserRole.HOD)) {
      setSessions([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const params: Record<string, string | boolean> = { isActive: true };
        if (role === UserRole.TEACHER) params.teacherId = userId;
        const { data } = await apiClient.get('/sessions', { params });
        if (!cancelled) {
          setSessions(Array.isArray(data) ? data.filter((s) => s.isActive !== false) : []);
        }
      } catch {
        if (!cancelled) setSessions([]);
      }
    };

    void load();
    const timer = window.setInterval(load, ACTIVE_SESSION_REMINDER_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [role, userId]);

  if (sessions.length === 0) return null;

  const first = sessions[0];
  const className = first.className ?? first.class?.name ?? 'Class';
  const extra = sessions.length > 1 ? ` +${sessions.length - 1} more` : '';

  return (
    <section className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/12 p-4 shadow-card-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-red-400/45 bg-red-500/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-red-100">
              <span className="h-2 w-2 rounded-full bg-red-300 animate-pulse" />
              Live attendance session
            </span>
            <span className="text-xs text-red-100/75">
              Keep it open until the lesson ends, or end it from Sessions.
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-semibold text-ink">
            {first.subject} - {className}{extra}
          </p>
        </div>
        <Link to="/sessions" className="btn-attendance px-4 py-2 text-sm text-center">
          Open / End Session
        </Link>
      </div>
    </section>
  );
};

function getAtAGlanceTitle(role?: UserRole): string {
  switch (role) {
    case UserRole.STUDENT:
      return 'My day';
    case UserRole.TEACHER:
      return 'Teaching today';
    case UserRole.HOD:
      return 'Department today';
    case UserRole.SCHOOL_ADMIN:
      return 'School today';
    default:
      return 'At a glance';
  }
}

const insightsPanelAnim = { animation: 'fadeInUp 0.5s ease-out 0.6s forwards', opacity: 0 };
const insightsPanelAnimLate = { animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 };

const InsightRow: React.FC<{
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  hint?: string;
}> = ({ label, value, valueClass = 'text-ink font-semibold', hint }) => (
  <div className="surface-muted-row">
    <div className="min-w-0">
      <span className="text-sm text-ink-muted">{label}</span>
      {hint && <p className="text-xs text-ink-subtle mt-0.5 truncate">{hint}</p>}
    </div>
    <span className={`text-sm shrink-0 ml-3 ${valueClass}`}>{value}</span>
  </div>
);

const InsightsPanelShell: React.FC<{
  title: string;
  icon: string;
  animStyle?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ title, icon, animStyle = insightsPanelAnim, children }) => (
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

const AtAGlancePanel: React.FC<{
  role?: UserRole;
  userId?: string;
  departmentId?: string;
  classId?: string;
}> = ({ role, userId, departmentId, classId }) => {
  const [loading, setLoading] = useState(true);
  const [nextClass, setNextClass] = useState<{ title: string; detail: string } | null>(null);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [attendanceTodayLabel, setAttendanceTodayLabel] = useState('—');
  const [pendingCount, setPendingCount] = useState(0);
  const [studentStatus, setStudentStatus] = useState<string>('—');
  const [schoolSessionsToday, setSchoolSessionsToday] = useState<number | string>('—');
  const [schoolAbsentToday, setSchoolAbsentToday] = useState<number | string>('—');

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
            const entries = (Array.isArray(timetableRes.value.data) ? timetableRes.value.data : []) as TimetableInsightEntry[];
            setNextClass(describeNextClass(findNextTimetableEntry(entries)));
          }
          if (!cancelled && attendanceRes.status === 'fulfilled') {
            const todayRecords = (Array.isArray(attendanceRes.value.data) ? attendanceRes.value.data : []).filter(
              (r: { createdAt?: string }) => isToday(r.createdAt),
            );
            const present = todayRecords.filter((r: { status?: string }) => r.status === 'PRESENT' || r.status === 'LATE').length;
            const absent = todayRecords.filter((r: { status?: string }) => r.status === 'ABSENT').length;
            if (present > 0) setStudentStatus(`${present} present`);
            else if (absent > 0) setStudentStatus(`${absent} absent`);
            else setStudentStatus('Not marked yet');
          }
        } else if (role === UserRole.TEACHER && userId) {
          const [timetableRes, sessionsRes, unreadRes, reportsRes] = await Promise.allSettled([
            timetableReq,
            apiClient.get('/sessions', { params: { teacherId: userId, isActive: true } }),
            unreadReq,
            classId ? apiClient.get(`/reports/class/${classId}`) : Promise.reject(new Error('no class')),
          ]);
          if (!cancelled && timetableRes.status === 'fulfilled') {
            const entries = (Array.isArray(timetableRes.value.data) ? timetableRes.value.data : []) as TimetableInsightEntry[];
            setNextClass(describeNextClass(findNextTimetableEntry(entries)));
          }
          if (!cancelled && sessionsRes.status === 'fulfilled') {
            setActiveSessionCount(Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data.length : 0);
          }
          if (!cancelled && reportsRes.status === 'fulfilled') {
            setAttendanceTodayLabel(`${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`);
          }
          if (!cancelled && unreadRes.status === 'fulfilled') {
            setPendingCount(unreadRes.value.data.count ?? 0);
          }
        } else if (role === UserRole.HOD) {
          const [timetableRes, sessionsRes, unreadRes, reportsRes, riskRes] = await Promise.allSettled([
            timetableReq,
            apiClient.get('/sessions', { params: { isActive: true } }),
            unreadReq,
            departmentId
              ? apiClient.get(`/reports/department/${departmentId}`)
              : Promise.reject(new Error('no dept')),
            apiClient.get('/risk-scores'),
          ]);
          if (!cancelled && timetableRes.status === 'fulfilled') {
            const entries = (Array.isArray(timetableRes.value.data) ? timetableRes.value.data : []) as TimetableInsightEntry[];
            setNextClass(describeNextClass(findNextTimetableEntry(entries)));
          }
          if (!cancelled && sessionsRes.status === 'fulfilled') {
            setActiveSessionCount(Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data.length : 0);
          }
          if (!cancelled && reportsRes.status === 'fulfilled') {
            setAttendanceTodayLabel(`${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`);
          }
          const unread = unreadRes.status === 'fulfilled' ? (unreadRes.value.data.count ?? 0) : 0;
          const atRisk =
            riskRes.status === 'fulfilled' && Array.isArray(riskRes.value.data)
              ? riskRes.value.data.filter(
                  (s: { riskLevel?: string }) => s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL',
                ).length
              : 0;
          if (!cancelled) setPendingCount(unread + atRisk);
        } else if (role === UserRole.SCHOOL_ADMIN) {
          const [sessionsRes, attendanceRes, reportsRes, unreadRes] = await Promise.allSettled([
            apiClient.get('/sessions'),
            apiClient.get('/attendance', { params: { status: 'ABSENT' } }),
            apiClient.get('/reports/school'),
            unreadReq,
          ]);
          if (!cancelled && sessionsRes.status === 'fulfilled') {
            const sessions = Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data : [];
            setSchoolSessionsToday(
              sessions.filter((s: { startedAt?: string }) => isToday(s.startedAt)).length,
            );
            setActiveSessionCount(sessions.filter((s: { isActive?: boolean }) => s.isActive).length);
          }
          if (!cancelled && attendanceRes.status === 'fulfilled') {
            const absentToday = (Array.isArray(attendanceRes.value.data) ? attendanceRes.value.data : []).filter(
              (r: { createdAt?: string }) => isToday(r.createdAt),
            ).length;
            setSchoolAbsentToday(absentToday);
          }
          if (!cancelled && reportsRes.status === 'fulfilled') {
            setAttendanceTodayLabel(`${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`);
          }
          if (!cancelled && unreadRes.status === 'fulfilled') {
            setPendingCount(unreadRes.value.data.count ?? 0);
          }
        }
      } catch {
        // Non-critical dashboard widget
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [role, userId, departmentId, classId]);

  const title = getAtAGlanceTitle(role);

  return (
    <InsightsPanelShell title={title} icon={ICONS.calendar}>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-11 rounded-xl bg-surface-elevated" />
          ))}
        </div>
      ) : role === UserRole.STUDENT ? (
        <div className="space-y-2">
          <InsightRow
            label="Next class"
            value={nextClass?.title ?? '—'}
            hint={nextClass?.detail}
            valueClass="text-ink font-medium text-right max-w-[55%] truncate"
          />
          <InsightRow label="Today's attendance" value={studentStatus} valueClass="text-accent-orange font-semibold" />
          <Link to="/timetable" className="block text-center text-sm text-brand hover:text-brand-hover pt-2">
            Full timetable →
          </Link>
        </div>
      ) : role === UserRole.TEACHER ? (
        <div className="space-y-2">
          <InsightRow
            label="Next class"
            value={nextClass?.title ?? '—'}
            hint={nextClass?.detail}
            valueClass="text-ink font-medium text-right max-w-[55%] truncate"
          />
          <InsightRow
            label="Active sessions"
            value={activeSessionCount}
            valueClass={activeSessionCount > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'}
          />
          <InsightRow label="Class attendance" value={attendanceTodayLabel} valueClass="text-accent-orange font-semibold" />
          <InsightRow label="Pending actions" value={pendingCount} valueClass="text-brand font-semibold" />
          <Link to="/sessions" className="block text-center text-sm text-brand hover:text-brand-hover pt-2">
            Open sessions & QR →
          </Link>
        </div>
      ) : role === UserRole.HOD ? (
        <div className="space-y-2">
          <InsightRow
            label="Next class"
            value={nextClass?.title ?? '—'}
            hint={nextClass?.detail}
            valueClass="text-ink font-medium text-right max-w-[55%] truncate"
          />
          <InsightRow
            label="Live sessions (school)"
            value={activeSessionCount}
            valueClass={activeSessionCount > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'}
          />
          <InsightRow label="Dept. attendance" value={attendanceTodayLabel} valueClass="text-accent-orange font-semibold" />
          <InsightRow label="Pending (alerts + unread)" value={pendingCount} valueClass="text-brand font-semibold" />
          <div className="flex gap-2 pt-2">
            <Link to="/risk-scores" className="flex-1 text-center text-xs py-2 rounded-xl border border-line text-ink-muted hover:bg-surface-muted">
              At-risk →
            </Link>
            <Link to="/notifications" className="flex-1 text-center text-xs py-2 rounded-xl border border-line text-ink-muted hover:bg-surface-muted">
              Messages →
            </Link>
          </div>
        </div>
      ) : role === UserRole.SCHOOL_ADMIN ? (
        <div className="space-y-2">
          <InsightRow label="Sessions today" value={schoolSessionsToday} />
          <InsightRow label="Absent today" value={schoolAbsentToday} valueClass="text-accent-orange font-semibold" />
          <InsightRow label="School attendance" value={attendanceTodayLabel} valueClass="text-accent-orange font-semibold" />
          <InsightRow
            label="Active sessions now"
            value={activeSessionCount}
            valueClass={activeSessionCount > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'}
          />
          <InsightRow label="Unread messages" value={pendingCount} valueClass="text-brand font-semibold" />
        </div>
      ) : (
        <p className="text-ink-subtle text-sm text-center py-4">Welcome to SAMS</p>
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
    Promise.allSettled([
      apiClient.get('/sessions', { params: { isActive: true } }),
      apiClient.get('/sessions'),
      apiClient.get('/attendance', { params: { status: 'ABSENT' } }),
      apiClient.get('/reports/school'),
    ])
      .then(([activeRes, allRes, absentRes, reportRes]) => {
        if (cancelled) return;
        if (activeRes.status === 'fulfilled') {
          setActiveSessions(Array.isArray(activeRes.value.data) ? activeRes.value.data.length : 0);
        }
        if (allRes.status === 'fulfilled') {
          const sessions = Array.isArray(allRes.value.data) ? allRes.value.data : [];
          setSessionsToday(sessions.filter((s: { startedAt?: string }) => isToday(s.startedAt)).length);
        }
        if (absentRes.status === 'fulfilled') {
          setAbsentToday(
            (Array.isArray(absentRes.value.data) ? absentRes.value.data : []).filter((r: { createdAt?: string }) =>
              isToday(r.createdAt),
            ).length,
          );
        }
        if (reportRes.status === 'fulfilled') {
          setAttendanceRate(`${Math.round(reportRes.value.data.averageAttendancePercentage ?? 0)}%`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <InsightsPanelShell title="Quick stats" icon={ICONS.chart} animStyle={insightsPanelAnimLate}>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-11 rounded-xl bg-surface-elevated" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <InsightRow
            label="Active sessions"
            value={activeSessions}
            valueClass={activeSessions > 0 ? 'text-accent-orange font-semibold' : 'text-brand font-semibold'}
          />
          <InsightRow label="Sessions started today" value={sessionsToday} />
          <InsightRow label="Marked absent today" value={absentToday} valueClass="text-accent-orange font-semibold" />
          <InsightRow label="Overall attendance" value={attendanceRate} valueClass="text-accent-orange font-semibold" />
          <p className="text-xs text-ink-subtle pt-1 px-0.5">
            For broadcasts and message history, use Notifications in Quick Actions — not a live feed here.
          </p>
          <Link to="/reports" className="block text-center text-sm text-brand hover:text-brand-hover pt-2">
            School reports →
          </Link>
        </div>
      )}
    </InsightsPanelShell>
  );
};


// ─── Role-specific config ────────────────────────────────────────────────────

function getQuickActionGroups(role?: UserRole): QuickActionGroup[] {
  switch (role) {
    case UserRole.SCHOOL_ADMIN:
      return [
        {
          title: 'School Management',
          actions: [
            { to: '/admin/links', label: 'Registration Links', subtitle: 'Main way to onboard students and staff', icon: ICONS.link, variant: 'signin' },
            { to: '/admin/users', label: 'User Management', subtitle: 'Manual add only if someone has no phone for SMS/link signup', icon: ICONS.users },
            { to: '/class/students', label: 'Student Workbench', subtitle: 'Classes, lessons & attendance gaps', icon: ICONS.users },
            { to: '/admin/departments', label: 'Departments', subtitle: 'Organize faculties', icon: ICONS.building },
            { to: '/class-roster', label: 'View Class Reps', subtitle: 'See assigned student leaders', icon: ICONS.users },
          ],
        },
        {
          title: 'Reports & Schedule',
          actions: [
            { to: '/reports', label: 'View Reports', subtitle: 'School-wide attendance', icon: ICONS.chart },
            { to: '/timetable', label: 'View Timetable', subtitle: 'Master schedule', icon: ICONS.calendar },
            { to: '/admin/knowledge', label: 'Knowledge Base', subtitle: 'Policies & guides', icon: ICONS.book },
          ],
        },
        {
          title: 'Communication',
          actions: [
            { to: '/notifications', label: 'Notifications', subtitle: 'Alerts & broadcasts', icon: ICONS.bell },
            { to: '/ai', label: 'AI Assistant', subtitle: 'Ask SAMS anything', icon: ICONS.ai },
          ],
        },
      ];
    case UserRole.TEACHER:
      return [
        {
          title: 'Class & Onboarding',
          actions: [
            { to: '/admin/links', label: 'Registration Links', subtitle: 'Share signup links first', icon: ICONS.link, variant: 'signin' },
            { to: '/class/students', label: 'My Students', subtitle: 'Class roster & details', icon: ICONS.users },
            { to: '/class-roster', label: 'Assign Class Rep', subtitle: 'Pick a class representative', icon: ICONS.users },
          ],
        },
        {
          title: 'Attendance',
          actions: [
            { to: '/sessions', label: 'QR / Link Session', subtitle: 'Start session and share check-in link', icon: ICONS.qr, variant: 'signin' },
            { to: '/attendance', label: 'Manual Attendance', subtitle: 'Roll call and corrections', icon: ICONS.clipboard, variant: 'attendance' },
            { to: '/biometric/attendance', label: 'Face Attendance', subtitle: 'Camera match for enrolled students', icon: ICONS.check, variant: 'attendance' },
            { to: '/settings', label: 'Fingerprint Setup', subtitle: 'Passkey or external scanner settings', icon: ICONS.settings },
          ],
        },
        {
          title: 'Schedule & Reports',
          actions: [
            { to: '/timetable', label: 'My Timetable', subtitle: 'Your weekly schedule', icon: ICONS.calendar },
            { to: '/reports', label: 'View Reports', subtitle: 'Class attendance stats', icon: ICONS.chart },
            { to: '/risk-scores', label: 'Risk Scores', subtitle: 'Students who need follow-up', icon: ICONS.warning },
            { to: '/admin/knowledge', label: 'Knowledge Base', subtitle: 'Teaching resources', icon: ICONS.book },
          ],
        },
        {
          title: 'Communication',
          actions: [
            { to: '/notifications', label: 'Notifications', subtitle: 'Messages from school', icon: ICONS.bell },
            { to: '/ai', label: 'AI Assistant', subtitle: 'Teaching & SAMS help', icon: ICONS.ai },
          ],
        },
      ];
    case UserRole.STUDENT:
      return [
        {
          title: 'Today',
          actions: [
            { to: '/sessions/scan', label: 'Scan QR', subtitle: 'Check in to class', icon: ICONS.qr, variant: 'attendance' },
            { to: '/timetable', label: 'View Timetable', subtitle: 'Classes & rooms', icon: ICONS.calendar },
          ],
        },
        {
          title: 'Stay Informed',
          actions: [
            { to: '/notifications', label: 'Messages', subtitle: 'School announcements', icon: ICONS.bell },
            { to: '/reports', label: 'My Reports', subtitle: 'Your attendance history', icon: ICONS.chart },
            { to: '/ai', label: 'AI Assistant', subtitle: 'Help with SAMS', icon: ICONS.ai },
          ],
        },
        {
          title: 'Account',
          actions: [
            { to: '/profile', label: 'Profile', subtitle: 'Photo & account info', icon: ICONS.profile },
          ],
        },
      ];
    case UserRole.HOD:
      return [
        {
          title: 'Department & Onboarding',
          actions: [
            { to: '/admin/links', label: 'Registration Links', subtitle: 'Share department signup links', icon: ICONS.link, variant: 'signin' },
            { to: '/hod/department', label: 'Department Management', subtitle: 'Staff & structure', icon: ICONS.building },
            { to: '/admin/users', label: 'Manage Users', subtitle: 'Dept. accounts', icon: ICONS.users },
            { to: '/class/students', label: 'Dept Students', subtitle: 'Class lists & attendance gaps', icon: ICONS.users },
            { to: '/class-roster', label: 'Class Reps', subtitle: 'Student leaders', icon: ICONS.users },
          ],
        },
        {
          title: 'Attendance',
          actions: [
            { to: '/sessions', label: 'Sign In Students', subtitle: 'QR, link, manual, face attendance', icon: ICONS.qr, variant: 'signin' },
            { to: '/attendance', label: 'Mark Attendance', subtitle: 'Override or manual', icon: ICONS.clipboard, variant: 'attendance' },
            { to: '/biometric/attendance', label: 'Face Attendance', subtitle: 'Camera match for enrolled students', icon: ICONS.check, variant: 'attendance' },
            { to: '/settings', label: 'Fingerprint Setup', subtitle: 'Passkey or external scanner settings', icon: ICONS.settings },
          ],
        },
        {
          title: 'Schedule & Insights',
          actions: [
            { to: '/timetable', label: 'View Timetable', subtitle: 'Dept. schedule', icon: ICONS.calendar },
            { to: '/admin/timetable', label: 'Edit Timetable', subtitle: 'Build & publish slots', icon: ICONS.calendar },
            { to: '/reports', label: 'View Reports', subtitle: 'Dept. analytics', icon: ICONS.chart },
            { to: '/risk-scores', label: 'Risk Scores', subtitle: 'At-risk students', icon: ICONS.warning },
            { to: '/admin/knowledge', label: 'Knowledge Base', subtitle: 'Dept. documentation', icon: ICONS.book },
          ],
        },
        {
          title: 'Communication',
          actions: [
            { to: '/notifications', label: 'Notifications', subtitle: 'Dept. alerts', icon: ICONS.bell },
            { to: '/ai', label: 'AI Assistant', subtitle: 'Insights & SAMS help', icon: ICONS.ai },
          ],
        },
      ];
    default:
      return [];
  }
}

function getDefaultStats(role?: UserRole): StatCard[] {
  switch (role) {
    case UserRole.SCHOOL_ADMIN:
      return [
        { label: 'Total Students', value: '—', icon: ICONS.users, accent: 'indigo' },
        { label: 'Total Teachers', value: '—', icon: ICONS.academic, accent: 'indigo' },
        { label: 'Active Sessions', value: '—', icon: ICONS.session, accent: 'indigo' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, accent: 'orange' },
      ];
    case UserRole.TEACHER:
      return [
        { label: 'My Students', value: '—', icon: ICONS.users, accent: 'indigo' },
        { label: "Today's Sessions", value: '—', icon: ICONS.session, accent: 'indigo' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, accent: 'orange' },
        { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, accent: 'indigo' },
      ];
    case UserRole.STUDENT:
      return [
        { label: 'My Attendance %', value: '—', icon: ICONS.check, accent: 'orange' },
        { label: 'Classes Today', value: '—', icon: ICONS.calendar, accent: 'indigo' },
        { label: 'Risk Score', value: '—', icon: ICONS.warning, accent: 'indigo' },
        { label: 'Days Present', value: '—', icon: ICONS.fire, accent: 'indigo' },
      ];
    case UserRole.HOD:
      return [
        { label: 'Dept. Students', value: '—', icon: ICONS.users, accent: 'indigo' },
        { label: 'Dept. Teachers', value: '—', icon: ICONS.academic, accent: 'indigo' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, accent: 'orange' },
        { label: 'At-Risk Students', value: '—', icon: ICONS.warning, accent: 'indigo' },
      ];
    default:
      return [];
  }
}


// ─── Data Fetching Hooks ─────────────────────────────────────────────────────

function useDashboardStats(user?: { id: string; role?: UserRole; classId?: string; departmentId?: string }): DashboardStats {
  const role = user?.role;
  const [stats, setStats] = useState<StatCard[]>(getDefaultStats(role));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        switch (role) {
          case UserRole.SCHOOL_ADMIN: {
            const [usersStudentRes, usersTeacherRes, sessionsRes, reportsRes] = await Promise.allSettled([
              apiClient.get('/users', { params: { role: 'STUDENT' } }),
              apiClient.get('/users', { params: { role: 'TEACHER' } }),
              apiClient.get('/sessions', { params: { isActive: true } }),
              apiClient.get('/reports/school'),
            ]);

            const totalStudents = usersStudentRes.status === 'fulfilled'
              ? (Array.isArray(usersStudentRes.value.data) ? usersStudentRes.value.data.length : '—')
              : '—';
            const totalTeachers = usersTeacherRes.status === 'fulfilled'
              ? (Array.isArray(usersTeacherRes.value.data) ? usersTeacherRes.value.data.length : '—')
              : '—';
            const activeSessions = sessionsRes.status === 'fulfilled'
              ? (Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data.length : 0)
              : '—';
            const attendanceRate = reportsRes.status === 'fulfilled'
              ? `${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`
              : '—';

            if (!cancelled) {
              setStats([
                { label: 'Total Students', value: totalStudents, icon: ICONS.users, accent: 'indigo' },
                { label: 'Total Teachers', value: totalTeachers, icon: ICONS.academic, accent: 'indigo' },
                { label: 'Active Sessions', value: activeSessions, icon: ICONS.session, accent: 'indigo' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, accent: 'orange' },
              ]);
            }
            break;
          }
          case UserRole.TEACHER: {
            const [meRes, studentsRes, sessionsRes] = await Promise.allSettled([
              apiClient.get('/users/me'),
              apiClient.get('/users/class-roster'),
              apiClient.get('/sessions', { params: { teacherId: user?.id } }),
            ]);
            const classId =
              meRes.status === 'fulfilled' ? (meRes.value.data.classId as string | undefined) : user?.classId;
            const reportsRes = classId
              ? await Promise.allSettled([apiClient.get(`/reports/class/${classId}`)]).then((r) => r[0])
              : { status: 'rejected' as const, reason: new Error('No classId') };

            const myStudents = studentsRes.status === 'fulfilled'
              ? (Array.isArray(studentsRes.value.data) ? studentsRes.value.data.length : 0)
              : '—';
            const todaySessions = sessionsRes.status === 'fulfilled'
              ? (Array.isArray(sessionsRes.value.data) ? sessionsRes.value.data.length : 0)
              : '—';
            const attendanceRate = reportsRes.status === 'fulfilled'
              ? `${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`
              : '—';

            if (!cancelled) {
              setStats([
                { label: 'My Students', value: myStudents, icon: ICONS.users, accent: 'indigo' },
                { label: "Today's Sessions", value: todaySessions, icon: ICONS.session, accent: 'indigo' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, accent: 'orange' },
                { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, accent: 'indigo' },
              ]);
            }
            break;
          }
          case UserRole.STUDENT: {
            const studentId = user?.id;
            const [reportsRes, timetableRes, riskRes] = await Promise.allSettled([
              studentId
                ? apiClient.get(`/reports/student/${studentId}`)
                : Promise.reject(new Error('No studentId')),
              apiClient.get('/timetable'),
              apiClient.get('/risk-scores/me'),
            ]);

            const attendancePct = reportsRes.status === 'fulfilled'
              ? `${Math.round(reportsRes.value.data.attendancePercentage ?? 0)}%`
              : '—';
            const classesToday = timetableRes.status === 'fulfilled'
              ? (Array.isArray(timetableRes.value.data) ? timetableRes.value.data.length : 0)
              : '—';
            const riskScore = riskRes.status === 'fulfilled'
              ? (riskRes.value.data.riskLevel ?? '—')
              : '—';
            const daysPresent = reportsRes.status === 'fulfilled'
              ? (reportsRes.value.data.totalPresent ?? '—')
              : '—';

            if (!cancelled) {
              setStats([
                { label: 'My Attendance %', value: attendancePct, icon: ICONS.check, accent: 'orange' },
                { label: 'Classes Today', value: classesToday, icon: ICONS.calendar, accent: 'indigo' },
                { label: 'Risk Score', value: riskScore, icon: ICONS.warning, accent: 'indigo' },
                { label: 'Days Present', value: daysPresent, icon: ICONS.fire, accent: 'indigo' },
              ]);
            }
            break;
          }
          case UserRole.HOD: {
            const departmentId = user?.departmentId;
            const [usersStudentRes, usersTeacherRes, reportsRes, riskRes] = await Promise.allSettled([
              apiClient.get('/users', { params: { role: 'STUDENT' } }),
              apiClient.get('/users', { params: { role: 'TEACHER' } }),
              departmentId
                ? apiClient.get(`/reports/department/${departmentId}`)
                : Promise.reject(new Error('No departmentId')),
              apiClient.get('/risk-scores'),
            ]);

            const deptStudents = usersStudentRes.status === 'fulfilled'
              ? (Array.isArray(usersStudentRes.value.data) ? usersStudentRes.value.data.length : '—')
              : '—';
            const deptTeachers = usersTeacherRes.status === 'fulfilled'
              ? (Array.isArray(usersTeacherRes.value.data) ? usersTeacherRes.value.data.length : '—')
              : '—';
            const attendanceRate = reportsRes.status === 'fulfilled'
              ? `${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%`
              : '—';
            const atRisk = riskRes.status === 'fulfilled' && Array.isArray(riskRes.value.data)
              ? riskRes.value.data.filter((s: { riskLevel?: string }) =>
                  s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL',
                ).length
              : '—';

            if (!cancelled) {
              setStats([
                { label: 'Dept. Students', value: deptStudents, icon: ICONS.users, accent: 'indigo' },
                { label: 'Dept. Teachers', value: deptTeachers, icon: ICONS.academic, accent: 'indigo' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, accent: 'orange' },
                { label: 'At-Risk Students', value: atRisk, icon: ICONS.warning, accent: 'indigo' },
              ]);
            }
            break;
          }
        }
      } catch {
        // Keep default placeholder stats on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStats();
    return () => { cancelled = true; };
  }, [role, user?.id, user?.classId, user?.departmentId]);

  return { stats, loading };
}

// ─── Teacher class panel (uses class-roster — teachers lack manage:users) ─────

interface TeacherStudentPreview {
  id: string;
  fullName: string;
  admissionNumber?: string | null;
  isClassRep?: boolean;
  classId?: string | null;
  className?: string | null;
}

const TeacherClassPanel: React.FC<{ classId?: string; attendanceRate?: string }> = ({
  attendanceRate,
}) => {
  const [students, setStudents] = useState<TeacherStudentPreview[]>([]);
  const [classSummary, setClassSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data } = await apiClient.get('/users/class-roster');
        if (!cancelled) {
          const roster = Array.isArray(data) ? data : [];
          const classNames = Array.from(
            new Set(
              roster
                .map((student: TeacherStudentPreview) => student.className)
                .filter((name: string | null | undefined): name is string => !!name),
            ),
          );
          setStudents(roster);
          setClassSummary(
            classNames.length === 0
              ? null
              : classNames.length === 1
                ? classNames[0]
                : `${classNames.length} taught classes`,
          );
        }
      } catch {
        // Non-critical widget
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = students.slice(0, 5);

  return (
    <div
      className="surface-panel"
      style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}
    >
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="dash-card-icon dash-card-icon-secondary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.academic} />
            </svg>
          </div>
          <div>
            <h3 className="dash-section-title">My Taught Classes</h3>
            {classSummary && <p className="text-xs text-ink-muted">{classSummary}</p>}
          </div>
        </div>
        <span className="text-sm font-semibold text-indigo-400">
          {loading ? '…' : `${students.length} student${students.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Link to="/class/students" className="btn-primary text-xs py-2 px-4">
          My Students
        </Link>
        <Link
          to="/class-roster"
          className="text-xs py-2 px-4 rounded-xl border border-line text-ink-muted hover:bg-surface-muted transition-colors"
        >
          Class Roster
        </Link>
      </div>

      <div className="surface-muted-row mb-4">
        <span className="text-sm text-ink-muted">Attendance rate</span>
        <span className="text-sm font-semibold text-indigo-400">{attendanceRate ?? '—'}</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-10 rounded-xl bg-surface-elevated" />
          ))}
        </div>
      ) : preview.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-4">No students found in classes you teach yet.</p>
      ) : (
        <ul className="space-y-2">
          {preview.map((s) => (
            <li
              key={s.id}
              className="surface-muted-row"
            >
              <span className="text-sm text-ink">{s.fullName}</span>
              <span className="text-xs text-ink-muted">
                {s.className || (s.isClassRep ? 'Class rep' : '')}
              </span>
            </li>
          ))}
          {students.length > preview.length && (
            <li className="text-center pt-1">
              <Link to="/class/students" className="text-xs text-brand hover:text-brand-hover">
                View all {students.length} students →
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

// ─── HOD department overview (stats from dashboard hook) ─────────────────────

const HodDepartmentPanel: React.FC<{ stats: StatCard[]; departmentName?: string | null }> = ({
  stats,
  departmentName,
}) => {
  const deptStudents = stats.find((s) => s.label === 'Dept. Students')?.value ?? '—';
  const deptTeachers = stats.find((s) => s.label === 'Dept. Teachers')?.value ?? '—';
  const attendanceRate = stats.find((s) => s.label === 'Attendance Rate')?.value ?? '—';
  const atRisk = stats.find((s) => s.label === 'At-Risk Students')?.value ?? '—';

  return (
    <div
      className="surface-panel"
      style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="dash-card-icon dash-card-icon-secondary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.building} />
          </svg>
        </div>
        <div>
          <h3 className="dash-section-title">Department Overview</h3>
          {departmentName && (
            <p className="text-xs text-brand/90">{departmentName}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">Students</span>
          <span className="text-sm font-semibold text-indigo-400">{deptStudents}</span>
        </div>
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">Teachers</span>
          <span className="text-sm font-semibold text-indigo-400">{deptTeachers}</span>
        </div>
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">Avg. Attendance</span>
          <span className="text-sm font-semibold text-accent-orange">{attendanceRate}</span>
        </div>
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">High Risk Students</span>
          <span className="text-sm font-semibold text-accent-orange">{atRisk}</span>
        </div>
      </div>
      <Link
        to="/hod/department"
        className="block text-center text-sm text-brand hover:text-brand-hover mt-4"
      >
        Open department management →
      </Link>
    </div>
  );
};

// ─── Main Dashboard Component ────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);
  const updateUser = useAuthStore((s) => s.updateUser);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [currentTime, setCurrentTime] = useState(formatTime());
  const [unreadCount, setUnreadCount] = useState(0);
  const [departmentName, setDepartmentName] = useState<string | null>(null);

  const { stats, loading: statsLoading } = useDashboardStats(user ?? undefined);
  const atAGlanceTitle = getAtAGlanceTitle(user?.role);
  const quickActionGroups = getQuickActionGroups(user?.role);
  let quickActionIndex = 0;

  // Update clock every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(formatTime()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch unread notification count on mount
  useEffect(() => {
    apiClient.get('/notifications/unread-count')
      .then(({ data }) => setUnreadCount(data.count ?? 0))
      .catch(() => {});
  }, []);

  // Teachers: refresh effective classId (class teacher assignment may not be in JWT yet)
  useEffect(() => {
    if (user?.role !== UserRole.TEACHER) return;
    apiClient.get('/users/me').then(({ data }) => {
      if (data.classId && data.classId !== user?.classId) {
        updateUser({ classId: data.classId });
      }
    }).catch(() => {});
  }, [user?.role, user?.classId, updateUser]);

  // HOD: resolve department display name for scope label
  useEffect(() => {
    if (user?.role !== UserRole.HOD || !user?.departmentId) {
      setDepartmentName(null);
      return;
    }
    apiClient.get('/departments')
      .then(({ data }) => {
        const depts = Array.isArray(data) ? data : [];
        const match = depts.find((d: { id: string; name?: string }) => d.id === user.departmentId);
        setDepartmentName(match?.name ?? null);
      })
      .catch(() => setDepartmentName(null));
  }, [user?.role, user?.departmentId]);

  // Real-time: increment badge on new notification
  useEffect(() => {
    if (!accessToken) return;
    const socket = socketIo(import.meta.env.VITE_WS_URL || window.location.origin, {
      auth: { token: accessToken },
    });
    socket.on('notification:new', () => setUnreadCount((c: number) => c + 1));
    return () => { socket.disconnect(); };
  }, [accessToken]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const daysPresentStat = stats.find((s) => s.label === 'Days Present')?.value;

  return (
    <div className="page-shell relative overflow-hidden">
      {/* CSS Keyframes & Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>

      {/* Header */}
      <header className="app-header">
        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink tracking-tight">SAMS</h1>
              <p className="text-xs text-ink-muted font-medium">Smart Attendance Management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Date & Time */}
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-sm text-ink font-medium">{currentTime}</span>
              <span className="text-xs text-ink-muted">{formatDate()}</span>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="theme-toggle"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={theme === 'dark' ? ICONS.sun : ICONS.moon}
                />
              </svg>
            </button>

            {/* Notifications */}
            <Link
              to="/notifications"
              className="nav-icon-btn"
            >
              <svg className="w-4 h-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.bell} />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-0.5 bg-red-500 rounded-full border-2 border-white shadow-md flex items-center justify-center text-[9px] font-bold text-ink">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>

            {/* Profile */}
            <Link
              to="/profile"
              className={`nav-icon-btn ${
                location.pathname === '/profile' ? 'nav-icon-btn-active' : ''
              }`}
              title="Profile"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.profile} />
              </svg>
            </Link>

            {/* Settings */}
            <Link
              to="/settings"
              className={`nav-icon-btn ${
                location.pathname === '/settings' ? 'nav-icon-btn-active' : ''
              }`}
              title="Settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.settings} />
              </svg>
            </Link>

            {/* User avatar & logout */}
            <div className="flex items-center gap-3 ml-1">
              <Link to="/profile" title="Profile">
                <UserAvatar
                  avatarUrl={user?.avatarUrl}
                  fullName={user?.fullName}
                  cacheKey={user?.avatarVersion}
                />
              </Link>
              <button
                onClick={handleLogout}
                className="text-sm text-ink-muted hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-500/15 border border-transparent hover:border-red-200 transition-all duration-300"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>


      {/* Main Content */}
      <main className="relative max-w-7xl mx-auto px-6 lg:px-8 py-10">

        <ActiveSessionReminder role={user?.role} userId={user?.id} />

        {/* Welcome Banner */}
        <div className="relative mb-10 surface-card p-8 lg:p-10" style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}>
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
                <h2 className="text-3xl lg:text-4xl font-bold text-ink tracking-tight">
                  Welcome back, {user?.fullName?.split(' ')[0] || 'User'}
                </h2>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-brand bg-brand-light border border-brand/20 w-fit">
                  {getRoleLabel(user?.role)}
                </span>
                {user?.role === UserRole.HOD && departmentName && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium text-brand bg-brand-light border border-brand/15 w-fit">
                    {departmentName}
                  </span>
                )}
              </div>
              <p className="text-ink-muted text-base max-w-lg">
                {getRoleGreeting(user?.role)}
              </p>
              {user?.role === UserRole.TEACHER && !user?.classId && (
                <p className="mt-3 text-sm text-ink-muted max-w-lg">
                  Taught classes come from timetable and class-teacher assignments. If a class is missing, ask your HOD to update the timetable.
                </p>
              )}
              {(user?.role === UserRole.TEACHER || user?.role === UserRole.HOD) && (
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <Link
                    to="/admin/links"
                    className="inline-flex items-center justify-center gap-2 btn-primary py-3 px-5 text-sm w-full sm:w-auto"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.link} />
                    </svg>
                    Registration Links
                  </Link>
                  {user?.role === UserRole.TEACHER ? (
                    <Link
                      to="/class/students"
                      className="inline-flex items-center justify-center gap-2 btn-secondary py-3 px-5 text-sm w-full sm:w-auto"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.users} />
                      </svg>
                      My Students
                    </Link>
                  ) : (
                    <Link
                      to="/hod/department"
                      className="inline-flex items-center justify-center gap-2 btn-secondary py-3 px-5 text-sm w-full sm:w-auto"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.building} />
                      </svg>
                      Department
                    </Link>
                  )}
                </div>
              )}
              {user?.role === UserRole.STUDENT && (
                <Link
                  to="/sessions/scan"
                  className="mt-4 inline-flex items-center justify-center gap-2 btn-attendance py-3 px-6 text-sm w-full sm:w-auto"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.qr} />
                  </svg>
                  Scan QR Now
                </Link>
              )}
              {user?.role === UserRole.SCHOOL_ADMIN && (
                <Link
                  to="/admin/links"
                  className="mt-4 inline-flex items-center justify-center gap-2 btn-primary py-3 px-6 text-sm w-full sm:w-auto"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.link} />
                  </svg>
                  Registration Links
                </Link>
              )}
            </div>
            <div className="hidden lg:flex flex-col items-end">
              <div className="text-2xl font-bold text-ink tracking-tight">{currentTime}</div>
              <div className="text-sm text-ink-muted">{formatDate()}</div>
            </div>
          </div>
        </div>

        <AttendanceWorkflowPanel role={user?.role} />

        {/* Stats Section */}
        <section className="mb-10">
          <SectionHeader title="Overview" icon={ICONS.chart} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {statsLoading
              ? [1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)
              : stats.map((stat, i) => <AnimatedStatCard key={stat.label} stat={stat} index={i} />)
            }
          </div>
        </section>

        {/* Quick Actions — grouped by purpose, no duplicate routes */}
        <section className="mb-10">
          <SectionHeader title="Quick Actions" icon={ICONS.trending} />
          <div className="space-y-8">
            {quickActionGroups.map((group) => (
              <div key={group.title}>
                <h4 className="dash-group-label">{group.title}</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {group.actions.map((action) => {
                    const index = quickActionIndex++;
                    return (
                      <QuickActionButton key={`${group.title}-${action.to}-${action.label}`} action={action} index={index} />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom Grid: role-specific insights (timetable lives on /timetable) */}
        <section>
          <SectionHeader title={atAGlanceTitle} icon={ICONS.trending} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AtAGlancePanel
              role={user?.role}
              userId={user?.id}
              departmentId={user?.departmentId}
              classId={user?.classId}
            />

            {/* Right panel varies by role */}
            {user?.role === UserRole.SCHOOL_ADMIN && <SchoolAdminInsightsPanel />}

            {user?.role === UserRole.TEACHER && (
              <TeacherClassPanel
                classId={user?.classId}
                attendanceRate={
                  stats.find((s) => s.label === 'Attendance Rate')?.value?.toString()
                }
              />
            )}

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
                  <p className="dash-stat-value text-accent-orange text-4xl mb-2">{daysPresentStat ?? '—'}</p>
                  <p className="text-sm text-ink-muted">days present (term total)</p>
                </div>
                <Link
                  to="/reports"
                  className="block text-center text-sm text-brand hover:text-brand-hover"
                >
                  View full attendance history →
                </Link>
              </div>
            )}

            {user?.role === UserRole.HOD && (
              <HodDepartmentPanel stats={stats} departmentName={departmentName} />
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative border-t border-line mt-16 py-8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs text-ink-subtle">(c) 2025 SAMS - Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default DashboardPage;
