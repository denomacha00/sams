import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';
import { useAuthStore } from '../store/authStore';

interface SystemStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  environment: string;
  checks: { database: boolean; redis: boolean };
  email: { configured: boolean };
  otp: { loginEnabled: boolean; passwordResetEnabled: boolean };
}

const SettingsPage: React.FC = () => {
  const { user } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { data } = await apiClient.get('/super/system-status');
        setSystemStatus(data);
        setStatusError(null);
      } catch (err) {
        setStatusError(getSuperAdminApiError(err, 'Failed to load platform status.'));
      } finally {
        setStatusLoading(false);
      }
    };
    void fetchStatus();
  }, []);

  const clearMessages = () => {
    setSuccess(null);
    setError(null);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    clearMessages();
    try {
      await apiClient.post('/users/me/password', { currentPassword, newPassword });
      setSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setError(getSuperAdminApiError(err, 'Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  const StatusBadge: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
      <span className="text-gray-300 text-sm">{label}</span>
      <span
        className={`px-2 py-0.5 text-xs rounded ${
          ok ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
        }`}
      >
        {ok ? 'OK' : 'Down'}
      </span>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Super Admin account and platform health. Per-school SMS (Africa&apos;s Talking) is configured in the
          school app by each School Admin.
        </p>
      </div>

      <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg px-4 py-3 text-sm text-blue-100">
        <p>
          <span className="font-semibold text-blue-200">School notifications:</span> SMS tests, Africa&apos;s Talking
          status, and SMTP checks for a school belong under <span className="font-mono">School App → Settings</span>{' '}
          (School Admin role). They are not managed here.
        </p>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Name</span>
            <span className="text-white text-right">{user?.fullName ?? 'Super Admin'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Email</span>
            <span className="text-white text-right break-all">{user?.email ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Role</span>
            <span className="text-purple-300">SUPER_ADMIN</span>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Change password</h2>
        {success && (
          <div className="mb-4 bg-green-900/50 border border-green-600 text-green-200 px-4 py-3 rounded text-sm">
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Current password"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="New password (min 8 characters)"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Confirm new password"
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {saving ? 'Changing...' : 'Change password'}
          </button>
        </form>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-1">Platform status</h2>
        <p className="text-xs text-gray-500 mb-4">Infrastructure and auth features — read-only</p>
        {statusLoading ? (
          <p className="text-gray-400 text-sm">Loading status...</p>
        ) : statusError ? (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded text-sm">
            {statusError}
          </div>
        ) : systemStatus ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`px-3 py-1 text-sm font-medium rounded ${
                  systemStatus.status === 'ok'
                    ? 'bg-green-900/50 text-green-300'
                    : 'bg-indigo-900/50 text-indigo-300'
                }`}
              >
                {systemStatus.status === 'ok' ? 'All systems operational' : 'Degraded'}
              </span>
              <span className="text-gray-500 text-xs">
                {new Date(systemStatus.timestamp).toLocaleString()}
              </span>
            </div>

            <div>
              <StatusBadge ok={systemStatus.checks.database} label="Database" />
              <StatusBadge ok={systemStatus.checks.redis} label="Redis" />
            </div>

            <div className="pt-2 border-t border-gray-700 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Environment</span>
                <span className="text-gray-300 font-mono">{systemStatus.environment}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Platform email (SMTP)</span>
                <span className="text-gray-300">
                  {systemStatus.email.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">OTP login</span>
                <span className="text-gray-300">
                  {systemStatus.otp.loginEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">OTP password reset</span>
                <span className="text-gray-300">
                  {systemStatus.otp.passwordResetEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SettingsPage;
