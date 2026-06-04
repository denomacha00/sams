import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';
import { getApiErrorMessage } from '../lib/apiError';
import { UserRole } from '@sams/shared';
import { UserAvatar } from '../components/UserAvatar';

const ProfilePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);
  const [username, setUsername] = useState(user?.username || '');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop modal state
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [cropScale, setCropScale] = useState(1);
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

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
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to update profile'));
    } finally {
      setSaving(false);
    }
  };

  // Profile picture - open crop modal
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }
    clearMessages();
    const url = URL.createObjectURL(file);
    setCropImage(url);
    setCropScale(1);
    setCropPosition({ x: 0, y: 0 });
  };

  // Handle crop drag
  const handleCropMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - cropPosition.x, y: e.clientY - cropPosition.y };
  };

  const handleCropMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setCropPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleCropMouseUp = () => { isDragging.current = false; };

  // Touch support for mobile
  const handleCropTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    const touch = e.touches[0];
    dragStart.current = { x: touch.clientX - cropPosition.x, y: touch.clientY - cropPosition.y };
  };

  const handleCropTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const touch = e.touches[0];
    setCropPosition({
      x: touch.clientX - dragStart.current.x,
      y: touch.clientY - dragStart.current.y,
    });
  };

  const handleCropTouchEnd = () => { isDragging.current = false; };

  // Crop and upload
  const handleCropConfirm = async () => {
    if (!cropImage || !cropImgRef.current) return;
    setUploadingAvatar(true);
    clearMessages();

    try {
      // Draw cropped image to canvas
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d')!;
      const img = cropImgRef.current;

      const size = 200 / cropScale;
      const centerX = (img.naturalWidth / 2) - (cropPosition.x / cropScale);
      const centerY = (img.naturalHeight / 2) - (cropPosition.y / cropScale);

      ctx.drawImage(
        img,
        centerX - size / 2, centerY - size / 2, size, size,
        0, 0, 400, 400
      );

      // Convert to blob
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9)
      );

      const formData = new FormData();
      formData.append('avatar', blob, 'avatar.jpg');
      const { data } = await apiClient.post('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      useAuthStore.getState().updateUser({
        avatarUrl: data.avatarUrl,
        avatarVersion: Date.now(),
      });
      setCropImage(null);
      setSuccess('Profile picture updated!');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setError(
        status === 413
          ? 'Photo is too large for the server. Try a smaller image or ask your admin to confirm nginx allows 25MB uploads.'
          : getApiErrorMessage(err, 'Failed to upload profile picture'),
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="page-shell p-6">
      {/* Crop Modal */}
      {cropImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-ink mb-4 text-center">Resize & Position</h3>

            {/* Crop area */}
            <div
              className="relative w-48 h-48 mx-auto rounded-full overflow-hidden border-2 border-purple-500/50 cursor-move select-none"
              onMouseDown={handleCropMouseDown}
              onMouseMove={handleCropMouseMove}
              onMouseUp={handleCropMouseUp}
              onMouseLeave={handleCropMouseUp}
              onTouchStart={handleCropTouchStart}
              onTouchMove={handleCropTouchMove}
              onTouchEnd={handleCropTouchEnd}
            >
              <img
                ref={cropImgRef}
                src={cropImage}
                alt="Crop preview"
                className="absolute pointer-events-none"
                style={{
                  transform: `translate(${cropPosition.x}px, ${cropPosition.y}px) scale(${cropScale})`,
                  transformOrigin: 'center',
                  maxWidth: 'none',
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                draggable={false}
              />
            </div>

            {/* Zoom slider */}
            <div className="mt-4">
              <label className="block text-xs text-ink-muted mb-2 text-center">Zoom</label>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={cropScale}
                onChange={(e) => setCropScale(parseFloat(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>

            <p className="text-xs text-ink-subtle text-center mt-2">Drag to reposition, slide to zoom</p>

            {/* Actions */}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setCropImage(null); setCropScale(1); setCropPosition({ x: 0, y: 0 }); }}
                className="flex-1 btn-secondary py-2.5 rounded-xl hover:bg-white/20 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCropConfirm}
                disabled={uploadingAvatar}
                className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-2.5 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all"
              >
                {uploadingAvatar ? 'Uploading...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Profile</h1>
          <p className="text-ink-muted text-sm mt-1">Manage your personal information and account details</p>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-emerald-800 text-center">{success}</p>
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-800 text-center">{error}</p>
          </div>
        )}

        {/* Profile Card with Avatar */}
        <div className="surface-card rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-5 mb-6 pb-6 border-b border-white/10">
            {/* Avatar */}
            <div className="relative group">
              <div className="shadow-lg shadow-purple-500/20 overflow-hidden">
                <UserAvatar
                  avatarUrl={user?.avatarUrl}
                  fullName={user?.fullName}
                  cacheKey={user?.avatarVersion}
                  className="w-20 h-20 rounded-2xl text-3xl"
                />
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
              <h2 className="text-lg font-semibold text-ink">{user?.fullName}</h2>
              <p className="text-sm text-teal-400 font-medium">{getRoleLabel()}</p>
              <p className="text-xs text-ink-subtle mt-0.5">Click the camera icon to change your photo</p>
            </div>
          </div>

          {/* Profile form */}
          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label htmlFor="username" className="form-label">Username</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="Your username" />
            </div>
            <div>
              <label htmlFor="fullName" className="form-label">
                Full Name {isStudent && <span className="text-ink-subtle normal-case">(contact admin to change)</span>}
              </label>
              <input id="fullName" type="text" value={fullName} onChange={(e) => canEditName && setFullName(e.target.value)}
                readOnly={!canEditName}
                className={`w-full border rounded-xl px-4 py-3 placeholder-ink-subtle focus:outline-none transition-all ${
                  canEditName
                    ? 'bg-white/5 border-white/10 text-white focus:ring-2 focus:ring-purple-500/50'
                    : 'bg-white/[0.02] border-white/5 text-ink-muted cursor-not-allowed'
                }`} placeholder="Your full name" />
            </div>
            <div>
              <label htmlFor="email" className="form-label">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="your@email.com" />
            </div>
            <div>
              <label htmlFor="phone" className="form-label">Phone Number</label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="+254 7XX XXX XXX" />
            </div>
            <button type="submit" disabled={saving}
              className="w-full btn-primary font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all">
              {saving ? 'Saving...' : 'Update Profile'}
            </button>
          </form>
        </div>

        {/* Account Info */}
        <div className="surface-card rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-ink">Account Information</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-ink-muted">Role</span>
              <span className="text-sm text-ink font-medium">{getRoleLabel()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-ink-muted">School</span>
              <span className="text-sm text-ink font-medium">{user?.schoolId ? 'Connected' : '—'}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-ink-muted">Account Status</span>
              <span className="text-sm text-emerald-400 font-medium">Active</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-ink-muted">App Version</span>
              <span className="text-sm text-ink-subtle">v1.0.0</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-ink-subtle mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ProfilePage;
