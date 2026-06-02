import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';

type Mode = 'link' | 'otp';

const ForgotPasswordPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('link');
  const [schoolCode, setSchoolCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpDeliveryHint, setOtpDeliveryHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSendLink = async (e: React.FormEvent) => {
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

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/auth/forgot-password-otp', { schoolCode, identifier });
      setOtpSent(true);
      const parts: string[] = [];
      if (data.sentVia?.sms) parts.push('SMS');
      if (data.sentVia?.email) parts.push('email');
      setOtpDeliveryHint(
        parts.length > 0
          ? `Code sent via ${parts.join(' and ')}.${data.hint ? ` ${data.hint}` : ''}`
          : data.hint ?? null,
      );
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to send verification code.';
      const hint = err.response?.data?.sandbox
        ? ' Add your phone in the Africa\'s Talking sandbox dashboard (SMS → phone numbers).'
        : '';
      setError(msg + hint);
    } finally {
      setLoading(false);
    }
  };

  const handleResetWithOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/auth/reset-password-otp', {
        schoolCode,
        identifier,
        code: otpCode,
        newPassword,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid code or reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a2332] to-[#0f1923] px-6 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white/5 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/20 p-8 border border-white/10">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-white mb-1">Forgot Password</h2>
            <p className="text-gray-400 text-sm">
              {mode === 'otp' ? 'Reset with a 6-digit code via email or SMS' : 'We will email or SMS you a reset link'}
            </p>
          </div>

          {!success && (
            <div className="flex gap-2 mb-6 p-1 rounded-xl bg-white/5 border border-white/10">
              <button
                type="button"
                onClick={() => { setMode('otp'); setError(null); setOtpSent(false); }}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${mode === 'otp' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                OTP code
              </button>
              <button
                type="button"
                onClick={() => { setMode('link'); setError(null); setOtpSent(false); }}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${mode === 'link' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Reset link
              </button>
            </div>
          )}

          {success ? (
            <div className="p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl text-center">
              <p className="text-emerald-200 font-medium">Password reset complete!</p>
              <p className="text-emerald-300/70 text-sm mt-1">You can now sign in with your new password.</p>
              <Link to="/login" className="inline-block mt-4 text-sm text-teal-400 hover:text-teal-300 font-semibold">
                ← Back to Login
              </Link>
            </div>
          ) : mode === 'link' ? (
            <>
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                  <p className="text-sm text-red-300 text-center">{error}</p>
                </div>
              )}
              <form onSubmit={handleSendLink} className="space-y-5">
                <Field label="School Code" id="schoolCode" value={schoolCode} onChange={setSchoolCode} placeholder="e.g. KHS2024" />
                <Field label="Username, Phone, or Email" id="identifier" value={identifier} onChange={setIdentifier} placeholder="Your login identifier" />
                <SubmitButton loading={loading} label="Send Reset Link" />
              </form>
            </>
          ) : !otpSent ? (
            <>
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                  <p className="text-sm text-red-300 text-center">{error}</p>
                </div>
              )}
              <form onSubmit={handleSendOtp} className="space-y-5">
                <Field label="School Code" id="schoolCode" value={schoolCode} onChange={setSchoolCode} placeholder="e.g. KHS2024" />
                <Field label="Username, Phone, or Email" id="identifier" value={identifier} onChange={setIdentifier} placeholder="Your login identifier" />
                <SubmitButton loading={loading} label="Send verification code" />
              </form>
            </>
          ) : (
            <>
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                  <p className="text-sm text-red-300 text-center">{error}</p>
                </div>
              )}
              <p className="text-sm text-gray-400 mb-4 text-center">
                {otpDeliveryHint ?? 'Enter the 6-digit code sent to your email or phone.'}
              </p>
              <form onSubmit={handleResetWithOtp} className="space-y-5">
                <div>
                  <label htmlFor="otpCode" className="block text-sm font-semibold text-gray-300 mb-1.5">Verification code</label>
                  <input
                    id="otpCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    required
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                    placeholder="000000"
                  />
                </div>
                <Field label="New password" id="newPassword" value={newPassword} onChange={setNewPassword} placeholder="Min 8 characters" type="password" />
                <Field label="Confirm password" id="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat password" type="password" />
                <SubmitButton loading={loading} label="Reset password" />
              </form>
            </>
          )}

          {!success && (
            <div className="mt-6 pt-6 border-t border-white/10 text-center">
              <Link to="/login" className="text-sm text-teal-400 hover:text-teal-300 font-semibold">
                ← Back to Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-300 mb-1.5">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(type === 'text' && id === 'schoolCode' ? e.target.value.toUpperCase() : e.target.value)}
        required
        minLength={type === 'password' ? 8 : undefined}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
        placeholder={placeholder}
      />
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3.5 px-4 rounded-xl hover:from-teal-400 hover:to-cyan-500 disabled:opacity-50 transition-all"
    >
      {loading ? 'Please wait...' : label}
    </button>
  );
}

export default ForgotPasswordPage;
