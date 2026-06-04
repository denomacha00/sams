import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { io as socketIo } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../services/apiClient';
import { UserAvatar } from '../components/UserAvatar';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatCard {
  label: string;
  value: string | number;
  icon: string;
  gradient: string;
  shadowColor: string;
}

interface QuickAction {
  to: string;
  label: string;
  icon: string;
  gradient: string;
  /** Primary attendance CTAs use emerald styling */
  variant?: 'attendance' | 'alert' | 'default';
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
    case UserRole.SCHOOL_ADMIN: return 'Your school is running smoothly. Here\'s your command center.';
    case UserRole.HOD: return 'Your department is performing well. Monitor and manage from here.';
    case UserRole.TEACHER: return 'Ready to inspire today? Here\'s your teaching overview.';
    case UserRole.STUDENT: return 'Stay on track with your attendance and schedule.';
    default: return 'Welcome to your personalized dashboard.';
  }
}

// ─── Section Header Component ────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; icon: string; gradient: string }> = ({ title, icon, gradient }) => (
  <div className="mb-6">
    <div className="flex items-center gap-3 mb-3">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-ink tracking-tight">{title}</h3>
    </div>
    <div className="h-px bg-line" />
  </div>
);

// ─── Skeleton Loader ─────────────────────────────────────────────────────────

const SkeletonCard: React.FC = () => (
  <div className="animate-pulse rounded-2xl border border-line bg-slate-100 p-6 min-h-[140px]">
    <div className="w-12 h-12 rounded-xl bg-slate-200 mb-4" />
    <div className="h-4 w-20 bg-slate-200 rounded mb-2" />
    <div className="h-8 w-16 bg-slate-200 rounded" />
  </div>
);

// ─── Stat Card Component ─────────────────────────────────────────────────────

const AnimatedStatCard: React.FC<{ stat: StatCard; index: number }> = ({ stat, index }) => (
  <div
    className="group stat-card"
    style={{
      animationDelay: `${index * 100}ms`,
      animation: 'fadeInUp 0.5s ease-out forwards',
      opacity: 0,
    }}
  >
    <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-[0.04] group-hover:opacity-[0.07] transition-opacity duration-300 rounded-2xl`} />
    <div className="relative z-10">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg ${stat.shadowColor} mb-4 group-hover:shadow-xl transition-shadow duration-500`}>
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={stat.icon} />
        </svg>
      </div>
      <p className="text-sm text-ink-muted mb-1 font-medium">{stat.label}</p>
      <p className="text-2xl font-bold text-ink tracking-tight">{stat.value}</p>
    </div>
  </div>
);

// ─── Quick Action Button ─────────────────────────────────────────────────────

const QuickActionButton: React.FC<{ action: QuickAction; index: number }> = ({ action, index }) => {
  const topBarClass =
    action.variant === 'attendance'
      ? 'from-emerald-500 to-teal-500'
      : action.variant === 'alert'
        ? 'from-amber-500 to-orange-500'
        : action.gradient;
  const iconBgClass =
    action.variant === 'attendance'
      ? 'from-emerald-600 to-teal-600'
      : action.variant === 'alert'
        ? 'from-amber-500 to-orange-500'
        : action.gradient;

  return (
  <Link
    to={action.to}
    className="group quick-action-card"
    style={{ animationDelay: `${(index + 4) * 80}ms`, animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
  >
    <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${topBarClass} opacity-40 group-hover:opacity-70 transition-opacity duration-300`} />
    <div>
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${iconBgClass} flex items-center justify-center shadow-md mb-3 group-hover:shadow-lg transition-shadow duration-500`}>
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={action.icon} />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-ink group-hover:text-brand transition-colors">{action.label}</h3>
    </div>
    <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
      <svg className="w-4 h-4 text-ink-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
      </svg>
    </div>
  </Link>
  );
};


// ─── Role-specific "At a glance" (replaces duplicate timetable on dashboard) ─

function getAtAGlanceTitle(role?: UserRole): string {
  switch (role) {
    case UserRole.STUDENT:
      return 'Attendance Today';
    case UserRole.TEACHER:
      return 'Live Sessions';
    case UserRole.HOD:
      return 'Department Priorities';
    case UserRole.SCHOOL_ADMIN:
      return 'School Activity';
    default:
      return 'At a Glance';
  }
}

const panelShellClass = 'surface-panel';
const panelAnimStyle = { animation: 'fadeInUp 0.5s ease-out 0.6s forwards', opacity: 0 };

const AtAGlancePanel: React.FC<{ role?: UserRole; userId?: string }> = ({ role, userId }) => {
  const [loading, setLoading] = useState(true);
  const [studentPresent, setStudentPresent] = useState(0);
  const [activeSessions, setActiveSessions] = useState<Array<{ id: string; subject?: string; className?: string }>>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (role === UserRole.STUDENT) {
          const { data } = await apiClient.get('/attendance');
          if (!cancelled) {
            const today = new Date().toDateString();
            const todayRecords = (Array.isArray(data) ? data : []).filter(
              (r: { createdAt?: string; status?: string }) =>
                r.createdAt &&
                new Date(r.createdAt).toDateString() === today &&
                (r.status === 'PRESENT' || r.status === 'LATE'),
            );
            setStudentPresent(todayRecords.length);
          }
        } else if (role === UserRole.TEACHER && userId) {
          const { data } = await apiClient.get('/sessions', {
            params: { teacherId: userId, isActive: true },
          });
          if (!cancelled) {
            const list = (Array.isArray(data) ? data : []).slice(0, 4).map((s: Record<string, unknown>) => ({
              id: s.id as string,
              subject: (s.subject as string) ?? 'Session',
              className: (s.className as string) ?? undefined,
            }));
            setActiveSessions(list);
          }
        } else if (role === UserRole.HOD || role === UserRole.SCHOOL_ADMIN) {
          const { data } = await apiClient.get('/notifications/unread-count');
          if (!cancelled) setUnreadCount(data.count ?? 0);
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
  }, [role, userId]);

  const title = getAtAGlanceTitle(role);

  return (
    <div className={panelShellClass} style={panelAnimStyle}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-slate-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={role === UserRole.STUDENT ? ICONS.qr : role === UserRole.TEACHER ? ICONS.session : ICONS.bell}
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-12 rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : role === UserRole.STUDENT ? (
        <div className="space-y-4">
          <div className="text-center py-4">
            <p className="text-4xl font-bold text-emerald-600">{studentPresent}</p>
            <p className="text-sm text-ink-muted mt-1">classes marked present today</p>
          </div>
          <Link
            to="/reports"
            className="block text-center text-sm text-brand hover:text-brand-hover transition-colors py-2"
          >
            View my attendance reports →
          </Link>
          <Link
            to="/timetable"
            className="block text-center text-sm text-ink-muted hover:text-ink-muted transition-colors"
          >
            Open full timetable →
          </Link>
        </div>
      ) : role === UserRole.TEACHER ? (
        <div className="space-y-3">
          {activeSessions.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-ink-muted text-sm mb-1">No active sessions</p>
              <p className="text-xs text-ink-subtle">Use Sign In Students above to start a session and show the QR code.</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Active now</p>
              {activeSessions.map((s) => (
                <Link
                  key={s.id}
                  to="/sessions"
                  className="surface-muted-row hover:border-emerald-300"
                >
                  <div>
                    <p className="text-sm text-ink font-medium">{s.subject}</p>
                    {s.className && <p className="text-xs text-ink-subtle">{s.className}</p>}
                  </div>
                  <span className="text-xs font-semibold text-emerald-600">Live</span>
                </Link>
              ))}
              <Link to="/sessions" className="block text-center text-sm text-brand hover:text-brand-hover pt-1">
                Manage session & QR →
              </Link>
            </>
          )}
        </div>
      ) : role === UserRole.HOD ? (
        <div className="space-y-3">
          <div className="surface-muted-row">
            <span className="text-sm text-ink-muted">Unread notifications</span>
            <span className={`text-sm font-semibold ${unreadCount > 0 ? 'text-amber-600' : 'text-brand'}`}>
              {unreadCount}
            </span>
          </div>
          <p className="text-xs text-ink-subtle px-1">
            Use Quick Actions below for department tools, timetable, and reports.
          </p>
          {unreadCount > 0 && (
            <Link
              to="/notifications"
              className="btn-secondary w-full py-2.5 text-sm text-center block"
            >
              Read notifications →
            </Link>
          )}
        </div>
      ) : role === UserRole.SCHOOL_ADMIN ? (
        <div className="space-y-3">
          <div className="surface-muted-row">
            <span className="text-sm text-ink-muted">Unread notifications</span>
            <span className={`text-sm font-semibold ${unreadCount > 0 ? 'text-amber-600' : 'text-brand'}`}>
              {unreadCount}
            </span>
          </div>
          <p className="text-xs text-ink-subtle px-1">
            Manage users, departments, and registration links from Quick Actions.
          </p>
          {unreadCount > 0 && (
            <Link
              to="/notifications"
              className="btn-secondary w-full py-2.5 text-sm text-center block"
            >
              Read notifications →
            </Link>
          )}
        </div>
      ) : (
        <p className="text-ink-subtle text-sm text-center py-8">Welcome to SAMS</p>
      )}
    </div>
  );
};

// ─── Activity Feed Component ─────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  message: string;
  createdAt: string;
  type: string;
}

const ActivityFeed: React.FC = () => {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/notifications/sent')
      .then(({ data }) => {
        if (!cancelled) {
          const list: ActivityItem[] = (Array.isArray(data) ? data : []).slice(0, 5).map((n: any) => ({
            id: n.id,
            message: n.message ?? n.title ?? 'Notification sent',
            createdAt: n.createdAt,
            type: n.type ?? 'MESSAGE',
          }));
          setItems(list);
        }
      })
      .catch(() => {
        // Silently fail — activity feed is non-critical
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const typeColor: Record<string, string> = {
    MESSAGE: 'bg-blue-500',
    NOTIFICATION_UPDATED: 'bg-purple-500',
    SYSTEM: 'bg-gray-500',
  };

  const formatRelative = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  return (
    <div className="surface-panel" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
      <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-slate-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.trending} />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-ink">Recent Activity</h3>
      </div>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-xl bg-slate-100">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200 shrink-0" />
              <div className="flex-1 h-3 bg-slate-200 rounded" />
              <div className="w-16 h-3 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-ink-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={ICONS.bell} />
            </svg>
          </div>
          <p className="text-ink-subtle text-sm">No recent activity</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-line transition-all duration-300">
              <div className={`w-2.5 h-2.5 rounded-full ${typeColor[item.type] ?? 'bg-gray-500'} shadow-sm shrink-0`} />
              <p className="text-sm text-ink-muted flex-1 truncate">{item.message}</p>
              <span className="text-xs text-ink-subtle font-medium shrink-0">{formatRelative(item.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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
            { to: '/admin/users', label: 'Manage Users', icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700' },
            { to: '/admin/departments', label: 'Departments', icon: ICONS.building, gradient: 'from-green-500 to-emerald-500' },
            { to: '/admin/links', label: 'Registration Links', icon: ICONS.link, gradient: 'from-slate-600 to-indigo-600' },
            { to: '/class-roster', label: 'Class Reps', icon: ICONS.users, gradient: 'from-amber-500 to-orange-500' },
          ],
        },
        {
          title: 'Reports & Schedule',
          actions: [
            { to: '/reports', label: 'View Reports', icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700' },
            { to: '/timetable', label: 'View Timetable', icon: ICONS.calendar, gradient: 'from-orange-500 to-amber-500' },
            { to: '/admin/knowledge', label: 'Knowledge Base', icon: ICONS.book, gradient: 'from-amber-500 to-yellow-500' },
          ],
        },
        {
          title: 'Communication',
          actions: [
            { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500', variant: 'alert' },
            { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-indigo-600 to-slate-700' },
          ],
        },
      ];
    case UserRole.TEACHER:
      return [
        {
          title: 'Attendance',
          actions: [
            { to: '/sessions', label: 'Sign In Students', icon: ICONS.qr, gradient: 'from-emerald-600 to-teal-600', variant: 'attendance' },
            { to: '/attendance', label: 'Mark Attendance', icon: ICONS.clipboard, gradient: 'from-emerald-500 to-teal-500', variant: 'attendance' },
            { to: '/biometric/attendance', label: 'Face Scan', icon: ICONS.check, gradient: 'from-emerald-600 to-teal-600', variant: 'attendance' },
          ],
        },
        {
          title: 'My Class',
          actions: [
            { to: '/class/students', label: 'My Students', icon: ICONS.users, gradient: 'from-slate-600 to-indigo-600' },
            { to: '/class-roster', label: 'Assign Class Rep', icon: ICONS.users, gradient: 'from-amber-500 to-orange-500' },
          ],
        },
        {
          title: 'Schedule & Reports',
          actions: [
            { to: '/timetable', label: 'My Timetable', icon: ICONS.calendar, gradient: 'from-orange-500 to-amber-500' },
            { to: '/reports', label: 'View Reports', icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700' },
            { to: '/admin/links', label: 'Registration Links', icon: ICONS.link, gradient: 'from-emerald-500 to-teal-500' },
            { to: '/admin/knowledge', label: 'Knowledge Base', icon: ICONS.book, gradient: 'from-amber-500 to-yellow-500' },
          ],
        },
        {
          title: 'Communication',
          actions: [
            { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-slate-600 to-indigo-700', variant: 'alert' },
            { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-indigo-600 to-slate-700' },
          ],
        },
      ];
    case UserRole.STUDENT:
      return [
        {
          title: 'Today',
          actions: [
            { to: '/sessions/scan', label: 'Scan QR', icon: ICONS.qr, gradient: 'from-emerald-500 to-teal-500', variant: 'attendance' },
            { to: '/timetable', label: 'View Timetable', icon: ICONS.calendar, gradient: 'from-blue-500 to-indigo-500' },
          ],
        },
        {
          title: 'Stay Informed',
          actions: [
            { to: '/notifications', label: 'Messages', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500', variant: 'alert' },
            { to: '/reports', label: 'My Reports', icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700' },
            { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-indigo-600 to-slate-700' },
          ],
        },
        {
          title: 'Account',
          actions: [
            { to: '/profile', label: 'Profile', icon: ICONS.profile, gradient: 'from-slate-600 to-indigo-600' },
          ],
        },
      ];
    case UserRole.HOD:
      return [
        {
          title: 'Attendance',
          actions: [
            { to: '/sessions', label: 'Sign In Students', icon: ICONS.qr, gradient: 'from-emerald-600 to-teal-600', variant: 'attendance' },
            { to: '/attendance', label: 'Mark Attendance', icon: ICONS.clipboard, gradient: 'from-emerald-500 to-teal-500', variant: 'attendance' },
            { to: '/biometric/attendance', label: 'Face Scan', icon: ICONS.check, gradient: 'from-emerald-600 to-teal-600', variant: 'attendance' },
          ],
        },
        {
          title: 'Department',
          actions: [
            { to: '/hod/department', label: 'Department Management', icon: ICONS.building, gradient: 'from-indigo-500 to-blue-500' },
            { to: '/admin/users', label: 'Manage Users', icon: ICONS.users, gradient: 'from-blue-500 to-indigo-500' },
            { to: '/class-roster', label: 'Class Reps', icon: ICONS.users, gradient: 'from-amber-500 to-orange-500' },
            { to: '/admin/links', label: 'Registration Links', icon: ICONS.link, gradient: 'from-emerald-500 to-teal-500' },
          ],
        },
        {
          title: 'Schedule & Insights',
          actions: [
            { to: '/timetable', label: 'View Timetable', icon: ICONS.calendar, gradient: 'from-orange-500 to-amber-500' },
            { to: '/admin/timetable', label: 'Edit Timetable', icon: ICONS.calendar, gradient: 'from-orange-500 to-amber-500' },
            { to: '/reports', label: 'View Reports', icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700' },
            { to: '/risk-scores', label: 'Risk Scores', icon: ICONS.warning, gradient: 'from-orange-500 to-red-500', variant: 'alert' },
            { to: '/admin/knowledge', label: 'Knowledge Base', icon: ICONS.book, gradient: 'from-amber-500 to-yellow-500' },
          ],
        },
        {
          title: 'Communication',
          actions: [
            { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500', variant: 'alert' },
            { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-indigo-600 to-slate-700' },
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
        { label: 'Total Students', value: '—', icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: 'Total Teachers', value: '—', icon: ICONS.academic, gradient: 'from-slate-600 to-indigo-600', shadowColor: 'shadow-slate-600/20' },
        { label: 'Active Sessions', value: '—', icon: ICONS.session, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, gradient: 'from-slate-600 to-slate-700', shadowColor: 'shadow-slate-600/20' },
      ];
    case UserRole.TEACHER:
      return [
        { label: 'My Students', value: '—', icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: "Today's Sessions", value: '—', icon: ICONS.session, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
      ];
    case UserRole.STUDENT:
      return [
        { label: 'My Attendance %', value: '—', icon: ICONS.check, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: 'Classes Today', value: '—', icon: ICONS.calendar, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Risk Score', value: '—', icon: ICONS.warning, gradient: 'from-amber-500 to-orange-500', shadowColor: 'shadow-amber-500/20' },
        { label: 'Days Present', value: '—', icon: ICONS.fire, gradient: 'from-slate-600 to-slate-700', shadowColor: 'shadow-slate-600/20' },
      ];
    case UserRole.HOD:
      return [
        { label: 'Dept. Students', value: '—', icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: 'Dept. Teachers', value: '—', icon: ICONS.academic, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
        { label: 'At-Risk Students', value: '—', icon: ICONS.warning, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
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
                { label: 'Total Students', value: totalStudents, icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: 'Total Teachers', value: totalTeachers, icon: ICONS.academic, gradient: 'from-slate-600 to-indigo-600', shadowColor: 'shadow-slate-600/20' },
                { label: 'Active Sessions', value: activeSessions, icon: ICONS.session, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, gradient: 'from-slate-600 to-slate-700', shadowColor: 'shadow-slate-600/20' },
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
                { label: 'My Students', value: myStudents, icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: "Today's Sessions", value: todaySessions, icon: ICONS.session, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
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
                { label: 'My Attendance %', value: attendancePct, icon: ICONS.check, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: 'Classes Today', value: classesToday, icon: ICONS.calendar, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Risk Score', value: riskScore, icon: ICONS.warning, gradient: 'from-amber-500 to-orange-500', shadowColor: 'shadow-amber-500/20' },
                { label: 'Days Present', value: daysPresent, icon: ICONS.fire, gradient: 'from-slate-600 to-slate-700', shadowColor: 'shadow-slate-600/20' },
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
                { label: 'Dept. Students', value: deptStudents, icon: ICONS.users, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: 'Dept. Teachers', value: deptTeachers, icon: ICONS.academic, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, gradient: 'from-indigo-600 to-slate-700', shadowColor: 'shadow-indigo-500/20' },
                { label: 'At-Risk Students', value: atRisk, icon: ICONS.warning, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
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
}

const TeacherClassPanel: React.FC<{ classId?: string; attendanceRate?: string }> = ({
  classId,
  attendanceRate,
}) => {
  const [students, setStudents] = useState<TeacherStudentPreview[]>([]);
  const [className, setClassName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (!classId) {
          if (!cancelled) {
            setStudents([]);
            setClassName(null);
          }
          return;
        }

        const [rosterRes, classesRes] = await Promise.allSettled([
          apiClient.get('/users/class-roster'),
          apiClient.get('/classes'),
        ]);

        if (!cancelled && rosterRes.status === 'fulfilled') {
          setStudents(Array.isArray(rosterRes.value.data) ? rosterRes.value.data : []);
        }
        if (!cancelled && classesRes.status === 'fulfilled') {
          const classes = Array.isArray(classesRes.value.data) ? classesRes.value.data : [];
          const match = classes.find((c: { id: string; name?: string }) => c.id === classId);
          setClassName(match?.name ?? null);
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
  }, [classId]);

  if (!classId) {
    return (
      <div
        className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 min-h-[280px]"
        style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}
      >
        <h3 className="text-lg font-semibold text-amber-800 mb-2">No class assigned</h3>
        <p className="text-sm text-amber-700 mb-4">
          You must be assigned as class teacher before you can see students. Ask your HOD or school admin to assign your class in user management.
        </p>
        <Link to="/profile" className="text-sm text-brand hover:text-brand-hover">
          View profile →
        </Link>
      </div>
    );
  }

  const preview = students.slice(0, 5);

  return (
    <div
      className="surface-panel"
      style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}
    >
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-500/20">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.academic} />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-ink">My Class</h3>
            {className && <p className="text-xs text-ink-muted">{className}</p>}
          </div>
        </div>
        <span className="text-sm font-semibold text-teal-400">
          {loading ? '…' : `${students.length} student${students.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Link to="/class/students" className="btn-primary text-xs py-2 px-4">
          My Students
        </Link>
        <Link
          to="/class-roster"
          className="text-xs py-2 px-4 rounded-xl border border-line text-ink-muted hover:bg-slate-50 transition-colors"
        >
          Class Roster
        </Link>
      </div>

      <div className="surface-muted-row mb-4">
        <span className="text-sm text-ink-muted">Class attendance rate</span>
        <span className="text-sm font-semibold text-blue-400">{attendanceRate ?? '—'}</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-10 rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : preview.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-4">No students in this class yet.</p>
      ) : (
        <ul className="space-y-2">
          {preview.map((s) => (
            <li
              key={s.id}
              className="surface-muted-row"
            >
              <span className="text-sm text-ink">{s.fullName}</span>
              {s.isClassRep && (
                <span className="text-xs text-brand font-medium">Class rep</span>
              )}
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
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.building} />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-ink">Department Overview</h3>
          {departmentName && (
            <p className="text-xs text-brand/90">{departmentName}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">Students</span>
          <span className="text-sm font-semibold text-teal-400">{deptStudents}</span>
        </div>
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">Teachers</span>
          <span className="text-sm font-semibold text-blue-400">{deptTeachers}</span>
        </div>
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">Avg. Attendance</span>
          <span className="text-sm font-semibold text-emerald-400">{attendanceRate}</span>
        </div>
        <div className="surface-muted-row">
          <span className="text-sm text-ink-muted">High Risk Students</span>
          <span className="text-sm font-semibold text-amber-400">{atRisk}</span>
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
                className="text-sm text-ink-muted hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-200 transition-all duration-300"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>


      {/* Main Content */}
      <main className="relative max-w-7xl mx-auto px-6 lg:px-8 py-10">

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
                <p className="mt-3 text-sm text-amber-700 max-w-lg">
                  No class is assigned to your account yet — student lists and class stats stay empty until an admin assigns you as class teacher.
                </p>
              )}
              {(user?.role === UserRole.TEACHER || user?.role === UserRole.HOD) && (
                <Link
                  to="/sessions"
                  className="mt-4 inline-flex items-center justify-center gap-2 btn-attendance py-3 px-6 text-sm w-full sm:w-auto"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.qr} />
                  </svg>
                  Sign In Students
                </Link>
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
            </div>
            <div className="hidden lg:flex flex-col items-end">
              <div className="text-2xl font-bold text-ink tracking-tight">{currentTime}</div>
              <div className="text-sm text-ink-muted">{formatDate()}</div>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <section className="mb-10">
          <SectionHeader title="Overview" icon={ICONS.chart} gradient="from-indigo-600 to-slate-700" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {statsLoading
              ? [1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)
              : stats.map((stat, i) => <AnimatedStatCard key={stat.label} stat={stat} index={i} />)
            }
          </div>
        </section>

        {/* Quick Actions — grouped by purpose, no duplicate routes */}
        <section className="mb-10">
          <SectionHeader title="Quick Actions" icon={ICONS.trending} gradient="from-slate-600 to-indigo-600" />
          <div className="space-y-8">
            {quickActionGroups.map((group) => (
              <div key={group.title}>
                <h4 className="text-sm font-medium text-ink-muted mb-3 uppercase tracking-wide">{group.title}</h4>
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
          <SectionHeader title={atAGlanceTitle} icon={ICONS.trending} gradient="from-indigo-600 to-slate-700" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AtAGlancePanel role={user?.role} userId={user?.id} />

            {/* Right panel varies by role */}
            {user?.role === UserRole.SCHOOL_ADMIN && <ActivityFeed />}

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
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.fire} />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-ink">Attendance Streak</h3>
                </div>
                <div className="text-center py-6">
                  <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-300 mb-2">
                    {daysPresentStat ?? '—'}
                  </div>
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
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default DashboardPage;
