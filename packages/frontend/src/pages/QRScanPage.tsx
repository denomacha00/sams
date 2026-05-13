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

    // Simple QR detection using canvas - in production use jsQR or similar
    // For now we use a basic approach: check if jsQR is available
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

    try {
      // Capture GPS
      let gpsCoords: { lat: number; lng: number } | undefined;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          // GPS not available, continue without it
        }
      }

      if (navigator.onLine) {
        await apiClient.post('/attendance/qr', { qrToken, gpsCoords });
        setSuccess(true);
      } else {
        // Save offline
        await saveAttendanceRecord({
          id: crypto.randomUUID(),
          sessionId: '', // will be resolved from token on server
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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Scan QR Code</h1>

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-700">Attendance recorded successfully!</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          {!scanning && !success && (
            <div className="text-center">
              <p className="text-gray-600 mb-4">
                Point your camera at the QR code displayed by your teacher.
              </p>
              <button
                onClick={startCamera}
                className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700"
              >
                Start Scanner
              </button>
            </div>
          )}

          {scanning && (
            <div className="relative">
              <video
                ref={videoRef}
                className="w-full rounded-md"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 border-2 border-blue-500 rounded-md pointer-events-none" />
              <p className="text-center text-sm text-gray-500 mt-2">
                Scanning... Hold steady
              </p>
              <button
                onClick={stopCamera}
                className="mt-4 w-full bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          )}

          {success && (
            <div className="text-center py-8">
              <div className="text-green-500 text-5xl mb-4">✓</div>
              <p className="text-lg font-medium text-gray-900">Attendance Recorded</p>
              <button
                onClick={() => {
                  setSuccess(false);
                  setResult(null);
                  setError(null);
                }}
                className="mt-4 bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700"
              >
                Scan Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QRScanPage;
