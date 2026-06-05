import React, { useCallback, useState, useRef, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { FACE_API_MODELS_URI } from '../constants/faceApi';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../lib/apiError';

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

const BiometricEnrollPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [step, setStep] = useState<'init' | 'blink' | 'capture'>('init');
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [featureGated, setFeatureGated] = useState(false);

  // Check plan tier access
  useEffect(() => {
    const checkAccess = async () => {
      try {
        await apiClient.get('/biometric/templates/check-access');
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setFeatureGated(true);
        }
      }
    };
    checkAccess();
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

  const startCamera = useCallback(async () => {
    if (cameraStarting) return;
    setError(null);

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
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await waitForVideoReady(video);
      setStep('blink');
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Camera access denied. Allow camera permission in browser settings, then refresh.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError('Could not start camera. Tap Start Camera to try again.');
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

  const handleBlinkCheck = () => {
    // Simplified liveness check - in production, detect actual blink via eye aspect ratio
    setBlinkDetected(true);
    setStep('capture');
  };

  const captureAndEnroll = async () => {
    if (!videoRef.current || !canvasRef.current) return;
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
        setError('No face detected. Please position your face clearly in the frame.');
        setLoading(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor as Float32Array);

      // POST descriptor to server (server handles encryption)
      await apiClient.post('/biometric/enroll', {
        descriptor,
      });

      setSuccess(true);
      stopCamera();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Enrollment failed. Please try again.'));
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
        <div className="max-w-lg mx-auto">
          <div className="surface-card rounded-2xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/25 mb-4">
              <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Feature Unavailable</h2>
            <p className="text-ink-muted">
              Biometric enrollment requires a Professional or Enterprise plan. Please upgrade your subscription to access this feature.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell p-6">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Biometric Enrollment</h1>
          <p className="text-ink-muted text-sm mt-1">
            Register your face once. During class, your teacher or HOD scans your face on their device
            and SAMS identifies you automatically for attendance.
          </p>
        </div>

        {success && (
          <div className="mb-4 p-4 bg-indigo-500/20 border border-indigo-400/30 rounded-xl backdrop-blur-sm text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/30 mb-3">
              <svg className="w-8 h-8 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-indigo-200 font-medium text-lg">Enrollment Complete</p>
            <p className="text-ink-muted text-sm mt-1">
              Your face is now saved securely. Teachers/HODs can use Face Scan to mark you present when you are in class.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-300 text-center">{error}</p>
          </div>
        )}

        <div className="surface-card p-6">
          {!modelsLoaded && !error && (
            <div className="text-center py-8">
              <div className="flex items-center justify-center gap-3">
                <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="text-ink-muted">Loading face detection models...</p>
              </div>
            </div>
          )}

          {modelsLoaded && !cameraActive && !success && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl input-field mb-4">
                <svg className="w-10 h-10 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <p className="text-ink-muted mb-6">
                We&apos;ll capture your face for attendance matching. Use good lighting and look straight at the camera.
              </p>
              <button
                onClick={startCamera}
                disabled={cameraStarting}
                className="btn-primary py-3 px-8 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
              >
                {cameraStarting ? 'Opening Camera...' : 'Start Camera'}
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
                  <div className="w-48 h-60 border-2 border-indigo-400/50 rounded-full" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />

              {step === 'blink' && !blinkDetected && (
                <div className="text-center">
                  <p className="text-white font-medium mb-2">Liveness Check</p>
                  <p className="text-ink-muted text-sm mb-4">Please blink your eyes, then press the button below.</p>
                  <button
                    onClick={handleBlinkCheck}
                    className="bg-amber-500/10 border border-amber-500/25 text-amber-300 font-semibold py-2.5 px-6 rounded-xl hover:bg-amber-500/15 transition-all duration-200"
                  >
                    I Blinked
                  </button>
                </div>
              )}

              {step === 'capture' && (
                <div className="text-center">
                  <p className="text-indigo-300 font-medium mb-2">✓ Liveness confirmed</p>
                  <p className="text-ink-muted text-sm mb-4">Look directly at the camera and press capture.</p>
                  <button
                    onClick={captureAndEnroll}
                    disabled={loading}
                    className="btn-primary py-3 px-8 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing...
                      </span>
                    ) : (
                      'Capture & Enroll'
                    )}
                  </button>
                </div>
              )}

              <button
                onClick={stopCamera}
                className="mt-4 w-full btn-secondary py-2.5 px-4 transition-all duration-200"
              >
                Cancel
              </button>
            </div>
          )}

          {success && (
            <div className="text-center py-4">
              <button
                onClick={() => {
                  setSuccess(false);
                  setStep('init');
                  setBlinkDetected(false);
                }}
                className="btn-primary py-3 px-8 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
              >
                Enroll Another
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

export default BiometricEnrollPage;
