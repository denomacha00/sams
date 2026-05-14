import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

const LoginPage: React.FC = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

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
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-[#0f2027] via-[#203a43] to-[#2c5364] items-center justify-center">
        {/* Decorative circles */}
        <div className="absolute -top-20 -left-20 w-80 h-80 bg-teal-400/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-cyan-400/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-10 w-40 h-40 bg-emerald-400/10 rounded-full blur-2xl" />

        {/* 3D Logo */}
        <div className="relative z-10 text-center px-12">
          {/* 3D Shield Logo */}
          <div className="relative inline-block mb-8">
            {/* Shadow layer */}
            <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-3xl bg-black/30 blur-xl" />
            {/* Back layer */}
            <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-3xl bg-gradient-to-br from-teal-700 to-cyan-900" />
            {/* Main logo container */}
            <div className="relative w-32 h-32 rounded-3xl bg-gradient-to-br from-teal-400 via-cyan-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-teal-500/30 border border-white/20">
              {/* Inner shield */}
              <svg className="w-16 h-16 text-white drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {/* Shine effect */}
              <div className="absolute top-2 left-2 w-8 h-8 bg-white/30 rounded-full blur-md" />
            </div>
          </div>

          {/* 3D Text */}
          <h1 className="text-6xl font-black text-white tracking-tight mb-3" style={{ textShadow: '0 4px 8px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)' }}>
            SAMS
          </h1>
          <p className="text-lg text-teal-200/80 font-medium tracking-wide">
            Smart Attendance Management System
          </p>
          <p className="text-sm text-teal-300/50 mt-4 max-w-sm mx-auto leading-relaxed">
            Multi-school enterprise platform with QR, GPS, and biometric attendance verification for Kenyan institutions.
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-[#1a2332] to-[#0f1923] px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo (shown on small screens) */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-500 to-blue-600 shadow-xl shadow-teal-500/30 mb-4">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-3xl font-black text-white">SAMS</h1>
            <p className="text-sm text-gray-400">Smart Attendance Management System</p>
          </div>

          {/* Form card */}
          <div className="bg-white/5 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/20 p-8 border border-white/10">
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all duration-200"
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
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all duration-200 pr-12"
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
                className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3.5 px-4 rounded-xl hover:from-teal-400 hover:to-cyan-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-teal-500/30 hover:shadow-teal-500/50 hover:scale-[1.01] active:scale-[0.99]"
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
              <Link to="/forgot-password" className="block text-sm text-gray-400 hover:text-teal-300 font-medium transition-colors">
                Forgot your password?
              </Link>
              <Link to="/activate" className="block text-sm text-teal-400 hover:text-teal-300 font-semibold transition-colors">
                Activate a new school →
              </Link>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-6">
            <p className="text-xs text-gray-500">© 2025 SAMS · Smart Attendance Management System</p>
            <p className="text-xs text-gray-500 mt-1">
              Developed by <span className="text-teal-400 font-medium">Denis Macharia</span> · <a href="tel:+254703285246" className="text-teal-400 hover:text-teal-300">+254 703 285 246</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
