import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { saveAttendanceRecord } from '../services/offlineStore';
import { AttendanceStatus } from '@sams/shared';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../lib/apiError';

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

  const handleQRDetected = useCallback(async (qrToken: string) => {
    if (!scanningRef.current) return;
    stopCamera();
    setResult(qrToken);
    setLoading(true);
    setError(null);
    setGpsStatus('acquiring');

    try {
      let gpsCoords: { lat: number; lng: number } | undefined;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setGpsStatus('success');
        } catch {
          setGpsStatus('failed');
        }
      } else {
        setGpsStatus('failed');
      }

      if (navigator.onLine) {
        await apiClient.post('/attendance/qr', { qrToken, gpsCoords });
        setSuccess(true);
      } else {
        await saveAttendanceRecord({
          id: crypto.randomUUID(),
          sessionId: '',
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
    setError(null);
    setInitializing(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not supported in this browser. Try Chrome on Android or Safari on iPhone.');
      setInitializing(false);
      return;
    }

    const hasJsQR = await waitForJsQR(10000);
    if (!hasJsQR) {
      setError('QR scanner failed to load. Check internet connection and refresh the page.');
      setInitializing(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setError('Camera preview not ready. Tap Start Scanner to try again.');
        setInitializing(false);
        return;
      }
      video.srcObject = stream;
      await video.play();
      scanningRef.current = true;
      setScanning(true);
      scanFrame();
    } catch {
      setError('Camera access denied. Allow camera permission in browser settings, then refresh.');
    } finally {
      setInitializing(false);
    }
  }, [scanFrame]);

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
            <h1 className="text-2xl font-bold text-slate-50">Scan QR Code</h1>
            <p className="text-slate-400 text-sm mt-1">Point your camera at the teacher&apos;s QR code</p>
          </div>
          <Link to="/dashboard" className="btn-secondary text-sm px-3 py-2 shrink-0">
            Back
          </Link>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            gpsStatus === 'success' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
            gpsStatus === 'failed' ? 'bg-red-950 text-red-300 border border-red-800' :
            gpsStatus === 'acquiring' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
            'bg-slate-800 text-slate-400 border border-slate-700'
          }`}>
            {gpsStatus === 'idle' && 'GPS Ready'}
            {gpsStatus === 'acquiring' && 'Acquiring GPS...'}
            {gpsStatus === 'success' && 'GPS Locked'}
            {gpsStatus === 'failed' && 'GPS Unavailable'}
          </div>
        </div>

        {success && (
          <div className="mb-4 p-4 bg-emerald-950 border border-emerald-800 rounded-xl text-center">
            <p className="text-emerald-200 font-medium">Attendance recorded</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-xl">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        <div className="surface-card p-4 sm:p-6">
          {initializing && !scanning && !success && (
            <div className="text-center py-10">
              <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Opening camera...</p>
            </div>
          )}

          {!initializing && !scanning && !success && (
            <div className="text-center py-8">
              <p className="text-slate-300 mb-6">Camera is ready. Tap below if it did not start automatically.</p>
              <button type="button" onClick={() => void startCamera()} className="btn-primary py-3 px-8">
                Start Scanner
              </button>
            </div>
          )}

          {scanning && (
            <div className="relative">
              <div className="relative rounded-xl overflow-hidden border border-slate-700">
                <video
                  ref={videoRef}
                  className="w-full h-64 sm:h-80 object-cover bg-black"
                  playsInline
                  muted
                  autoPlay
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
                <p className="text-sm text-slate-400">Scanning — hold steady</p>
              </div>
              <button type="button" onClick={stopCamera} className="mt-4 w-full btn-secondary py-2.5">
                Cancel
              </button>
            </div>
          )}

          {loading && (
            <p className="text-center text-sm text-slate-400 mt-4">Submitting attendance...</p>
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
                className="btn-primary py-3 px-8"
              >
                Scan again
              </button>
            </div>
          )}
        </div>

        {result && !success && (
          <p className="text-center text-xs text-slate-500 mt-4 truncate">Token: {result}</p>
        )}
      </div>
    </div>
  );
};

export default QRScanPage;
