import React from 'react';
import { useAuthStore } from '../store/authStore';

const SettingsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Profile</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-500">Name</label>
              <p className="text-gray-900">{user?.fullName}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Email</label>
              <p className="text-gray-900">{user?.email || '—'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Role</label>
              <p className="text-gray-900 capitalize">{user?.role?.toLowerCase().replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
