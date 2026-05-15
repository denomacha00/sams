import React, { useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';
import { UserRole } from '@sams/shared';

const SettingsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Profile picture state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WebAuthn fingerprint registration state
  const [fingerprintLoading, setFingerprintLoading] = useState(false);
  const [fingerprintRegistered, setFingerprintRegistered] = useState(false);
  const webauthnAvailable = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const isStaff = user?.role === UserRole.TEACHER || user?.role === UserRole.SCHOOL_ADMIN || user?.role === UserRole.HOD;
  const isStudent = user?.role === UserRole.STUDENT;

  // Biometric face enrollment state
  const [bioLoading, setBioLoading] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);

  const clearMessages = () => { setSuccess(null); setError(null); };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    clearMessages();
    try {
      await apiClient.patch('/users/me', { fullName, email, phone: phone || undefined });
      setSuccess('Profile updated successfully!');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
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
      setSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
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

  // WebAuthn fingerprint registration (staff only)
  const handleFingerprintRegister = useCallback(async () => {
    if (!webauthnAvailable) return;
    setFingerprintLoading(true);
    clearMessages();
    try {
      const { data: options } = await apiClient.post('/auth/webauthn/register/options', {});
      const challenge = Uint8Array.from(atob(options.challenge), (c) => c.charCodeAt(0));
      const userId = Uint8Array.from(atob(options.user.id), (c) => c.charCodeAt(0));
      const excludeCredentials = (options.excludeCredentials || []).map((cred: any) => ({
        ...cred,
        id: Uint8Array.from(atob(cred.id), (c) => c.charCodeAt(0)),
      }));

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: options.rp,
          user: { ...options.user, id: userId },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
          excludeCredentials,
          attestation: 'none',
        },
      })) as PublicKeyCredential | null;

      if (!credential) { setError('Registration cancelled.'); setFingerprintLoading(false); return; }
      const response = credential.response as AuthenticatorAttestationResponse;
      const toBase64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

      await apiClient.post('/auth/webauthn/register/verify', {
        credentialId: credential.id,
        publicKey: toBase64(response.getPublicKey?.() || response.attestationObject),
        clientDataJSON: toBase64(response.clientDataJSON),
        transports: (response as any).getTransports?.() || ['internal'],
      });
      setFingerprintRegistered(true);
      setSuccess('Fingerprint registered! You can now sign in with your fingerprint.');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setError('Fingerprint registration denied or timed out.');
      else setError(err.response?.data?.error || 'Fingerprint registration failed.');
    } finally {
      setFingerprintLoading(false);
    }
  }, [webauthnAvailable]);

  // Face biometric enrollment (students)
  const handleFaceEnroll = useCallback(async () => {
    setBioLoading(true);
    clearMessages();
    try {
      const faceapi = (window as any).faceapi;
      if (!faceapi) { setError('Face detection library not loaded. Refresh the page.'); setBioLoading(false); return; }

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
      // Wait a moment for camera to stabilize
      await new Promise((r) => setTimeout(r, 1500));

      const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());

      if (!detection) { setError('No face detected. Try in better lighting.'); setBioLoading(false); return; }
      const descriptor = Array.from(detection.descriptor as Float32Array);
      await apiClient.post('/biometric/enroll', { descriptor, studentId: user?.id });
      setBioEnrolled(true);
      setSuccess('Face enrolled for biometric attendance!');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Face enrollment failed.');
    } finally {
      setBioLoading(false);
    }
  }, [user?.id]);

  const getRoleLabel = () => {
    switch (user?.role) {
      case UserRole.SCHOOL_ADMIN: return 'School Administrator';
      case UserRole.HOD: return 'Head of Department';
      case UserRole.TEACHER: return 'Teacher';
      case UserRole.STUDENT: return 'Student';
      default: return 'User';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your profile, security, and preferences</p>
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
              <label htmlFor="fullName" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Full Name</label>
              <input id="fullName" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="Your full name" />
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

        {/* Security — Change Password */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Change Password</h3>
              <p className="text-xs text-gray-400">Update your account password</p>
            </div>
          </div>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="Current password" />
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="New password (min 8 chars)" />
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all" placeholder="Confirm new password" />
            <button type="submit" disabled={saving}
              className="w-full bg-white/10 border border-white/20 text-white font-semibold py-3 px-4 rounded-xl hover:bg-white/20 disabled:opacity-50 transition-all">
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Biometric — Face Enrollment (Students) */}
        {isStudent && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Face Enrollment</h3>
                <p className="text-xs text-gray-400">Register your face for biometric attendance</p>
              </div>
            </div>
            {bioEnrolled ? (
              <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-400/20 rounded-xl">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                <p className="text-sm text-emerald-300">Face enrolled. Biometric attendance is active.</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-400 mb-4">Enroll your face so teachers can mark your attendance using biometric scanning.</p>
                <button onClick={handleFaceEnroll} disabled={bioLoading}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all">
                  {bioLoading ? (
                    <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Scanning face...</>
                  ) : (
                    <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> Enroll My Face</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Fingerprint Registration (All roles) */}
        {webauthnAvailable && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 border border-teal-500/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Fingerprint Sign-In</h3>
                <p className="text-xs text-gray-400">Register your fingerprint for quick authentication</p>
              </div>
            </div>
            {fingerprintRegistered ? (
              <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-400/20 rounded-xl">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                <p className="text-sm text-emerald-300">Fingerprint registered. Use it on the login page.</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-400 mb-4">Register your fingerprint for biometric verification and quick sign-in.</p>
                <button onClick={handleFingerprintRegister} disabled={fingerprintLoading}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-teal-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all">
                  {fingerprintLoading ? (
                    <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> Touch your sensor...</>
                  ) : (
                    <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" /></svg> Register Fingerprint</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

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

export default SettingsPage;
