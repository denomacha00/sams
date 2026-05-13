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
        setError(
          err.response?.data?.error || 'Invalid or expired registration link.'
        );
      } finally {
        setResolving(false);
      }
    };
    resolveLink();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.post(`/registration-links/${token}/register`, {
        fullName,
        admissionNumber,
        password,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err: any) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Registration failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (resolving) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <p className="text-gray-400">Verifying registration link...</p>
      </div>
    );
  }

  if (!linkMeta && error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold text-red-400 mb-2">Invalid Link</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Register</h1>
          {linkMeta && (
            <p className="text-gray-400 mt-1">
              {linkMeta.schoolName}
              {linkMeta.className && ` — ${linkMeta.className}`}
            </p>
          )}
        </div>

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-700">
              Registration successful! Redirecting to login...
            </p>
          </div>
        )}

        {error && !success && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-gray-300">
              Full Name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-white/10 px-3 py-2 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
              placeholder="Your full name"
            />
          </div>

          <div>
            <label htmlFor="admissionNumber" className="block text-sm font-medium text-gray-300">
              Admission Number
            </label>
            <input
              id="admissionNumber"
              type="text"
              value={admissionNumber}
              onChange={(e) => setAdmissionNumber(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-white/10 px-3 py-2 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
              placeholder="e.g. ADM/2024/001"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border border-white/10 px-3 py-2 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
              placeholder="Minimum 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading || success}
            className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white py-2 px-4 rounded-md hover:from-teal-400 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Registering...' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
