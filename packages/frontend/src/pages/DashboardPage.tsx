import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../services/apiClient';

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
}

interface TimetableEntry {
  id: string;
  subject: string;
  startTime: string;
  endTime: string;
  room?: string;
  className?: string;
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


// ─── Skeleton Loader ─────────────────────────────────────────────────────────

const SkeletonCard: React.FC = () => (
  <div className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-6">
    <div className="w-12 h-12 rounded-xl bg-white/10 mb-4" />
    <div className="h-4 w-20 bg-white/10 rounded mb-2" />
    <div className="h-8 w-16 bg-white/10 rounded" />
  </div>
);

// ─── Stat Card Component ─────────────────────────────────────────────────────

const AnimatedStatCard: React.FC<{ stat: StatCard; index: number }> = ({ stat, index }) => (
  <div
    className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10 hover:border-white/20 transition-all duration-300 hover:scale-[1.02] group"
    style={{ animationDelay: `${index * 100}ms`, animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
  >
    <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-5 group-hover:opacity-10 transition-opacity duration-300`} />
    <div className="relative z-10">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg ${stat.shadowColor} mb-4`}>
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={stat.icon} />
        </svg>
      </div>
      <p className="text-sm text-gray-400 mb-1">{stat.label}</p>
      <p className="text-2xl font-bold text-white">{stat.value}</p>
    </div>
  </div>
);

// ─── Quick Action Button ─────────────────────────────────────────────────────

const QuickActionButton: React.FC<{ action: QuickAction; index: number }> = ({ action, index }) => (
  <Link
    to={action.to}
    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 hover:bg-white/10 hover:border-white/20 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-black/20"
    style={{ animationDelay: `${(index + 4) * 80}ms`, animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
  >
    <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${action.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${action.gradient} flex items-center justify-center shadow-md mb-3`}>
      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={action.icon} />
      </svg>
    </div>
    <h3 className="text-sm font-medium text-white group-hover:text-white/90">{action.label}</h3>
    <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
      </svg>
    </div>
  </Link>
);

// ─── Today's Schedule Component ──────────────────────────────────────────────

const TodaySchedule: React.FC<{ entries: TimetableEntry[]; loading: boolean }> = ({ entries, loading }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6" style={{ animation: 'fadeInUp 0.5s ease-out 0.6s forwards', opacity: 0 }}>
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.calendar} />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-white">Today's Schedule</h3>
    </div>
    {loading ? (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse flex items-center gap-4 p-3 rounded-xl bg-white/5">
            <div className="w-16 h-8 bg-white/10 rounded" />
            <div className="flex-1 h-4 bg-white/10 rounded" />
          </div>
        ))}
      </div>
    ) : entries.length === 0 ? (
      <p className="text-gray-500 text-sm text-center py-6">No classes scheduled for today</p>
    ) : (
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
            <div className="text-xs font-mono text-teal-400 w-20 shrink-0">
              {entry.startTime} - {entry.endTime}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">{entry.subject}</p>
              {entry.room && <p className="text-xs text-gray-500">{entry.room}</p>}
              {entry.className && <p className="text-xs text-gray-500">{entry.className}</p>}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// ─── Activity Feed Component ─────────────────────────────────────────────────

const ActivityFeed: React.FC = () => (
  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.trending} />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-white">Recent Activity</h3>
    </div>
    <div className="space-y-3">
      {[
        { text: 'New student registered', time: '2 min ago', color: 'bg-green-500' },
        { text: 'Attendance session completed', time: '15 min ago', color: 'bg-blue-500' },
        { text: 'Report generated', time: '1 hour ago', color: 'bg-purple-500' },
        { text: 'Timetable updated', time: '3 hours ago', color: 'bg-orange-500' },
      ].map((item, i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <div className={`w-2 h-2 rounded-full ${item.color}`} />
          <p className="text-sm text-gray-300 flex-1">{item.text}</p>
          <span className="text-xs text-gray-500">{item.time}</span>
        </div>
      ))}
    </div>
  </div>
);


// ─── Role-specific config ────────────────────────────────────────────────────

function getQuickActions(role?: UserRole): QuickAction[] {
  switch (role) {
    case UserRole.SCHOOL_ADMIN:
      return [
        { to: '/admin/users', label: 'Manage Users', icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500' },
        { to: '/admin/links', label: 'Generate Links', icon: ICONS.link, gradient: 'from-blue-500 to-indigo-500' },
        { to: '/reports', label: 'View Reports', icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500' },
        { to: '/admin/timetable', label: 'Timetable', icon: ICONS.calendar, gradient: 'from-orange-500 to-amber-500' },
        { to: '/admin/departments', label: 'Departments', icon: ICONS.building, gradient: 'from-green-500 to-emerald-500' },
        { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500' },
      ];
    case UserRole.TEACHER:
      return [
        { to: '/sessions', label: 'Start Session', icon: ICONS.session, gradient: 'from-teal-500 to-cyan-500' },
        { to: '/attendance', label: 'Mark Attendance', icon: ICONS.clipboard, gradient: 'from-blue-500 to-indigo-500' },
        { to: '/reports', label: 'View Reports', icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500' },
        { to: '/timetable', label: 'My Timetable', icon: ICONS.calendar, gradient: 'from-orange-500 to-amber-500' },
        { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-violet-500 to-purple-500' },
        { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500' },
      ];
    case UserRole.STUDENT:
      return [
        { to: '/sessions/scan', label: 'Scan QR', icon: ICONS.qr, gradient: 'from-teal-500 to-cyan-500' },
        { to: '/timetable', label: 'View Timetable', icon: ICONS.calendar, gradient: 'from-blue-500 to-indigo-500' },
        { to: '/reports', label: 'My Reports', icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500' },
        { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-violet-500 to-purple-500' },
        { to: '/settings', label: 'Settings', icon: ICONS.settings, gradient: 'from-gray-500 to-slate-500' },
        { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500' },
      ];
    case UserRole.HOD:
      return [
        { to: '/reports', label: 'View Reports', icon: ICONS.chart, gradient: 'from-teal-500 to-cyan-500' },
        { to: '/risk-scores', label: 'Risk Scores', icon: ICONS.warning, gradient: 'from-orange-500 to-red-500' },
        { to: '/admin/users', label: 'Manage Users', icon: ICONS.users, gradient: 'from-blue-500 to-indigo-500' },
        { to: '/admin/timetable', label: 'Timetable', icon: ICONS.calendar, gradient: 'from-purple-500 to-pink-500' },
        { to: '/notifications', label: 'Notifications', icon: ICONS.bell, gradient: 'from-rose-500 to-red-500' },
        { to: '/ai', label: 'AI Assistant', icon: ICONS.ai, gradient: 'from-violet-500 to-purple-500' },
      ];
    default:
      return [];
  }
}

function getDefaultStats(role?: UserRole): StatCard[] {
  switch (role) {
    case UserRole.SCHOOL_ADMIN:
      return [
        { label: 'Total Students', value: '—', icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
        { label: 'Total Teachers', value: '—', icon: ICONS.academic, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Active Sessions', value: '—', icon: ICONS.session, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
      ];
    case UserRole.TEACHER:
      return [
        { label: 'My Students', value: '—', icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
        { label: "Today's Sessions", value: '—', icon: ICONS.session, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
        { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
      ];
    case UserRole.STUDENT:
      return [
        { label: 'My Attendance %', value: '—', icon: ICONS.check, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
        { label: 'Classes Today', value: '—', icon: ICONS.calendar, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Risk Score', value: '—', icon: ICONS.warning, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
        { label: 'Days Present', value: '—', icon: ICONS.fire, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
      ];
    case UserRole.HOD:
      return [
        { label: 'Dept. Students', value: '—', icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
        { label: 'Dept. Teachers', value: '—', icon: ICONS.academic, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
        { label: 'Attendance Rate', value: '—', icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
        { label: 'At-Risk Students', value: '—', icon: ICONS.warning, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
      ];
    default:
      return [];
  }
}


// ─── Data Fetching Hooks ─────────────────────────────────────────────────────

function useDashboardStats(role?: UserRole): DashboardStats {
  const [stats, setStats] = useState<StatCard[]>(getDefaultStats(role));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        switch (role) {
          case UserRole.SCHOOL_ADMIN: {
            const [usersRes, sessionsRes, reportsRes] = await Promise.allSettled([
              apiClient.get('/users', { params: { limit: 1 } }),
              apiClient.get('/sessions', { params: { active: true } }),
              apiClient.get('/reports/school'),
            ]);

            const totalStudents = usersRes.status === 'fulfilled' ? (usersRes.value.data.meta?.totalStudents ?? usersRes.value.data.total ?? '—') : '—';
            const totalTeachers = usersRes.status === 'fulfilled' ? (usersRes.value.data.meta?.totalTeachers ?? '—') : '—';
            const activeSessions = sessionsRes.status === 'fulfilled' ? (sessionsRes.value.data.length ?? sessionsRes.value.data.total ?? 0) : '—';
            const attendanceRate = reportsRes.status === 'fulfilled' ? `${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%` : '—';

            if (!cancelled) {
              setStats([
                { label: 'Total Students', value: totalStudents, icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
                { label: 'Total Teachers', value: totalTeachers, icon: ICONS.academic, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Active Sessions', value: activeSessions, icon: ICONS.session, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
              ]);
            }
            break;
          }
          case UserRole.TEACHER: {
            const [studentsRes, sessionsRes, reportsRes] = await Promise.allSettled([
              apiClient.get('/users', { params: { role: 'STUDENT', limit: 1 } }),
              apiClient.get('/sessions', { params: { today: true } }),
              apiClient.get('/reports/class'),
            ]);

            const myStudents = studentsRes.status === 'fulfilled' ? (studentsRes.value.data.total ?? '—') : '—';
            const todaySessions = sessionsRes.status === 'fulfilled' ? (sessionsRes.value.data.length ?? 0) : '—';
            const attendanceRate = reportsRes.status === 'fulfilled' ? `${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%` : '—';

            if (!cancelled) {
              setStats([
                { label: 'My Students', value: myStudents, icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
                { label: "Today's Sessions", value: todaySessions, icon: ICONS.session, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
                { label: 'Pending Marks', value: '—', icon: ICONS.clipboard, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
              ]);
            }
            break;
          }
          case UserRole.STUDENT: {
            const [reportsRes, timetableRes, riskRes] = await Promise.allSettled([
              apiClient.get('/reports/student'),
              apiClient.get('/timetable', { params: { today: true } }),
              apiClient.get('/risk-scores/me'),
            ]);

            const attendancePct = reportsRes.status === 'fulfilled' ? `${Math.round(reportsRes.value.data.attendancePercentage ?? 0)}%` : '—';
            const classesToday = timetableRes.status === 'fulfilled' ? (timetableRes.value.data.length ?? 0) : '—';
            const riskScore = riskRes.status === 'fulfilled' ? (riskRes.value.data.riskLevel ?? '—') : '—';
            const daysPresent = reportsRes.status === 'fulfilled' ? (reportsRes.value.data.totalPresent ?? '—') : '—';

            if (!cancelled) {
              setStats([
                { label: 'My Attendance %', value: attendancePct, icon: ICONS.check, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
                { label: 'Classes Today', value: classesToday, icon: ICONS.calendar, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Risk Score', value: riskScore, icon: ICONS.warning, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
                { label: 'Days Present', value: daysPresent, icon: ICONS.fire, gradient: 'from-orange-500 to-amber-500', shadowColor: 'shadow-orange-500/20' },
              ]);
            }
            break;
          }
          case UserRole.HOD: {
            const [usersRes, reportsRes, riskRes] = await Promise.allSettled([
              apiClient.get('/users', { params: { limit: 1 } }),
              apiClient.get('/reports/department'),
              apiClient.get('/risk-scores', { params: { level: 'HIGH' } }),
            ]);

            const deptStudents = usersRes.status === 'fulfilled' ? (usersRes.value.data.meta?.totalStudents ?? '—') : '—';
            const deptTeachers = usersRes.status === 'fulfilled' ? (usersRes.value.data.meta?.totalTeachers ?? '—') : '—';
            const attendanceRate = reportsRes.status === 'fulfilled' ? `${Math.round(reportsRes.value.data.averageAttendancePercentage ?? 0)}%` : '—';
            const atRisk = riskRes.status === 'fulfilled' ? (riskRes.value.data.length ?? 0) : '—';

            if (!cancelled) {
              setStats([
                { label: 'Dept. Students', value: deptStudents, icon: ICONS.users, gradient: 'from-teal-500 to-cyan-500', shadowColor: 'shadow-teal-500/20' },
                { label: 'Dept. Teachers', value: deptTeachers, icon: ICONS.academic, gradient: 'from-blue-500 to-indigo-500', shadowColor: 'shadow-blue-500/20' },
                { label: 'Attendance Rate', value: attendanceRate, icon: ICONS.chart, gradient: 'from-purple-500 to-pink-500', shadowColor: 'shadow-purple-500/20' },
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
  }, [role]);

  return { stats, loading };
}

function useTodaySchedule(): { entries: TimetableEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSchedule() {
      try {
        const { data } = await apiClient.get('/timetable', { params: { today: true } });
        if (!cancelled) {
          const mapped: TimetableEntry[] = (Array.isArray(data) ? data : data.entries ?? []).map((e: Record<string, unknown>, i: number) => ({
            id: (e.id as string) ?? String(i),
            subject: (e.subject as string) ?? (e.courseName as string) ?? 'Unknown',
            startTime: (e.startTime as string) ?? '',
            endTime: (e.endTime as string) ?? '',
            room: (e.room as string) ?? (e.venue as string) ?? undefined,
            className: (e.className as string) ?? undefined,
          }));
          setEntries(mapped);
        }
      } catch {
        // No schedule available
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSchedule();
    return () => { cancelled = true; };
  }, []);

  return { entries, loading };
}


// ─── Main Dashboard Component ────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(formatTime());

  const { stats, loading: statsLoading } = useDashboardStats(user?.role);
  const { entries: schedule, loading: scheduleLoading } = useTodaySchedule();

  // Update clock every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(formatTime()), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const quickActions = getQuickActions(user?.role);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* CSS Keyframes */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-slate-900/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">SAMS</h1>
              <p className="text-xs text-gray-400">Smart Attendance Management</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Date & Time */}
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm text-gray-300">{currentTime}</span>
              <span className="text-xs text-gray-500">{formatDate()}</span>
            </div>

            {/* Notifications */}
            <Link
              to="/notifications"
              className="relative w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.bell} />
              </svg>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-slate-900" />
            </Link>

            {/* User avatar & logout */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-teal-500/20">
                {user?.fullName?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-400 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all duration-200"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome Section */}
        <div className="mb-8" style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
            <h2 className="text-3xl font-bold text-white">
              Welcome back, {user?.fullName?.split(' ')[0] || 'User'}
            </h2>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-500 shadow-lg shadow-teal-500/20 w-fit">
              {getRoleLabel(user?.role)}
            </span>
          </div>
          <p className="text-gray-400">
            {user?.role === UserRole.SCHOOL_ADMIN && 'Manage your school operations from this dashboard.'}
            {user?.role === UserRole.TEACHER && "Here's your teaching overview for today."}
            {user?.role === UserRole.STUDENT && "Track your attendance and stay on top of your schedule."}
            {user?.role === UserRole.HOD && 'Monitor your department performance at a glance.'}
          </p>
        </div>

        {/* Stats Grid */}
        <section className="mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {statsLoading
              ? [1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)
              : stats.map((stat, i) => <AnimatedStatCard key={stat.label} stat={stat} index={i} />)
            }
          </div>
        </section>

        {/* Quick Actions */}
        <section className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-4" style={{ animation: 'fadeInUp 0.5s ease-out 0.3s forwards', opacity: 0 }}>
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {quickActions.map((action, i) => (
              <QuickActionButton key={action.to} action={action} index={i} />
            ))}
          </div>
        </section>

        {/* Bottom Grid: Schedule + Activity/Info */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's Schedule - shown for all roles */}
          <TodaySchedule entries={schedule} loading={scheduleLoading} />

          {/* Right panel varies by role */}
          {user?.role === UserRole.SCHOOL_ADMIN && <ActivityFeed />}

          {user?.role === UserRole.TEACHER && (
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.academic} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Class Overview</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Sessions This Week</span>
                  <span className="text-sm font-semibold text-teal-400">—</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Average Attendance</span>
                  <span className="text-sm font-semibold text-blue-400">—</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Students At Risk</span>
                  <span className="text-sm font-semibold text-orange-400">—</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Completion Rate</span>
                  <span className="text-sm font-semibold text-purple-400">—</span>
                </div>
              </div>
            </div>
          )}

          {user?.role === UserRole.STUDENT && (
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.fire} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Attendance Streak</h3>
              </div>
              <div className="text-center py-6">
                <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-400 mb-2">
                  —
                </div>
                <p className="text-sm text-gray-400">consecutive days present</p>
              </div>
              <div className="grid grid-cols-7 gap-1 mt-4">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-full aspect-square rounded-sm ${i < 10 ? 'bg-teal-500/40' : 'bg-white/10'}`}
                    title={`Day ${i + 1}`}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3 text-center">Last 14 days</p>
            </div>
          )}

          {user?.role === UserRole.HOD && (
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6" style={{ animation: 'fadeInUp 0.5s ease-out 0.7s forwards', opacity: 0 }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.building} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Department Overview</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Total Classes</span>
                  <span className="text-sm font-semibold text-teal-400">—</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Avg. Attendance</span>
                  <span className="text-sm font-semibold text-blue-400">—</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">High Risk Students</span>
                  <span className="text-sm font-semibold text-red-400">—</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-sm text-gray-300">Active Sessions</span>
                  <span className="text-sm font-semibold text-purple-400">—</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-12 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-500">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default DashboardPage;
