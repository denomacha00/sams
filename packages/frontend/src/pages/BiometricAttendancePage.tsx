import React, { useState, useRef, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { getTemplatesForClass } from '../services/offlineStore';
import { saveAttendanceRecord } from '../services/offlineStore';
import { useAuthStore } from '../store/authStore';
import { AttendanceStatus } from '@sams/shared';

interface MatchResult {
  studentId: string;
  studentName: string;
  confidence: number;
}

const MATCH_THRESHOLD = 0.6; // Euclidean distance threshold

const BiometricAttendancePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  // Load face-api.js models
  useEffect(() => {
    const loadModels = async () => {
      try {
        // @ts-ignore - face-api loaded via script tag or dynamic import
        const faceapi = (window as any).faceapi;
        if (!faceapi) {
          setError('Face detection library not loaded. Please refresh the page.');
          return;
        }
        const MODEL_URL = '/models';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        setModelsLoaded(true);
      } catch {
        setError('Failed to load face detection models.');
      }
    };
    loadModels();
  }, []);

  // Load cached templates from IndexedDB
  useEffect(() => {
    const loadTemplates = async () => {
      if (user?.classId) {
        const cached = await getTemplatesForClass(user.classId);
        setTemplates(cached);

        // If no cached templates, fetch from server
        if (cached.length === 0) {
          try {
            const { data } = await apiClient.get(`/biometric/templates/${user.classId}`);
            setTemplates(data);
          } catch {
            // ignore - will work without cached templates
          }
        }
      }
    };
    loadTemplates();
  }, [user?.classId]);

  const startCamera = async () => {
    setError(null);
    setMatchResult(null);
    setSubmitted(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch {
      setError('Camera access denied. Please allow camera permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const detectAndMatch = async () => {
    if (!videoRef.current) return;
    setLoading(true);
    setError(null);

    try {
      // @ts-ignore
      const faceapi = (window as any).faceapi;
      if (!faceapi) throw new Error('Face API not available');

      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setError('No face detected. Please position your face clearly.');
        setLoading(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor as Float32Array);

      if (navigator.onLine) {
        // Send to server for matching
        const { data } = await apiClient.post('/attendance/biometric', {
          descriptor,
          classId: user?.classId,
        });

        if (data.match && data.confidence >= MATCH_THRESHOLD) {
          setMatchResult({
            studentId: data.studentId,
            studentName: data.studentName,
            confidence: data.confidence,
          });
          setSubmitted(true);
          stopCamera();
        } else {
          setError(
            `No match found. Confidence: ${((data.confidence || 0) * 100).toFixed(1)}%. Please try again.`
          );
        }
      } else {
        // Offline: save to IndexedDB for later sync
        await saveAttendanceRecord({
          id: crypto.randomUUID(),
          sessionId: '',
          studentId: user?.id || '',
          status: AttendanceStatus.PRESENT,
          method: 'OFFLINE_BIOMETRIC',
          scannedAt: new Date().toISOString(),
          synced: false,
        });
        setSubmitted(true);
        setMatchResult({
          studentId: user?.id || '',
          studentName: user?.fullName || 'You',
          confidence: 1,
        });
        setError('Saved offline. Will sync when connected.');
        stopCamera();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Biometric verification failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Biometric Attendance</h1>
          <p className="text-gray-400 text-sm mt-1">Use face recognition to mark attendance</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          {!modelsLoaded && !error && (
            <div className="text-center py-8">
              <div className="flex items-center justify-center gap-3">
                <svg className="animate-spin h-5 w-5 text-purple-400" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="text-gray-400">Loading face detection models...</p>
              </div>
            </div>
          )}

          {modelsLoaded && !cameraActive && !submitted && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 mb-4">
                <svg className="w-10 h-10 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <p className="text-gray-300 mb-6">
                Look directly at the camera to verify your identity and mark attendance.
              </p>
              <button
                onClick={startCamera}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
              >
                Start Camera
              </button>
            </div>
          )}

          {cameraActive && (
            <div>
              <div className="relative rounded-2xl overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  className="w-full rounded-2xl"
                  playsInline
                  muted
                />
                {/* Face outline overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-60 border-2 border-purple-400/50 rounded-full" />
                </div>
              </div>

              <button
                onClick={detectAndMatch}
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Verifying...
                  </span>
                ) : (
                  'Verify Face'
                )}
              </button>

              <button
                onClick={stopCamera}
                className="mt-3 w-full bg-white/10 border border-white/20 text-white py-2.5 px-4 rounded-xl hover:bg-white/20 transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {submitted && matchResult && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/30 mb-4">
                <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-medium text-white">Attendance Recorded</p>
              <p className="text-gray-400 mt-1">{matchResult.studentName}</p>
              <p className="text-xs text-gray-500 mt-1">
                Confidence: {(matchResult.confidence * 100).toFixed(1)}%
              </p>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setMatchResult(null);
                  startCamera();
                }}
                className="mt-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
              >
                Next Student
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default BiometricAttendancePage;
