import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../hooks/useTheme';
import { useUnreadNotifications } from '../hooks/useUnreadNotifications';
import { useNotificationLive } from '../hooks/useNotificationLive';
import { UserAvatar } from './UserAvatar';
import AppSidebar from './AppSidebar';
import NewMessageToast from './NewMessageToast';


// ─── Icons ───────────────────────────────────────────────────────────────────

const ICONS = {
  // WhatsApp/Telegram-style chat bubble icon
  bell: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10zM8 10h.01M12 10h.01M16 10h.01',
  sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  moon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  menu: 'M4 6h16M4 12h16M4 18h16',
};

// ─── Page title mapping ──────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/timetable': 'Timetable',
  '/sessions': 'Sessions',
  '/attendance': 'Manual Attendance',
  '/fingerprint/attendance': 'Fingerprint Attendance',
  '/biometric/attendance': 'Face Attendance',
  '/biometric/enroll': 'Biometric Enrollment',
  '/sessions/scan': 'Scan QR',
  '/reports': 'Reports',
  '/risk-scores': 'Risk Scores',
  '/notifications': 'Notifications',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/ai': 'AI Assistant',
  '/class/students': 'Student Workbench',
  '/class-roster': 'Class Representatives',
  '/admin': 'Admin Dashboard',
  '/admin/users': 'User Management',
  '/admin/links': 'Registration Links',
  '/admin/timetable': 'Edit Timetable',
  '/admin/departments': 'Departments',
  '/admin/exams': 'Exam & Grade Management',
  '/admin/guardians': 'Guardian Management',
  '/admin/knowledge': 'Knowledge Base',
  '/hod/department': 'Department Management',
  '/parent': 'Parent Dashboard',
  '/attend': 'Attendance Link',
};

function getPageTitle(path: string): string {
  // Exact match first
  if (PAGE_TITLES[path]) return PAGE_TITLES[path];
  // Prefix match
  const match = Object.entries(PAGE_TITLES).find(([key]) => path.startsWith(key));
  return match ? match[1] : 'SAMS';
}

// ─── AppLayout Component ─────────────────────────────────────────────────────

const AppLayout: React.FC = () => {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const { theme, toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  const { unreadCount } = useUnreadNotifications();
  useNotificationLive();

  const pageTitle = getPageTitle(location.pathname);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handleViewport = () => {
      if (mq.matches) setSidebarCollapsed(true);
    };

    handleViewport();
    mq.addEventListener('change', handleViewport);
    return () => mq.removeEventListener('change', handleViewport);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setSidebarCollapsed(true);
    }
  }, [location.pathname]);

  return (
    <div className="app-layout">
      <AppSidebar
        collapsed={sidebarCollapsed}
      />
      {!sidebarCollapsed && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      <div className={`app-main ${sidebarCollapsed ? 'app-main-collapsed' : 'app-main-expanded'}`}>
        {/* Top bar */}
        <header className="app-topbar">
          <div className="topbar-left">
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              className="topbar-nav-toggle"
              aria-label={sidebarCollapsed ? 'Open navigation' : 'Minimize navigation'}
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? 'Open navigation' : 'Minimize navigation'}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.menu} />
              </svg>
            </button>
            <h1 className="topbar-title">{pageTitle}</h1>
          </div>

          <div className="topbar-right">
            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="topbar-btn"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={theme === 'dark' ? ICONS.sun : ICONS.moon} />
              </svg>
            </button>

            {/* Notifications */}
            <Link to="/notifications" className="topbar-btn" title="Notifications">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.bell} />
              </svg>
              {unreadCount > 0 && (
                <span className="topbar-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </Link>

            {/* Settings */}
            <Link
              to="/settings"
              className={`topbar-btn ${location.pathname === '/settings' ? 'topbar-btn-active' : ''}`}
              title="Settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.settings} />
              </svg>
            </Link>

            {/* Profile */}
            <Link to="/profile" title="Profile" className="topbar-avatar">
              <UserAvatar
                avatarUrl={user?.avatarUrl}
                fullName={user?.fullName}
                cacheKey={user?.avatarVersion}
              />
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="topbar-content">
          <Outlet />
        </main>
      </div>

      {/* WhatsApp/Telegram-style new message toast — shows on any page */}
      <NewMessageToast />
    </div>
  );
};

export default AppLayout;
