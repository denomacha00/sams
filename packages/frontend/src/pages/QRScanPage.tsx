import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { saveAttendanceRecord } from '../services/offlineStore';
import { AttendanceStatus } from '@sams/shared';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../lib/apiError';
import { getAttendanceDeviceId } from '../lib/attendanceDevice';

const QR_ATTENDANCE_TIMEOUT_MS = 8_000;

declare global {
  interface Window {
    jsQR?: (
      data: Uint8ClampedArray,
      width: number,
      height: number
    ) => { data: string } | null;
  }
}

function waitForJsQR(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (typeof window.jsQR === 'function') {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function decodeQrSessionId(qrToken: string): string | null {
  try {
    const payload = qrToken.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { sessionId?: unknown };
    return typeof decoded.sessionId === 'string' ? decoded.sessionId : null;
  } catch {
    return null;
  }
}

function isSecureCameraContext(): boolean {
  if (typeof window === 'undefined') return true;
  const { protocol, hostname } = window.location;
  if (protocol === 'https:') return true;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function getApiErrorCode(err: unknown): string {
  const data = (err as { response?: { data?: { code?: string; error?: string } } }).response?.data;
  return data?.code || data?.error || '';
}

function getCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, options),
  );
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

function waitForVideoReady(video: HTMLVideoElement, timeoutMs = 10000): Promise<void> {
  const play = async () => {
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    await video.play();
  };

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return play();
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Camera preview timed out'));
    }, timeoutMs);
    const onReady = () => {
      if (video.videoWidth <= 0) return;
      cleanup();
      void play().then(resolve).catch(reject);
    };
    const onError = () => {
      cleanup();
      reject(new Error('Camera preview failed'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });
}

const QRScanPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const scanningRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'success' | 'failed'>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);
  const lastGpsCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('failed');
      return;
    }

    let cancelled = false;
    void getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 3500,
      maximumAge: 60_000,
    })
      .then((pos) => {
        if (cancelled) return;
        lastGpsCoordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsStatus('success');
      })
      .catch(() => {
        if (!cancelled) setGpsStatus('idle');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleQRDetected = useCallback(async (qrToken: string) => {
    if (!scanningRef.current) return;
    stopCamera();
    setResult(qrToken);
    setLoading(true);
    setError(null);

    try {
      if (navigator.onLine) {
        try {
          await apiClient.post(
            '/attendance/qr',
            {
              qrToken,
              gpsCoords: lastGpsCoordsRef.current ?? { lat: 0, lng: 0 },
              deviceId: getAttendanceDeviceId(),
            },
            { timeout: QR_ATTENDANCE_TIMEOUT_MS },
          );
        } catch (err: unknown) {
          const errorCode = getApiErrorCode(err);
          if (
            (errorCode !== 'GPS_REQUIRED' && errorCode !== 'GPS_OUT_OF_RANGE') ||
            !navigator.geolocation
          ) {
            throw err;
          }

          setGpsStatus('acquiring');
          let pos: GeolocationPosition;
          try {
            pos = await getCurrentPosition({
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 0,
            });
          } catch (gpsErr) {
            setGpsStatus('failed');
            throw gpsErr;
          }
          const gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          lastGpsCoordsRef.current = gpsCoords;
          setGpsStatus('success');
          await apiClient.post(
            '/attendance/qr',
            { qrToken, gpsCoords, deviceId: getAttendanceDeviceId() },
            { timeout: QR_ATTENDANCE_TIMEOUT_MS },
          );
        }
        setSuccess(true);
      } else {
        const sessionId = decodeQrSessionId(qrToken);
        if (!sessionId) {
          throw new Error('Could not read the session from this QR code. Please reconnect and scan again.');
        }
        await saveAttendanceRecord({
          id: crypto.randomUUID(),
          sessionId,
          studentId: user?.id || '',
          status: AttendanceStatus.PRESENT,
          method: 'OFFLINE_QR',
          scannedAt: new Date().toISOString(),
          synced: false,
        });
        setSuccess(true);
        setError('Saved offline. Will sync when connected.');
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to record attendance'));
    } finally {
      setLoading(false);
    }
  }, [stopCamera, user?.id]);

  const onQrDetectedRef = useRef(handleQRDetected);
  onQrDetectedRef.current = handleQRDetected;

  const scanFrame = useCallback(() => {
    if (!scanningRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (typeof window.jsQR === 'function') {
      const code = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        void onQrDetectedRef.current(code.data);
        return;
      }
    }

    animationRef.current = requestAnimationFrame(scanFrame);
  }, []);

  const startCamera = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError(null);
    setInitializing(true);

    if (!isSecureCameraContext()) {
      setError('Camera requires HTTPS. Open SAMS using https:// on your school URL (not http://).');
      setInitializing(false);
      startingRef.current = false;
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not supported in this browser. Try Chrome on Android or Safari on iPhone.');
      setInitializing(false);
      startingRef.current = false;
      return;
    }

    const hasJsQR = await waitForJsQR(10000);
    if (!hasJsQR) {
      setError('QR scanner failed to load. Check internet connection and refresh the page.');
      setInitializing(false);
      startingRef.current = false;
      return;
    }

    try {
      const video = await waitForVideoElement(videoRef);
      stopCamera();
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
      setScanning(true);
      await waitForVideoReady(video);
      scanningRef.current = true;
      scanFrame();
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Camera access denied. Allow camera permission in browser settings, then refresh.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError('Could not start camera. Tap Start Scanner to try again.');
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setScanning(false);
    } finally {
      setInitializing(false);
      startingRef.current = false;
    }
  }, [scanFrame, stopCamera]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active || success) return;
      await startCamera();
    })();
    return () => {
      active = false;
      stopCamera();
    };
  }, [startCamera, stopCamera, success]);

  return (
    <div className="page-shell p-4 sm:p-6">
      <div className="max-w-lg mx-auto">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="page-title">Scan QR Code</h1>
            <p className="text-ink-muted text-sm mt-1">Point your camera at the teacher&apos;s QR code</p>
          </div>
          <Link to="/dashboard" className="btn-secondary text-sm px-3 py-2 shrink-0">
            Back
          </Link>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            gpsStatus === 'success' ? 'bg-indigo-950/50 text-indigo-200 border border-indigo-500/30' :
            gpsStatus === 'failed' ? 'bg-red-50 text-red-300 border border-red-200' :
            gpsStatus === 'acquiring' ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30' :
            'bg-slate-800 text-ink-muted border border-line'
          }`}>
            {gpsStatus === 'idle' && 'GPS Ready'}
            {gpsStatus === 'acquiring' && 'Acquiring GPS...'}
            {gpsStatus === 'success' && 'GPS Locked'}
            {gpsStatus === 'failed' && 'GPS Unavailable'}
          </div>
        </div>

        {success && (
          <div className="mb-4 p-4 alert-success rounded-xl text-center">
            <p className="text-indigo-200 font-medium">Attendance recorded</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 alert-error rounded-xl">
            <p className="text-sm text-red-300 text-center">{error}</p>
          </div>
        )}

        <div className="surface-card p-4 sm:p-6">
          {/* Video always mounted so ref exists before getUserMedia (fixes preview-not-ready race) */}
          <div className={scanning ? 'relative' : 'sr-only'} aria-hidden={!scanning}>
            <div className="relative rounded-xl overflow-hidden border border-line">
              <video
                ref={videoRef}
                className="w-full h-64 sm:h-80 object-cover bg-black"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-indigo-400 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-10 h-10 border-t-2 border-r-2 border-indigo-400 rounded-tr-lg" />
                <div className="absolute bottom-4 left-4 w-10 h-10 border-b-2 border-l-2 border-indigo-400 rounded-bl-lg" />
                <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-indigo-400 rounded-br-lg" />
                <div className="absolute left-4 right-4 h-0.5 bg-indigo-400/80 animate-[scan_2s_ease-in-out_infinite]" style={{ top: '50%' }} />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-4">
              <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
              <p className="text-sm text-ink-muted">Scanning — hold steady</p>
            </div>
            <button type="button" onClick={stopCamera} className="mt-4 w-full btn-secondary py-2.5">
              Cancel
            </button>
          </div>

          {initializing && !success && (
            <div className="text-center py-10">
              <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-ink-muted text-sm">Opening camera...</p>
            </div>
          )}

          {!initializing && !scanning && !success && (
            <div className="text-center py-8">
              <p className="text-ink mb-6">Camera is ready. Tap below if it did not start automatically.</p>
              <button type="button" onClick={() => void startCamera()} className="btn-attendance py-3 px-8">
                Start Scanner
              </button>
            </div>
          )}

          {loading && (
            <p className="text-center text-sm text-ink-muted mt-4">Submitting attendance...</p>
          )}

          {success && (
            <div className="text-center py-4">
              <button
                type="button"
                onClick={() => {
                  setSuccess(false);
                  setResult(null);
                  setError(null);
                  setGpsStatus('idle');
                  void startCamera();
                }}
                className="btn-attendance py-3 px-8"
              >
                Scan again
              </button>
            </div>
          )}
        </div>

        {result && !success && (
          <p className="text-center text-xs text-ink-subtle mt-4 truncate">Token: {result}</p>
        )}
      </div>
    </div>
  );
};

export default QRScanPage;
