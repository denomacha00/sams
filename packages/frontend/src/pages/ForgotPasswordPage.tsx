import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';

const ForgotPasswordPage: React.FC = () => {
  const [schoolCode, setSchoolCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.post('/auth/forgot-password', { schoolCode, identifier });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to process request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2332] to-[#0f1923] px-6 py-12">
      <div className="w-full max-w-md">
        {/* Form card */}
        <div className="bg-white/5 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/20 p-8 border border-white/10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-500/20 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">Forgot Password</h2>
            <p className="text-gray-400 text-sm">Enter your details and we'll send you a reset link</p>
          </div>

          {success ? (
            <div className="p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl text-center">
              <svg className="w-8 h-8 text-emerald-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-emerald-200 font-medium">Reset link sent!</p>
              <p className="text-emerald-300/70 text-sm mt-1">Check your phone/email for the temporary password.</p>
              <Link to="/login" className="inline-block mt-4 text-sm text-teal-400 hover:text-teal-300 font-semibold transition-colors">
                ← Back to Login
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                  <p className="text-sm text-red-300 text-center">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="schoolCode" className="block text-sm font-semibold text-gray-300 mb-1.5">
                    School Code
                  </label>
                  <input
                    id="schoolCode"
                    type="text"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value.toUpperCase())}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all duration-200"
                    placeholder="e.g. KHS2024"
                  />
                </div>

                <div>
                  <label htmlFor="identifier" className="block text-sm font-semibold text-gray-300 mb-1.5">
                    Username, Phone, or Email
                  </label>
                  <input
                    id="identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all duration-200"
                    placeholder="Enter your username, phone, or email"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3.5 px-4 rounded-xl hover:from-teal-400 hover:to-cyan-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-teal-500/30 hover:shadow-teal-500/50 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      Processing...
                    </span>
                  ) : 'Send Reset Link'}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-white/10 text-center">
                <Link to="/login" className="text-sm text-teal-400 hover:text-teal-300 font-semibold transition-colors">
                  ← Back to Login
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-gray-500">© 2025 SAMS · Smart Attendance Management System</p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
