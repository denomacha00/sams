import { UserRole } from '@sams/shared';
import type { MainStackParamList } from '../navigation/types';

export type NavRouteName = keyof MainStackParamList;

export interface NavItem {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  screen: NavRouteName;
}

export function navItemsForRole(role: string): NavItem[] {
  switch (role) {
    case UserRole.STUDENT:
      return [
        {
          id: 'scan-qr',
          title: 'Scan QR',
          subtitle: 'Mark attendance for active session',
          icon: 'qr-code-outline',
          screen: 'ScanQR',
        },
        {
          id: 'timetable',
          title: 'Timetable',
          subtitle: 'Your weekly class schedule',
          icon: 'calendar-outline',
          screen: 'Placeholder',
        },
        {
          id: 'notifications',
          title: 'Notifications',
          subtitle: 'Alerts from your school',
          icon: 'notifications-outline',
          screen: 'Placeholder',
        },
        {
          id: 'ai-assistant',
          title: 'AI Assistant',
          subtitle: 'Ask SAMS about attendance and classes',
          icon: 'sparkles-outline',
          screen: 'Placeholder',
        },
      ];
    case UserRole.TEACHER:
      return [
        {
          id: 'face-attendance',
          title: 'Face attendance',
          subtitle: 'Scan student faces on this device (after session started)',
          icon: 'scan-outline',
          screen: 'FaceScan',
        },
        {
          id: 'sign-in',
          title: 'Sign In Students',
          subtitle: 'Start session & manual marks (web for full flow)',
          icon: 'people-outline',
          screen: 'Placeholder',
        },
        {
          id: 'mark-attendance',
          title: 'Mark Attendance',
          subtitle: 'Sessions and QR codes (web)',
          icon: 'checkbox-outline',
          screen: 'Placeholder',
        },
        {
          id: 'notifications',
          title: 'Notifications',
          subtitle: 'School and class updates',
          icon: 'notifications-outline',
          screen: 'Placeholder',
        },
      ];
    case UserRole.HOD:
      return [
        {
          id: 'face-attendance',
          title: 'Face attendance',
          subtitle: 'Scan student faces on this device (after session started)',
          icon: 'scan-outline',
          screen: 'FaceScan',
        },
        {
          id: 'department',
          title: 'Department',
          subtitle: 'Staff and classes in your department',
          icon: 'business-outline',
          screen: 'Placeholder',
        },
        {
          id: 'timetable',
          title: 'Timetable',
          subtitle: 'Department schedule',
          icon: 'calendar-outline',
          screen: 'Placeholder',
        },
        {
          id: 'notifications',
          title: 'Notifications',
          subtitle: 'Department alerts',
          icon: 'notifications-outline',
          screen: 'Placeholder',
        },
        {
          id: 'reports',
          title: 'Reports',
          subtitle: 'Attendance summaries and exports',
          icon: 'bar-chart-outline',
          screen: 'Placeholder',
        },
      ];
    case UserRole.SCHOOL_ADMIN:
      return [
        {
          id: 'users',
          title: 'Users',
          subtitle: 'Students, teachers, and admins',
          icon: 'people-outline',
          screen: 'Placeholder',
        },
        {
          id: 'departments',
          title: 'Departments',
          subtitle: 'Organize school structure',
          icon: 'layers-outline',
          screen: 'Placeholder',
        },
        {
          id: 'notifications',
          title: 'Notifications',
          subtitle: 'Broadcast and system messages',
          icon: 'notifications-outline',
          screen: 'Placeholder',
        },
      ];
    case UserRole.SUPER_ADMIN:
      return [
        {
          id: 'portal',
          title: 'Super Admin Portal',
          subtitle: 'Use super.smart-managment.com on desktop',
          icon: 'globe-outline',
          screen: 'Placeholder',
        },
      ];
    default:
      return [
        {
          id: 'home',
          title: 'Dashboard',
          subtitle: 'Coming in a future release',
          icon: 'home-outline',
          screen: 'Placeholder',
        },
      ];
  }
}

export function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
