import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { FACE_API_MODELS_URI } from '../constants/faceApi';
import { getTemplatesForClass } from '../services/offlineStore';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../lib/apiError';
import { UserRole } from '@sams/shared';

interface MatchResult {
  studentId: string;
  studentName: string;
  confidence: number;
}

interface FaceApiLike {
  nets: {
    tinyFaceDetector: { loadFromUri: (uri: string) => Promise<void> };
    faceLandmark68Net: { loadFromUri: (uri: string) => Promise<void> };
    faceRecognitionNet: { loadFromUri: (uri: string) => Promise<void> };
  };
  TinyFaceDetectorOptions: new () => unknown;
  detectSingleFace: (
    input: HTMLVideoElement,
    options: unknown,
  ) => {
    withFaceLandmarks: () => {
      withFaceDescriptor: () => Promise<{ descriptor: Float32Array } | null>;
    };
  };
}

function getFaceApi(): FaceApiLike | null {
  return (window as Window & { faceapi?: FaceApiLike }).faceapi ?? null;
}

function isSecureCameraContext(): boolean {
  const { protocol, hostname } = window.location;
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
}

function waitForVideoElement(
  ref: React.RefObject<HTMLVideoElement>,
  timeoutMs = 3000,
): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (ref.current) {
        resolve(ref.current);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Camera preview not mounted'));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  video.muted = true;
  video.setAttribute('playsinline', 'true');
  await video.play();
}

const BiometricAttendancePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const sessionFromUrl = searchParams.get('sessionId') ?? '';
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [templates, setTemplates] = useState<unknown[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [featureGated, setFeatureGated] = useState(false);

  useEffect(() => {
    if (sessionFromUrl) setSessionId(sessionFromUrl);
  }, [sessionFromUrl]);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        await apiClient.get('/biometric/templates/check-access');
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 403) setFeatureGated(true);
      }
    };
    void checkAccess();
  }, []);

  // Load face-api.js models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const faceapi = getFaceApi();
        if (!faceapi) {
          setError('Face detection library not loaded. Please refresh the page.');
          return;
        }
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODELS_URI),
          faceapi.nets.faceLandmark68Net.loadFromUri(FACE_API_MODELS_URI),
          faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODELS_URI),
        ]);
        setModelsLoaded(true);
      } catch {
        setError('Failed to load face detection models.');
      }
    };
    loadModels();
  }, []);

  // Active session + class scope (teacher classId may live on Class.classTeacherId)
  useEffect(() => {
    const loadScope = async () => {
      try {
        const params: Record<string, string | boolean> = { isActive: true };
        if (user?.role === UserRole.TEACHER && user.id) {
          params.teacherId = user.id;
        }
        const { data: sessions } = await apiClient.get('/sessions', {
          params,
        });
        const active = Array.isArray(sessions)
          ? sessions.filter((s: { isActive?: boolean }) => s.isActive !== false)
          : [];
        if (active.length > 0) {
          const selected =
            (sessionFromUrl && active.find((s: { id: string }) => s.id === sessionFromUrl)) ||
            active[0];
          setSessionId(selected.id);
          if (selected.classId) setClassId(selected.classId);
        }
      } catch {
        // ignore
      }
    };
    void loadScope();
  }, [user?.id, user?.role, sessionFromUrl]);

  // Load cached templates from IndexedDB
  useEffect(() => {
    const loadTemplates = async () => {
      const effectiveClassId = classId ?? user?.classId;
      if (!effectiveClassId) return;

      const cached = await getTemplatesForClass(effectiveClassId);
      setTemplates(cached);

      if (cached.length === 0) {
        try {
          const { data } = await apiClient.get(`/biometric/templates/${effectiveClassId}`);
          setTemplates(data);
        } catch {
          // ignore - server match still works online
        }
      }
    };
    void loadTemplates();
  }, [classId, user?.classId]);

  const startCamera = useCallback(async () => {
    if (cameraStarting) return;
    setError(null);
    setMatchResult(null);
    setSubmitted(false);

    if (!isSecureCameraContext()) {
      setError('Camera requires HTTPS. Open SAMS using https:// on your school URL (not http://).');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not supported in this browser. Try Chrome on Android or Safari on iPhone.');
      return;
    }

    setCameraStarting(true);
    setCameraActive(true);
    try {
      const video = await waitForVideoElement(videoRef);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await waitForVideoReady(video);
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Camera access denied. Allow camera permission in browser settings, then refresh.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError('Could not start camera. Tap Open camera to try again.');
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  }, [cameraStarting]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  const detectAndMatch = async () => {
    if (!videoRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const faceapi = getFaceApi();
      if (!faceapi) throw new Error('Face API not available');

      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setError('No face detected. Ask the student to face the camera clearly.');
        setLoading(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor as Float32Array);

      if (navigator.onLine) {
        if (!sessionId) {
          setError('No active attendance session. Start a session first.');
          setLoading(false);
          return;
        }

        const { data } = await apiClient.post('/biometric/match', {
          descriptor,
          classId: classId ?? user?.classId ?? undefined,
          sessionId,
        });

        const matched = data.matched === true || data.match === true;
        if (matched) {
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
        setError('Face attendance requires internet so SAMS can match the student against enrolled templates securely. Reconnect and try again.');
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Biometric verification failed.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  if (featureGated) {
    return (
      <div className="page-shell p-6">
        <div className="max-w-xl mx-auto surface-card p-7 text-center border border-line">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 9v3.75m0 3.75h.008v.008H12V16.5zm8.25-4.5a8.25 8.25 0 11-16.5 0 8.25 8.25 0 0116.5 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-ink mb-2">Biometric attendance unavailable</h1>
          <p className="text-ink-muted text-sm leading-6">
            Biometric scanning requires a Professional or Enterprise plan. Upgrade the school license
            in the Super Admin portal, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 surface-card border border-line p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle mb-2">Teacher device</p>
              <h1 className="text-2xl font-semibold text-ink">Biometric attendance</h1>
              <p className="text-ink-muted text-sm mt-2 leading-6 max-w-2xl">
                Use a teacher or HOD device to identify enrolled students and mark attendance for the active session.
                Students should enroll once, then continue using QR or link attendance when self check-in is required.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface-muted px-3 py-2 text-left sm:text-right">
              <p className="text-[11px] uppercase tracking-wide text-ink-subtle">Templates</p>
              <p className="text-sm font-semibold text-ink">{templates.length} available</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-300 text-center">{error}</p>
          </div>
        )}

        <div className="surface-card border border-line p-6">
          {!modelsLoaded && !error && (
            <div className="text-center py-8">
              <div className="flex items-center justify-center gap-3">
                <svg className="animate-spin h-5 w-5 text-brand" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="text-ink-muted">Loading face detection models...</p>
              </div>
            </div>
          )}

          {modelsLoaded && !sessionId && !submitted && (
            <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Start an attendance session before using biometric scanning.
            </div>
          )}

          {modelsLoaded && !cameraActive && !submitted && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-surface-muted border border-line mb-4">
                <svg className="w-10 h-10 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <p className="text-ink-muted mb-6">
                Keep the device steady, ask the student to face the camera, then scan. Attendance is recorded
                only after a confident match.
              </p>
              <button
                onClick={startCamera}
                disabled={!sessionId || cameraStarting}
                className="btn-primary py-3 px-8 transition-colors disabled:opacity-50"
              >
                {cameraStarting ? 'Opening camera...' : 'Open camera'}
              </button>
            </div>
          )}

          {cameraActive && (
            <div>
              <div className="relative rounded-2xl overflow-hidden mb-4 border border-line bg-black/20">
                <video
                  ref={videoRef}
                  className="w-full rounded-2xl"
                  playsInline
                  muted
                />
                {/* Face outline overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-60 rounded-full border-2 border-white/60 shadow-[0_0_0_9999px_rgba(15,23,42,0.25)]" />
                </div>
              </div>

              <button
                onClick={detectAndMatch}
                disabled={loading}
                className="w-full btn-primary py-3 px-4 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                  'Scan student face'
                )}
              </button>

              <button
                onClick={stopCamera}
                className="mt-3 w-full btn-secondary py-2.5 px-4 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {submitted && matchResult && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-4">
                <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-ink">Student marked present</p>
              <p className="text-ink-muted mt-1">{matchResult.studentName}</p>
              <p className="text-xs text-ink-subtle mt-1">
                Confidence: {(matchResult.confidence * 100).toFixed(1)}%
              </p>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setMatchResult(null);
                  void startCamera();
                }}
                className="mt-6 btn-primary py-3 px-8 transition-colors"
              >
                Next Student
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-ink-subtle mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default BiometricAttendancePage;
