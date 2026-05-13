import React, { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { saveAttendanceRecord } from '../services/offlineStore';
import { AttendanceStatus } from '@sams/shared';
import { useAuthStore } from '../store/authStore';

const QRScanPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'acquiring' | 'success' | 'failed'>('idle');
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
        scanFrame();
      }
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setScanning(false);
  };

  const scanFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

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

    try {
      // @ts-ignore - jsQR loaded dynamically
      if (typeof window.jsQR !== 'undefined') {
        // @ts-ignore
        const code = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          handleQRDetected(code.data);
          return;
        }
      }
    } catch {
      // continue scanning
    }

    animationRef.current = requestAnimationFrame(scanFrame);
  }, []);

  const handleQRDetected = async (qrToken: string) => {
    stopCamera();
    setResult(qrToken);
    setLoading(true);
    setError(null);
    setGpsStatus('acquiring');

    try {
      // Capture GPS
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
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to record attendance');
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Scan QR Code</h1>
          <p className="text-gray-400 text-sm mt-1">Point your camera at the teacher's QR code</p>
        </div>

        {/* GPS Status Badge */}
        <div className="mb-4 flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            gpsStatus === 'success' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
            gpsStatus === 'failed' ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
            gpsStatus === 'acquiring' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
            'bg-white/10 text-gray-400 border border-white/10'
          }`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {gpsStatus === 'idle' && 'GPS Ready'}
            {gpsStatus === 'acquiring' && 'Acquiring GPS...'}
            {gpsStatus === 'success' && 'GPS Locked'}
            {gpsStatus === 'failed' && 'GPS Unavailable'}
          </div>
        </div>

        {/* Success message */}
        {success && (
          <div className="mb-4 p-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl backdrop-blur-sm text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/30 mb-3">
              <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-emerald-200 font-medium">Attendance Recorded!</p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        {/* Scanner card */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          {!scanning && !success && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 mb-4">
                <svg className="w-10 h-10 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
              <p className="text-gray-300 mb-6">
                Point your camera at the QR code displayed by your teacher.
              </p>
              <button
                onClick={startCamera}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
              >
                Start Scanner
              </button>
            </div>
          )}

          {scanning && (
            <div className="relative">
              {/* Camera viewfinder */}
              <div className="relative rounded-2xl overflow-hidden">
                <video
                  ref={videoRef}
                  className="w-full rounded-2xl"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* Corner brackets */}
                  <div className="absolute top-4 left-4 w-12 h-12 border-t-2 border-l-2 border-purple-400 rounded-tl-lg" />
                  <div className="absolute top-4 right-4 w-12 h-12 border-t-2 border-r-2 border-purple-400 rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 w-12 h-12 border-b-2 border-l-2 border-purple-400 rounded-bl-lg" />
                  <div className="absolute bottom-4 right-4 w-12 h-12 border-b-2 border-r-2 border-purple-400 rounded-br-lg" />
                  {/* Scan line animation */}
                  <div className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-purple-400 to-transparent animate-[scan_2s_ease-in-out_infinite]" style={{ top: '50%' }} />
                </div>
              </div>

              {/* Scan status */}
              <div className="flex items-center justify-center gap-2 mt-4">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                <p className="text-sm text-gray-400">Scanning... Hold steady</p>
              </div>

              <button
                onClick={stopCamera}
                className="mt-4 w-full bg-white/10 border border-white/20 text-white py-2.5 px-4 rounded-xl hover:bg-white/20 transition-all duration-200"
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
                  setResult(null);
                  setError(null);
                  setGpsStatus('idle');
                }}
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-8 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
              >
                Scan Again
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

export default QRScanPage;
