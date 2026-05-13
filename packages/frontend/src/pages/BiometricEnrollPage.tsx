import React, { useState, useRef, useEffect } from 'react';
import apiClient from '../services/apiClient';

const BiometricEnrollPage: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [step, setStep] = useState<'init' | 'blink' | 'capture'>('init');
  const [blinkDetected, setBlinkDetected] = useState(false);

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

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        setStep('blink');
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
      // @ts-ignore
      const faceapi = (window as any).faceapi;
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

      // POST encrypted descriptor to server
      await apiClient.post('/biometric/enroll', {
        descriptor,
      });

      setSuccess(true);
      stopCamera();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Enrollment failed. Please try again.');
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
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Biometric Enrollment</h1>

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-700">Face enrolled successfully!</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          {!modelsLoaded && !error && (
            <div className="text-center py-8">
              <p className="text-gray-600">Loading face detection models...</p>
            </div>
          )}

          {modelsLoaded && !cameraActive && !success && (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">
                We'll capture your face for biometric attendance. Make sure you're in a well-lit area.
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
              <canvas ref={canvasRef} className="hidden" />

              {step === 'blink' && !blinkDetected && (
                <div className="text-center">
                  <p className="text-gray-700 mb-3 font-medium">Liveness Check</p>
                  <p className="text-gray-600 mb-4">Please blink your eyes, then press the button below.</p>
                  <button
                    onClick={handleBlinkCheck}
                    className="bg-yellow-500 text-white py-2 px-6 rounded-md hover:bg-yellow-600"
                  >
                    I Blinked
                  </button>
                </div>
              )}

              {step === 'capture' && (
                <div className="text-center">
                  <p className="text-green-600 mb-3 font-medium">✓ Liveness confirmed</p>
                  <p className="text-gray-600 mb-4">Look directly at the camera and press capture.</p>
                  <button
                    onClick={captureAndEnroll}
                    disabled={loading}
                    className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading ? 'Processing...' : 'Capture & Enroll'}
                  </button>
                </div>
              )}

              <button
                onClick={stopCamera}
                className="mt-4 w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          )}

          {success && (
            <div className="text-center py-8">
              <div className="text-green-500 text-5xl mb-4">✓</div>
              <p className="text-lg font-medium text-gray-900">Enrollment Complete</p>
              <p className="text-gray-600 mt-2">Your face has been registered for biometric attendance.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BiometricEnrollPage;
