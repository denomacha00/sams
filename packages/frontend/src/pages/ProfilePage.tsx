import React, { useState, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';
import { UserRole } from '@sams/shared';

const ProfilePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [username, setUsername] = useState(user?.username || '');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Profile picture state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearMessages = () => { setSuccess(null); setError(null); };

  const isStudent = user?.role === UserRole.STUDENT;
  const canEditName = !isStudent; // Only teachers/admins/HOD can edit their name

  const getRoleLabel = () => {
    switch (user?.role) {
      case UserRole.SCHOOL_ADMIN: return 'School Administrator';
      case UserRole.HOD: return 'Head of Department';
      case UserRole.TEACHER: return 'Teacher';
      case UserRole.STUDENT: return 'Student';
      default: return 'User';
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    clearMessages();
    try {
      const { data } = await apiClient.patch('/users/me', {
        username,
        ...(canEditName && { fullName }),
        email,
        phone: phone || undefined,
      });
      // Update the local auth store so changes persist across navigation
      useAuthStore.getState().updateUser({
        username: data.username,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
      });
      setSuccess('Profile updated successfully!');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  // Profile picture upload
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be less than 2MB');
      return;
    }
    setUploadingAvatar(true);
    clearMessages();
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const { data } = await apiClient.post('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAvatarUrl(data.avatarUrl || URL.createObjectURL(file));
      setSuccess('Profile picture updated!');
    } catch (err: any) {
      // If endpoint doesn't exist yet, show preview locally
      setAvatarUrl(URL.createObjectURL(file));
      setSuccess('Profile picture updated locally (server upload coming soon)');
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Profile</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your personal information and account details</p>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-emerald-200 text-center">{success}</p>
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        {/* Profile Card with Avatar */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-5 mb-6 pb-6 border-b border-white/10">
            {/* Avatar */}
            <div className="relative group">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-purple-500/20 overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  user?.fullName?.charAt(0) || 'U'
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-teal-500 border-2 border-slate-900 flex items-center justify-center hover:bg-teal-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{user?.fullName}</h2>
              <p className="text-sm text-teal-400 font-medium">{getRoleLabel()}</p>
              <p className="text-xs text-gray-500 mt-0.5">Click the camera icon to change your photo</p>
            </div>
          </div>

          {/* Profile form */}
          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Username</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="Your username" />
            </div>
            <div>
              <label htmlFor="fullName" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Full Name {isStudent && <span className="text-gray-500 normal-case">(contact admin to change)</span>}
              </label>
              <input id="fullName" type="text" value={fullName} onChange={(e) => canEditName && setFullName(e.target.value)}
                readOnly={!canEditName}
                className={`w-full border rounded-xl px-4 py-3 placeholder-gray-500 focus:outline-none transition-all ${
                  canEditName
                    ? 'bg-white/5 border-white/10 text-white focus:ring-2 focus:ring-purple-500/50'
                    : 'bg-white/[0.02] border-white/5 text-gray-400 cursor-not-allowed'
                }`} placeholder="Your full name" />
            </div>
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="your@email.com" />
            </div>
            <div>
              <label htmlFor="phone" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Phone Number</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="+254 7XX XXX XXX" />
            </div>
            <button type="submit" disabled={saving}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all">
              {saving ? 'Saving...' : 'Update Profile'}
            </button>
          </form>
        </div>

        {/* Account Info */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white">Account Information</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-gray-400">Role</span>
              <span className="text-sm text-white font-medium">{getRoleLabel()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-gray-400">School</span>
              <span className="text-sm text-white font-medium">{user?.schoolId ? 'Connected' : '—'}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-gray-400">Account Status</span>
              <span className="text-sm text-emerald-400 font-medium">Active</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-400">App Version</span>
              <span className="text-sm text-gray-500">v1.0.0</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ProfilePage;
