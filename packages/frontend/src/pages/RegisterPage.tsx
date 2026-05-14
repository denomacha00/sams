import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';

interface LinkMeta {
  schoolName: string;
  schoolCode?: string;
  className?: string;
  departmentName?: string;
  targetRole: string;
  expiresAt: string;
}

const RegisterPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [linkMeta, setLinkMeta] = useState<LinkMeta | null>(null);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.post(`/registration-links/${token}/register`, {
        fullName,
        username,
        phone: phone || undefined,
        password,
        admissionNumber: isStudent ? admissionNumber : undefined,
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
            {isStudent ? 'Student Registration' : 'Staff Registration'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Registering as <span className="text-teal-400 font-medium">{linkMeta?.targetRole}</span>
          </p>
        </div>

        {/* Pre-filled context info */}
        {linkMeta && (
          <div className="mb-6 p-3 bg-white/5 border border-white/10 rounded-xl space-y-1.5" role="region" aria-label="Registration context">
            {linkMeta.schoolName && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                <span className="text-sm text-gray-300"><span className="text-gray-500">School:</span> {linkMeta.schoolName}</span>
              </div>
            )}
            {linkMeta.departmentName && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" /></svg>
                <span className="text-sm text-gray-300"><span className="text-gray-500">Department:</span> {linkMeta.departmentName}</span>
              </div>
            )}
            {linkMeta.className && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                <span className="text-sm text-gray-300"><span className="text-gray-500">Class:</span> {linkMeta.className}</span>
              </div>
            )}
          </div>
        )}

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

            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-1.5">Username *</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                required
                minLength={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                placeholder="Choose a username"
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

            {/* Admission Number field for students only */}
            {isStudent && (
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Admission Number (ADM) *</label>
                <input
                  type="text"
                  value={admissionNumber}
                  onChange={(e) => setAdmissionNumber(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                  placeholder="e.g. ADM/2024/001"
                />
              </div>
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
