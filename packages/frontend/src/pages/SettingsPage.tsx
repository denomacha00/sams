import React, { useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';

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

  // WebAuthn fingerprint registration state
  const [fingerprintLoading, setFingerprintLoading] = useState(false);
  const [fingerprintRegistered, setFingerprintRegistered] = useState(false);
  const webauthnAvailable = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const isStaff = user?.role === 'TEACHER' || user?.role === 'SCHOOL_ADMIN' || user?.role === 'HOD';

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
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
    setError(null);
    setSuccess(null);
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

  /**
   * WebAuthn fingerprint registration flow:
   * 1. Get registration options from server
   * 2. Browser prompts for fingerprint
   * 3. Send attestation to server for storage
   */
  const handleFingerprintRegister = useCallback(async () => {
    if (!webauthnAvailable) return;
    setFingerprintLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Step 1: Get registration options
      const { data: options } = await apiClient.post('/auth/webauthn/register/options', {});

      // Convert base64 challenge to ArrayBuffer
      const challenge = Uint8Array.from(atob(options.challenge), (c) => c.charCodeAt(0));

      // Convert user.id from base64
      const userId = Uint8Array.from(atob(options.user.id), (c) => c.charCodeAt(0));

      // Convert excludeCredentials IDs from base64
      const excludeCredentials = (options.excludeCredentials || []).map((cred: any) => ({
        ...cred,
        id: Uint8Array.from(atob(cred.id), (c) => c.charCodeAt(0)),
      }));

      // Step 2: Create credential (triggers fingerprint prompt)
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: options.rp,
          user: {
            ...options.user,
            id: userId,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
          excludeCredentials,
          attestation: 'none',
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        setError('Fingerprint registration was cancelled.');
        setFingerprintLoading(false);
        return;
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Convert ArrayBuffers to base64 for transport
      const toBase64 = (buffer: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(buffer)));

      // Step 3: Send to server for verification and storage
      await apiClient.post('/auth/webauthn/register/verify', {
        credentialId: credential.id,
        publicKey: toBase64(response.getPublicKey?.() || response.attestationObject),
        clientDataJSON: toBase64(response.clientDataJSON),
        transports: (response as any).getTransports?.() || ['internal'],
      });

      setFingerprintRegistered(true);
      setSuccess('Fingerprint registered successfully! You can now sign in with your fingerprint.');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Fingerprint registration was denied or timed out.');
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Fingerprint registration failed. Please try again.');
      }
    } finally {
      setFingerprintLoading(false);
    }
  }, [webauthnAvailable]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your profile and preferences</p>
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

        {/* Profile card */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          {/* Avatar section */}
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-white/10">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-purple-500/20">
              {user?.fullName?.charAt(0) || 'U'}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{user?.fullName}</h2>
              <p className="text-sm text-gray-400 capitalize">{user?.role?.toLowerCase().replace('_', ' ')}</p>
            </div>
          </div>

          {/* Profile form */}
          <form onSubmit={handleProfileUpdate} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                placeholder="Your full name"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                placeholder="+254 7XX XXX XXX"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
            >
              {saving ? 'Saving...' : 'Update Profile'}
            </button>
          </form>
        </div>

        {/* Change password section */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Change Password</h3>

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label htmlFor="currentPassword" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                placeholder="Enter current password"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                placeholder="Minimum 8 characters"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                placeholder="Confirm new password"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-white/10 border border-white/20 text-white font-semibold py-3 px-4 rounded-xl hover:bg-white/20 disabled:opacity-50 transition-all duration-200"
            >
              {saving ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Fingerprint Registration — Staff only */}
        {isStaff && webauthnAvailable && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mt-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 border border-teal-500/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Fingerprint Sign-In</h3>
                <p className="text-xs text-gray-400">Register your fingerprint for quick passwordless login</p>
              </div>
            </div>

            {fingerprintRegistered ? (
              <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-400/20 rounded-xl">
                <svg className="w-5 h-5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-sm text-emerald-300">Fingerprint registered. You can sign in using your fingerprint on the login page.</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-400 mb-4">
                  Once registered, you can sign in to SAMS using your device's fingerprint sensor instead of typing your password.
                </p>
                <button
                  onClick={handleFingerprintRegister}
                  disabled={fingerprintLoading}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-teal-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {fingerprintLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      Touch your fingerprint sensor...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                      </svg>
                      Register Fingerprint
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default SettingsPage;
