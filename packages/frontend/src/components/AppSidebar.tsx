import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserRole } from '@sams/shared';
import { useAuthStore } from '../store/authStore';

interface SidebarItem {
  label: string;
  path: string;
  icon: string;
  roles?: UserRole[];
  children?: SidebarItem[];
}

// ─── SVG icon paths (material design style, compact) ─────────────────────────

const ICONS: Record<string, string> = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1',
  attendance: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  session: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  timetable: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  reports: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  exams: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  guardians: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  departments: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  risk: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z',
  // WhatsApp/Telegram-style chat bubble
  notifications: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  knowledge: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  parent: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1',
  links: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  ai: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456L18 9.75z',
  menu: 'M4 6h16M4 12h16M4 18h16',
};

// ─── Navigation config ───────────────────────────────────────────────────────

const COMMON_ITEMS: SidebarItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
  { label: 'Timetable', path: '/timetable', icon: 'timetable' },
  { label: 'Reports', path: '/reports', icon: 'reports' },
  { label: 'AI Assistant', path: '/ai', icon: 'ai' },
  { label: 'Notifications', path: '/notifications', icon: 'notifications' },
  { label: 'Profile', path: '/profile', icon: 'profile' },
  { label: 'Settings', path: '/settings', icon: 'settings' },
];

const TEACHER_ITEMS: SidebarItem[] = [
  { label: 'Sessions', path: '/sessions', icon: 'session' },
  { label: 'Attendance', path: '/attendance', icon: 'attendance' },
  { label: 'Fingerprint', path: '/fingerprint/attendance', icon: 'attendance' },
  { label: 'Face Attendance', path: '/biometric/attendance', icon: 'attendance' },
  { label: 'Registration Links', path: '/admin/links', icon: 'links' },
  { label: 'My Students', path: '/class/students', icon: 'users' },
  { label: 'Enter Marks', path: '/admin/exams', icon: 'exams' },
  { label: 'Risk Scores', path: '/risk-scores', icon: 'risk' },
  { label: 'Knowledge Base', path: '/admin/knowledge', icon: 'knowledge' },
];

const HOD_ITEMS: SidebarItem[] = [
  { label: 'Sessions', path: '/sessions', icon: 'session' },
  { label: 'Attendance', path: '/attendance', icon: 'attendance' },
  { label: 'Registration Links', path: '/admin/links', icon: 'links' },
  { label: 'Dept. Management', path: '/hod/department', icon: 'departments' },
  { label: 'Manage Users', path: '/admin/users', icon: 'users' },
  { label: 'Dept. Students', path: '/class/students', icon: 'users' },
  { label: 'Teacher Subjects', path: '/admin/teacher-subjects', icon: 'knowledge' },
  { label: 'Edit Timetable', path: '/admin/timetable', icon: 'timetable' },
  { label: 'Exams & Grades', path: '/admin/exams', icon: 'exams' },
  { label: 'Risk Scores', path: '/risk-scores', icon: 'risk' },
  { label: 'Knowledge Base', path: '/admin/knowledge', icon: 'knowledge' },
];

const ADMIN_ITEMS: SidebarItem[] = [
  { label: 'Registration Links', path: '/admin/links', icon: 'links' },
  { label: 'User Management', path: '/admin/users', icon: 'users' },
  { label: 'Guardian Mgmt', path: '/admin/guardians', icon: 'guardians' },
  { label: 'Departments', path: '/admin/departments', icon: 'departments' },
  { label: 'Student Workbench', path: '/class/students', icon: 'users' },
  { label: 'Edit Timetable', path: '/admin/timetable', icon: 'timetable' },
  { label: 'Exams & Grades', path: '/admin/exams', icon: 'exams' },
  { label: 'Risk Scores', path: '/risk-scores', icon: 'risk' },
  { label: 'Knowledge Base', path: '/admin/knowledge', icon: 'knowledge' },
];

const STUDENT_ITEMS: SidebarItem[] = [
  { label: 'Scan QR', path: '/sessions/scan', icon: 'session' },
  { label: 'Fingerprint Enroll', path: '/biometric/enroll', icon: 'attendance' },
];

function getSidebarItems(role?: UserRole): SidebarItem[] {
  const items: SidebarItem[] = role === UserRole.GUARDIAN
    ? [
        { label: 'Parent Dashboard', path: '/parent', icon: 'parent' },
        { label: 'AI Assistant', path: '/ai', icon: 'ai' },
        { label: 'Notifications', path: '/notifications', icon: 'notifications' },
        { label: 'Profile', path: '/profile', icon: 'profile' },
        { label: 'Settings', path: '/settings', icon: 'settings' },
      ]
    : [...COMMON_ITEMS];

  if (role === UserRole.SCHOOL_ADMIN) items.push(...ADMIN_ITEMS);
  else if (role === UserRole.HOD) items.push(...HOD_ITEMS);
  else if (role === UserRole.TEACHER) items.push(...TEACHER_ITEMS);
  else if (role === UserRole.STUDENT) items.push(...STUDENT_ITEMS);

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

// ─── Sidebar Item Component ──────────────────────────────────────────────────

const SidebarItemRow: React.FC<{
  item: SidebarItem;
  collapsed: boolean;
  active: boolean;
}> = ({ item, collapsed, active }) => {
  const iconPath = ICONS[item.icon] || ICONS.dashboard;

  return (
    <div
      className={`sidebar-item ${active ? 'sidebar-item-active' : ''}`}
      title={collapsed ? item.label : undefined}
    >
      <Link to={item.path} className="sidebar-link">
        <span className="sidebar-icon-wrapper">
          <svg className="sidebar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
          </svg>
        </span>
        {!collapsed && <span className="sidebar-label">{item.label}</span>}
      </Link>
    </div>
  );
};

// ─── Sidebar Section ─────────────────────────────────────────────────────────

const SidebarSection: React.FC<{
  title: string;
  items: SidebarItem[];
  collapsed: boolean;
  activePath: string;
}> = ({ title, items, collapsed, activePath }) => {
  if (items.length === 0) return null;

  return (
    <div className="sidebar-section">
      {!collapsed && <div className="sidebar-section-title">{title}</div>}
      {items.map((item) => (
        <SidebarItemRow
          key={item.path}
          item={item}
          collapsed={collapsed}
          active={activePath === item.path || activePath.startsWith(item.path + '/')}
        />
      ))}
    </div>
  );
};

// ─── Group items by category ──────────────────────────────────────────────────

interface CategoryGroup {
  title: string;
  items: SidebarItem[];
}

function groupItems(items: SidebarItem[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];

  // Separate common items first
  const common = items.filter((i) =>
    ['dashboard', 'timetable', 'reports'].includes(i.icon)
  );
  const other = items.filter((i) => !['dashboard', 'timetable', 'reports'].includes(i.icon));

  if (common.length > 0) groups.push({ title: 'Main', items: common });

  // Attendance & Sessions
  const attendanceItems = other.filter((i) =>
    ['session', 'attendance', 'links'].includes(i.icon)
  );
  if (attendanceItems.length > 0) groups.push({ title: 'Attendance', items: attendanceItems });

  // Management
  const mgmtItems = other.filter((i) =>
    ['users', 'guardians', 'departments'].includes(i.icon)
  );
  if (mgmtItems.length > 0) groups.push({ title: 'Management', items: mgmtItems });

  // Academics
  const academicItems = other.filter((i) =>
    ['exams', 'risk', 'knowledge'].includes(i.icon)
  );
  if (academicItems.length > 0) groups.push({ title: 'Academics', items: academicItems });

  // Account items
  const accountItems = other.filter((i) =>
    ['profile', 'notifications', 'settings'].includes(i.icon)
  );
  if (accountItems.length > 0) groups.push({ title: 'Account', items: accountItems });

  return groups;
}

// ─── Main Sidebar Component ──────────────────────────────────────────────────

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const items = getSidebarItems(user?.role);
  const groups = groupItems(items);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className={`app-sidebar ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}>
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <Link to="/dashboard" className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          {!collapsed && <span className="sidebar-logo-text">SAMS</span>}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="sidebar-header-toggle"
            aria-label="Minimize navigation"
            title="Minimize navigation"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.1}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.menu} />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation items */}
      <nav className="sidebar-nav">
        {groups.map((group) => (
          <SidebarSection
            key={group.title}
            title={group.title}
            items={group.items}
            collapsed={collapsed}
            activePath={location.pathname}
          />
        ))}

        <div className="sidebar-section sidebar-session-section">
          {!collapsed && <div className="sidebar-section-title">Session</div>}
          <div className="sidebar-item" title="Sign Out">
            <button
              type="button"
              onClick={handleLogout}
              className="sidebar-link sidebar-logout-button"
            >
              <span className="sidebar-icon-wrapper">
                <svg className="sidebar-icon text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.logout} />
                </svg>
              </span>
              {!collapsed && <span className="sidebar-label text-red-400">Sign Out</span>}
            </button>
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default AppSidebar;
