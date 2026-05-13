import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

const LoginPage: React.FC = () => {
  const [schoolCode, setSchoolCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const getRoleRedirect = (role: UserRole): string => {
    switch (role) {
      case UserRole.SCHOOL_ADMIN:
        return '/dashboard';
      case UserRole.HOD:
        return '/reports';
      case UserRole.TEACHER:
        return '/sessions';
      case UserRole.STUDENT:
        return '/sessions/scan';
      default:
        return '/dashboard';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(schoolCode, identifier, password);
      const user = useAuthStore.getState().user;
      if (user) {
        navigate(getRoleRedirect(user.role), { replace: true });
      }
    } catch {
      // error is set in store
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">SAMS</h1>
          <p className="text-gray-600 mt-1">Smart Attendance Management System</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="schoolCode" className="block text-sm font-medium text-gray-700">
              School Code
            </label>
            <input
              id="schoolCode"
              type="text"
              value={schoolCode}
              onChange={(e) => setSchoolCode(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g. KHS2024"
            />
          </div>

          <div>
            <label htmlFor="identifier" className="block text-sm font-medium text-gray-700">
              Email or Admission Number
            </label>
            <input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Enter email or admission number"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/activate" className="text-sm text-blue-600 hover:text-blue-500">
            Activate a new school
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
