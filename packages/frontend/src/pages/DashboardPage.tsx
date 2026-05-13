import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

const DashboardPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const getQuickLinks = () => {
    switch (user?.role) {
      case UserRole.SCHOOL_ADMIN:
        return [
          { to: '/reports', label: 'Reports', icon: '📊' },
          { to: '/risk-scores', label: 'Risk Scores', icon: '⚠️' },
          { to: '/settings', label: 'Settings', icon: '⚙️' },
          { to: '/ai', label: 'AI Assistant', icon: '🤖' },
        ];
      case UserRole.HOD:
        return [
          { to: '/reports', label: 'Department Reports', icon: '📊' },
          { to: '/risk-scores', label: 'Risk Scores', icon: '⚠️' },
          { to: '/ai', label: 'AI Assistant', icon: '🤖' },
        ];
      case UserRole.TEACHER:
        return [
          { to: '/sessions', label: 'Start Session', icon: '📋' },
          { to: '/attendance', label: 'Manual Attendance', icon: '✏️' },
          { to: '/biometric/attendance', label: 'Biometric', icon: '👤' },
          { to: '/reports', label: 'Reports', icon: '📊' },
          { to: '/ai', label: 'AI Assistant', icon: '🤖' },
        ];
      case UserRole.STUDENT:
        return [
          { to: '/sessions/scan', label: 'Scan QR', icon: '📱' },
          { to: '/biometric/enroll', label: 'Enroll Face', icon: '👤' },
          { to: '/reports', label: 'My Reports', icon: '📊' },
          { to: '/ai', label: 'AI Assistant', icon: '🤖' },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome, {user?.fullName}
            </h1>
            <p className="text-gray-600 capitalize">{user?.role?.toLowerCase().replace('_', ' ')}</p>
          </div>
          <button
            onClick={logout}
            className="text-sm text-gray-600 hover:text-red-600 px-3 py-1 rounded-md hover:bg-red-50"
          >
            Sign Out
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {getQuickLinks().map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="bg-white rounded-lg shadow-md p-6 text-center hover:shadow-lg transition-shadow"
            >
              <span className="text-3xl">{link.icon}</span>
              <p className="mt-2 font-medium text-gray-900">{link.label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
