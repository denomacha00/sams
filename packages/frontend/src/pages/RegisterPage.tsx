import React, { useState, useEffect, useRef } from 'react';
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

  // Biometric enrollment state
  const [showBiometric, setShowBiometric] = useState(false);
  const [bioStep, setBioStep] = useState<'init' | 'camera' | 'capture' | 'done'>('init');
  const [bioLoading, setBioLoading] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioModelsLoaded, setBioModelsLoaded] = useState(false);
  const [registeredCredentials, setRegisteredCredentials] = useState<{ accessToken: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      const { data } = await apiClient.post(`/registration-links/${token}/register`, {
        fullName,
        username,
        phone: phone || undefined,
        password,
        admissionNumber: isStudent ? admissionNumber : undefined,
      });
      setSuccess(true);
      // Store credentials for optional biometric enrollment
      if (data.accessToken) {
        setRegisteredCredentials({ accessToken: data.accessToken });
      }
      // If student, offer biometric enrollment; otherwise redirect after delay
      if (isStudent) {
        // Don't auto-redirect — show biometric option
      } else {
        setTimeout(() => navigate('/login', { replace: true }), 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Biometric enrollment helpers
  const loadBioModels = async () => {
    try {
      const faceapi = (window as any).faceapi;
      if (!faceapi) {
        setBioError('Face detection library not loaded. Please refresh.');
        return;
      }
      const MODEL_URL = '/models';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      setBioModelsLoaded(true);
    } catch {
      setBioError('Failed to load face detection models.');
    }
  };

  const startBiometricEnroll = async () => {
    setShowBiometric(true);
    setBioStep('init');
    await loadBioModels();
  };

  const startCamera = async () => {
    setBioError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setBioStep('camera');
      }
    } catch {
      setBioError('Camera access denied. Please allow camera permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const captureAndEnroll = async () => {
    if (!videoRef.current) return;
    setBioLoading(true);
    setBioError(null);

    try {
      const faceapi = (window as any).faceapi;
      if (!faceapi) throw new Error('Face API not available');

      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setBioError('No face detected. Position your face clearly in the frame.');
        setBioLoading(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor as Float32Array);

      // Use the token from registration to authenticate the enrollment
      const headers: Record<string, string> = {};
      if (registeredCredentials?.accessToken) {
        headers['Authorization'] = `Bearer ${registeredCredentials.accessToken}`;
      }

      await apiClient.post('/biometric/enroll', { descriptor }, { headers });

      stopCamera();
      setBioStep('done');
    } catch (err: any) {
      setBioError(err.response?.data?.error || 'Enrollment failed. Please try again.');
    } finally {
      setBioLoading(false);
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

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
        {success && !showBiometric && (
          <div className="mb-6 p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl text-center">
            <svg className="w-8 h-8 text-emerald-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            <p className="text-emerald-200 font-medium">Registration successful!</p>
            {isStudent ? (
              <div className="mt-4 space-y-3">
                <p className="text-gray-400 text-sm">Would you like to enroll your face for biometric attendance?</p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={startBiometricEnroll}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold py-2.5 px-5 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-purple-500/20"
                  >
                    Enroll Face
                  </button>
                  <button
                    onClick={() => navigate('/login', { replace: true })}
                    className="bg-white/10 border border-white/20 text-gray-300 font-medium py-2.5 px-5 rounded-xl hover:bg-white/20 transition-all"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-emerald-300/70 text-sm mt-1">Redirecting to login...</p>
            )}
          </div>
        )}

        {/* Biometric Enrollment Step */}
        {showBiometric && (
          <div className="mb-6 p-4 bg-purple-500/10 border border-purple-400/20 rounded-xl">
            <h3 className="text-lg font-bold text-white text-center mb-3">Face Enrollment</h3>

            {bioError && (
              <div className="mb-3 p-2 bg-red-500/20 border border-red-400/30 rounded-lg">
                <p className="text-xs text-red-300 text-center">{bioError}</p>
              </div>
            )}

            {bioStep === 'init' && !bioModelsLoaded && (
              <div className="text-center py-4">
                <div className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-purple-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  <p className="text-gray-400 text-sm">Loading face detection models...</p>
                </div>
              </div>
            )}

            {bioStep === 'init' && bioModelsLoaded && (
              <div className="text-center py-4">
                <p className="text-gray-400 text-sm mb-4">Position your face in a well-lit area and press start.</p>
                <button
                  onClick={startCamera}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-2.5 px-6 rounded-xl shadow-lg shadow-purple-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Start Camera
                </button>
              </div>
            )}

            {bioStep === 'camera' && (
              <div>
                <div className="relative rounded-xl overflow-hidden mb-4">
                  <video ref={videoRef} className="w-full rounded-xl" playsInline muted />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-40 h-52 border-2 border-purple-400/50 rounded-full" />
                  </div>
                </div>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={captureAndEnroll}
                    disabled={bioLoading}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-2.5 px-6 rounded-xl shadow-lg shadow-purple-500/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {bioLoading ? 'Processing...' : 'Capture & Enroll'}
                  </button>
                  <button
                    onClick={() => { stopCamera(); setShowBiometric(false); navigate('/login', { replace: true }); }}
                    className="bg-white/10 border border-white/20 text-gray-300 py-2.5 px-4 rounded-xl hover:bg-white/20 transition-all"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}

            {bioStep === 'done' && (
              <div className="text-center py-4">
                <svg className="w-10 h-10 text-emerald-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                <p className="text-emerald-200 font-medium">Face enrolled successfully!</p>
                <p className="text-gray-400 text-sm mt-1">You can now use biometric attendance.</p>
                <button
                  onClick={() => navigate('/login', { replace: true })}
                  className="mt-4 bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-semibold py-2.5 px-6 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  Continue to Login
                </button>
              </div>
            )}
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
