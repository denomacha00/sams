import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../services/apiClient';

const ActivationPage: React.FC = () => {
  const [licenseKey, setLicenseKey] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [activatedSchoolCode, setActivatedSchoolCode] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data } = await apiClient.post('/activate', {
        licenseKey: licenseKey.trim().toUpperCase(),
        schoolName: schoolName.trim(),
        schoolCode: schoolCode.trim().toUpperCase(),
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      });
      setActivatedSchoolCode(data.schoolCode || schoolCode.trim().toUpperCase());
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 4000);
    } catch (err: any) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Activation failed. Please check your license key.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-4">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
      <div className="absolute top-20 right-20 w-72 h-72 bg-emerald-500/15 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 left-20 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />

      <div className="relative z-10 w-full max-w-md">
        {/* Glass card */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-blue-600 shadow-lg shadow-emerald-500/25 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Activate School</h1>
            <p className="text-sm text-gray-400 mt-1">Enter your license key to get started</p>
          </div>

          {/* Success state */}
          {success && (
            <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl backdrop-blur-sm text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/30 mb-3">
                <svg className="w-6 h-6 text-emerald-300 animate-[bounce_1s_ease-in-out]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-emerald-200 font-medium mb-2">
                School activated successfully!
              </p>
              <div className="bg-emerald-500/10 border border-emerald-400/20 rounded-lg px-3 py-2 inline-block">
                <p className="text-xs text-emerald-300/70 uppercase tracking-wider">Your School Code</p>
                <p className="text-lg font-bold text-emerald-100 tracking-widest">{activatedSchoolCode}</p>
              </div>
              <p className="text-xs text-emerald-300/60 mt-2">
                Share this code with your staff and students to log in. Redirecting...
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
              <p className="text-sm text-red-200 text-center">{error}</p>
            </div>
          )}

          {/* Form */}
          {!success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="licenseKey" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  License Key
                </label>
                <input
                  id="licenseKey"
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400/50 transition-all duration-200"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                />
              </div>

              <div>
                <label htmlFor="schoolName" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  School Name
                </label>
                <input
                  id="schoolName"
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400/50 transition-all duration-200"
                  placeholder="e.g. Kenyatta High School"
                />
              </div>

              <div>
                <label htmlFor="schoolCode" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  School Code
                </label>
                <input
                  id="schoolCode"
                  type="text"
                  value={schoolCode}
                  onChange={(e) => setSchoolCode(e.target.value.toUpperCase())}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400/50 transition-all duration-200"
                  placeholder="e.g. KHS2024"
                />
              </div>

              <div>
                <label htmlFor="adminFullName" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  Admin Full Name
                </label>
                <input
                  id="adminFullName"
                  type="text"
                  value={adminFullName}
                  onChange={(e) => setAdminFullName(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400/50 transition-all duration-200"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label htmlFor="adminEmail" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  Admin Email
                </label>
                <input
                  id="adminEmail"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400/50 transition-all duration-200"
                  placeholder="admin@school.ac.ke"
                />
              </div>

              <div>
                <label htmlFor="adminPassword" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  Admin Password
                </label>
                <input
                  id="adminPassword"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400/50 transition-all duration-200"
                  placeholder="Minimum 8 characters"
                />
              </div>

              <button
                type="submit"
                disabled={loading || success}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3.5 px-4 rounded-xl hover:from-blue-500 hover:to-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-[0.98]"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Activating...
                  </span>
                ) : (
                  'Activate School'
                )}
              </button>
            </form>
          )}

          {/* Footer link */}
          <div className="mt-6 pt-6 border-t border-white/10 text-center">
            <Link
              to="/login"
              className="text-sm text-purple-300 hover:text-purple-200 transition-colors font-medium"
            >
              ← Already activated? Sign in
            </Link>
          </div>
        </div>

        {/* Bottom text */}
        <p className="text-center text-xs text-gray-500 mt-6">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ActivationPage;
