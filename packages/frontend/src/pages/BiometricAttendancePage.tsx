import React, { useState, useRef, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { getTemplatesForClass } from '../services/offlineStore';
import { useAuthStore } from '../store/authStore';

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

  // Load cached templates from IndexedDB
  useEffect(() => {
    const loadTemplates = async () => {
      if (user?.classId) {
        const cached = await getTemplatesForClass(user.classId);
        setTemplates(cached);
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
      } else {
        setError(`No match found. Confidence: ${((data.confidence || 0) * 100).toFixed(1)}%`);
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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Biometric Attendance</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          {!cameraActive && !submitted && (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">
                Use face recognition to mark attendance. Look directly at the camera.
              </p>
              <button
                onClick={startCamera}
                className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700"
              >
                Start Camera
              </button>
            </div>
          )}

          {cameraActive && (
            <div>
              <video
                ref={videoRef}
                className="w-full rounded-md mb-4"
                playsInline
                muted
              />

              <button
                onClick={detectAndMatch}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify Face'}
              </button>

              <button
                onClick={stopCamera}
                className="mt-2 w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          )}

          {submitted && matchResult && (
            <div className="text-center py-8">
              <div className="text-green-500 text-5xl mb-4">✓</div>
              <p className="text-lg font-medium text-gray-900">Attendance Recorded</p>
              <p className="text-gray-600 mt-2">{matchResult.studentName}</p>
              <p className="text-sm text-gray-500 mt-1">
                Confidence: {(matchResult.confidence * 100).toFixed(1)}%
              </p>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setMatchResult(null);
                  startCamera();
                }}
                className="mt-4 bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700"
              >
                Next Student
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BiometricAttendancePage;
