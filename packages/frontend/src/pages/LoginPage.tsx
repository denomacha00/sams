import React, { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';
import { UserRole } from '@sams/shared';

const LoginPage: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [webauthnLoading, setWebauthnLoading] = useState(false);
  const [webauthnError, setWebauthnError] = useState<string | null>(null);
  const { login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  // Check if WebAuthn is available in this browser
  const webauthnAvailable = typeof window !== 'undefined' && !!window.PublicKeyCredential;

  /**
   * WebAuthn fingerprint sign-in flow:
   * 1. Request challenge from server
   * 2. Browser prompts for biometric/fingerprint
   * 3. Send assertion to server for verification
   * 4. Server returns JWT on success
   */
  const handleWebAuthnLogin = useCallback(async () => {
    if (!webauthnAvailable) return;
    setWebauthnError(null);
    setWebauthnLoading(true);

    try {
      // Step 1: Get authentication options from server
      const { data: options } = await apiClient.post('/auth/webauthn/authenticate/options', {});

      // Convert base64 challenge to ArrayBuffer
      const challenge = Uint8Array.from(atob(options.challenge), (c) => c.charCodeAt(0));

      // Convert allowCredentials IDs from base64
      const allowCredentials = (options.allowCredentials || []).map((cred: any) => ({
        ...cred,
        id: Uint8Array.from(atob(cred.id), (c) => c.charCodeAt(0)),
      }));

      // Step 2: Request credential from browser (triggers fingerprint prompt)
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: options.rpId || window.location.hostname,
          allowCredentials,
          userVerification: 'preferred',
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!credential) {
        setWebauthnError('Authentication was cancelled.');
        setWebauthnLoading(false);
        return;
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      // Convert ArrayBuffers to base64 for transport
      const toBase64 = (buffer: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(buffer)));

      // Step 3: Send assertion to server for verification
      const { data: authResult } = await apiClient.post('/auth/webauthn/authenticate/verify', {
        credentialId: credential.id,
        authenticatorData: toBase64(response.authenticatorData),
        clientDataJSON: toBase64(response.clientDataJSON),
        signature: toBase64(response.signature),
      });

      // Step 4: Store tokens and redirect
      if (authResult.token) {
        useAuthStore.getState().setAuth(authResult.user, authResult.token, authResult.refreshToken);
        navigate(getRoleRedirect(authResult.user.role), { replace: true });
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setWebauthnError('Fingerprint authentication was denied or timed out.');
      } else if (err.response?.data?.error) {
        setWebauthnError(err.response.data.error);
      } else {
        setWebauthnError('Fingerprint sign-in failed. Please use password instead.');
      }
    } finally {
      setWebauthnLoading(false);
    }
  }, [webauthnAvailable, navigate]);

  const getRoleRedirect = (role: UserRole): string => {
    switch (role) {
      case UserRole.SCHOOL_ADMIN: return '/dashboard';
      case UserRole.HOD: return '/dashboard';
      case UserRole.TEACHER: return '/dashboard';
      case UserRole.STUDENT: return '/dashboard';
      default: return '/dashboard';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login('', identifier, password);
      const user = useAuthStore.getState().user;
      if (user) navigate(getRoleRedirect(user.role), { replace: true });
    } catch { /* error in store */ }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-slate-900 border-r border-slate-800 items-center justify-center">
        <div className="relative z-10 text-center px-12">
          <div className="inline-flex w-28 h-28 rounded-2xl bg-indigo-600 items-center justify-center border border-indigo-500/40 mb-8">
            <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold text-slate-50 tracking-tight mb-3">SAMS</h1>
          <p className="text-lg text-slate-300 font-medium tracking-wide">
            Smart Attendance Management System
          </p>
          <p className="text-sm text-slate-500 mt-4 max-w-sm mx-auto leading-relaxed">
            Multi-school platform with QR, GPS, and biometric attendance for Kenyan institutions.
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center bg-slate-950 px-6 py-12 relative">
        <div className="w-full max-w-md">
          {/* Mobile logo (shown on small screens) */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-indigo-600 border border-indigo-500/40 mb-4">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-3xl font-black text-white">SAMS</h1>
            <p className="text-sm text-gray-400">Smart Attendance Management System</p>
          </div>

          {/* Form card */}
          <div className="surface-card p-8">
            <h2 className="text-2xl font-bold text-white mb-1">Welcome back</h2>
            <p className="text-gray-400 text-sm mb-8">Sign in to your school account</p>

            {error && (
              <div className={`mb-6 p-3 rounded-xl ${
                error.toLowerCase().includes('locked')
                  ? 'bg-orange-500/20 border border-orange-400/30'
                  : error.toLowerCase().includes('rate') || error.toLowerCase().includes('too many')
                    ? 'bg-yellow-500/20 border border-yellow-400/30'
                    : 'bg-red-500/20 border border-red-400/30'
              }`}>
                {error.toLowerCase().includes('locked') && (
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span className="text-xs font-semibold text-orange-300 uppercase tracking-wider">Account Locked</span>
                  </div>
                )}
                {(error.toLowerCase().includes('rate') || error.toLowerCase().includes('too many')) && (
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-yellow-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">Too Many Attempts</span>
                  </div>
                )}
                <p className={`text-sm text-center font-medium ${
                  error.toLowerCase().includes('locked')
                    ? 'text-orange-300'
                    : error.toLowerCase().includes('rate') || error.toLowerCase().includes('too many')
                      ? 'text-yellow-300'
                      : 'text-red-300'
                }`}>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="identifier" className="block text-sm font-semibold text-gray-300 mb-1.5">
                  Username / Phone / Email / ADM
                </label>
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="input-field"
                  placeholder="Enter username, phone, email, or ADM number"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-gray-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="input-field pr-12"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3.5 px-4 font-bold"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    Signing in...
                  </span>
                ) : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-white/10 text-center space-y-3">
              {/* WebAuthn Fingerprint Sign-In for Teachers */}
              {webauthnAvailable && (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={handleWebAuthnLogin}
                    disabled={webauthnLoading}
                    className="w-full flex items-center justify-center gap-2 btn-secondary py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {webauthnLoading ? (
                      <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    ) : (
                      <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                      </svg>
                    )}
                    {webauthnLoading ? 'Authenticating...' : 'Sign in with Fingerprint'}
                  </button>
                  {webauthnError && (
                    <p className="text-xs text-red-400 mt-2">{webauthnError}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">For users with a registered fingerprint or passkey</p>
                </div>
              )}

              <Link to="/forgot-password" className="block text-sm text-slate-400 hover:text-indigo-300 font-medium transition-colors">
                Forgot your password?
              </Link>
              <Link to="/activate" className="block text-sm text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
                Activate a new school →
              </Link>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-6">
            <p className="text-xs text-gray-500">© 2025 SAMS · Smart Attendance Management System</p>
            <p className="text-xs text-gray-500 mt-1">
              Developed by <span className="text-indigo-400 font-medium">Denis Macharia</span> · <a href="tel:+254703285246" className="text-indigo-400 hover:text-indigo-300">+254 703 285 246</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
