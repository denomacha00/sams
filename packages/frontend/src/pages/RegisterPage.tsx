import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';

interface LinkMeta {
  schoolName: string;
  className?: string;
  targetRole: string;
  expiresAt: string;
}

const RegisterPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [linkMeta, setLinkMeta] = useState<LinkMeta | null>(null);
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const resolveLink = async () => {
      try {
        const { data } = await apiClient.get(`/registration-links/${token}`);
        setLinkMeta(data);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Invalid or expired registration link.');
      } finally {
        setResolving(false);
      }
    };
    resolveLink();
  }, [token]);

  const isStudent = linkMeta?.targetRole === 'STUDENT';
  const isTeacherOrHOD = linkMeta?.targetRole === 'TEACHER' || linkMeta?.targetRole === 'HOD';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.post(`/registration-links/${token}/register`, {
        fullName,
        admissionNumber: identifier,
        phone: phone || undefined,
        password,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (resolving) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-teal-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
          <p className="text-gray-400">Verifying registration link...</p>
        </div>
      </div>
    );
  }

  if (!linkMeta && error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <h1 className="text-xl font-bold text-red-400 mb-2">Invalid Link</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-500/20 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {isStudent ? 'Student Registration' : isTeacherOrHOD ? 'Staff Registration' : 'Registration'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Registering as <span className="text-teal-400 font-medium">{linkMeta?.targetRole}</span>
          </p>
        </div>

        {/* Success */}
        {success && (
          <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl text-center">
            <svg className="w-8 h-8 text-emerald-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            <p className="text-emerald-200 font-medium">Registration successful!</p>
            <p className="text-emerald-300/70 text-sm mt-1">Redirecting to login...</p>
          </div>
        )}

        {/* Error */}
        {error && !success && (
          <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
            <p className="text-sm text-red-300 text-center">{error}</p>
          </div>
        )}

        {/* Form */}
        {!success && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-1.5">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                placeholder="Your full name"
              />
            </div>

            {/* Different field based on role */}
            {isStudent ? (
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Admission Number *</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                  placeholder="e.g. ADM/2024/001"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">Work ID / Staff Number *</label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                    placeholder="e.g. TSC/12345"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">Phone Number *</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                    placeholder="+254 7XX XXX XXX"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-1.5">Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                placeholder="Minimum 8 characters"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3.5 px-4 rounded-xl hover:from-teal-400 hover:to-cyan-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-500/30 hover:scale-[1.01] active:scale-[0.99]"
            >
              {loading ? 'Registering...' : 'Register'}
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-600 mt-6">© 2025 SAMS · Developed by Denis Macharia</p>
      </div>
    </div>
  );
};

export default RegisterPage;
