import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';

interface SessionInfo {
  valid: boolean;
  sessionId?: string;
  subject?: string;
  className?: string;
  teacherName?: string;
  expiresAt?: string;
  requireGps?: boolean;
  gpsRadiusM?: number;
  error?: string; // "EXPIRED" | "SESSION_ENDED" | "INVALID"
}

interface AttendanceResult {
  id: string;
  status: 'PRESENT' | 'LATE';
  method: string;
  scannedAt: string;
}

type PageState = 'loading' | 'info' | 'gps-pending' | 'submitting' | 'success' | 'error';

const LinkAttendancePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [pageState, setPageState] = useState<PageState>('loading');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [countdown, setCountdown] = useState<string>('');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string>('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/attend/${token}`, { replace: true });
    }
  }, [isAuthenticated, navigate, token]);

  // Fetch session info on mount
  useEffect(() => {
    if (!token || !isAuthenticated) return;

    const fetchInfo = async () => {
      try {
        const { data } = await apiClient.get<SessionInfo>(`/attendance/link/${token}/info`);
        setSessionInfo(data);

        if (!data.valid) {
          setPageState('error');
          switch (data.error) {
            case 'EXPIRED':
              setErrorMessage('Link Expired');
              setErrorDetail('This attendance link has expired. Ask your teacher for a new one.');
              break;
            case 'SESSION_ENDED':
              setErrorMessage('Session Ended');
              setErrorDetail('This attendance session has already ended.');
              break;
            case 'INVALID':
            default:
              setErrorMessage('Invalid Link');
              setErrorDetail('This attendance link is invalid or has been revoked.');
              break;
          }
        } else {
          setPageState('info');
        }
      } catch (err: any) {
        setPageState('error');
        setErrorMessage('Failed to Load');
        setErrorDetail(err.response?.data?.error || 'Could not fetch session information.');
      }
    };

    fetchInfo();
  }, [token, isAuthenticated]);

  // Countdown timer
  useEffect(() => {
    if (!sessionInfo?.expiresAt || pageState !== 'info') return;

    const updateCountdown = () => {
      const now = Date.now();
      const expiry = new Date(sessionInfo.expiresAt!).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setCountdown('Expired');
        setPageState('error');
        setErrorMessage('Link Expired');
        setErrorDetail('This attendance link has expired while you were on this page.');
        if (countdownRef.current) clearInterval(countdownRef.current);
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateCountdown();
    countdownRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [sessionInfo?.expiresAt, pageState]);

  // Request GPS on page load when info is available — only if GPS is required
  useEffect(() => {
    if (pageState !== 'info') return;
    // If the link doesn't require GPS, skip location entirely
    if (sessionInfo?.requireGps === false) return;

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setGpsError('');
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGpsError('Location permission denied. Please enable GPS to mark attendance.');
            break;
          case err.POSITION_UNAVAILABLE:
            setGpsError('Location unavailable. Please try again.');
            break;
          case err.TIMEOUT:
            setGpsError('Location request timed out. Please try again.');
            break;
          default:
            setGpsError('Could not get your location.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [pageState, sessionInfo?.requireGps]);

  const handleMarkAttendance = useCallback(async () => {
    if (!token) return;

    // If GPS is not required, submit with zeroed coords (backend will ignore them)
    if (sessionInfo?.requireGps === false) {
      submitAttendance({ lat: 0, lng: 0 });
      return;
    }

    // If no GPS yet, try to get it
    if (!gpsCoords) {
      setPageState('gps-pending');
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          })
        );
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        setGpsCoords(coords);
        submitAttendance(coords);
      } catch {
        setGpsError('Could not get your location. Please enable GPS and try again.');
        setPageState('info');
      }
      return;
    }

    submitAttendance(gpsCoords);
  }, [token, gpsCoords, sessionInfo?.requireGps]);

  const submitAttendance = async (coords: { lat: number; lng: number }) => {
    setPageState('submitting');
    setErrorMessage('');
    setErrorDetail('');

    try {
      const { data } = await apiClient.post<AttendanceResult>('/attendance/link', {
        linkToken: token,
        gpsCoords: coords,
      });
      setResult(data);
      setPageState('success');
    } catch (err: any) {
      setPageState('error');
      const errorCode = err.response?.data?.code || err.response?.data?.error || '';
      const errorMsg = err.response?.data?.error || err.response?.data?.message || '';

      if (errorCode === 'GPS_OUT_OF_RANGE' || errorMsg.includes('out of range') || errorMsg.includes('GPS')) {
        setErrorMessage('Out of Range');
        const distance = err.response?.data?.distance;
        setErrorDetail(
          distance
            ? `You are ${Math.round(distance)}m away from the class. You need to be within range to mark attendance.`
            : 'You are too far from the classroom to mark attendance.'
        );
      } else if (errorCode === 'LINK_EXPIRED' || errorMsg.includes('expired')) {
        setErrorMessage('Link Expired');
        setErrorDetail('This attendance link has expired. Ask your teacher for a new one.');
      } else if (errorCode === 'DUPLICATE_SCAN' || errorMsg.includes('already') || errorMsg.includes('duplicate')) {
        setErrorMessage('Already Recorded');
        setErrorDetail('Your attendance for this session has already been recorded.');
      } else if (errorCode === 'SESSION_ENDED' || errorMsg.includes('ended') || errorMsg.includes('not active')) {
        setErrorMessage('Session Ended');
        setErrorDetail('This attendance session has already ended.');
      } else {
        setErrorMessage('Attendance Failed');
        setErrorDetail(errorMsg || 'Something went wrong. Please try again.');
      }
    }
  };

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 border border-white/10 mb-4">
            <svg className="animate-spin h-8 w-8 text-purple-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">Loading session info...</p>
        </div>
      </div>
    );
  }

  // Success state
  if (pageState === 'success' && result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            {/* Green checkmark */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 mb-6">
              <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">Attendance Recorded!</h1>

            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-4 ${
              result.status === 'PRESENT'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                result.status === 'PRESENT' ? 'bg-emerald-400' : 'bg-yellow-400'
              }`} />
              {result.status}
            </div>

            <p className="text-gray-400 text-sm mb-6">
              Marked at {new Date(result.scannedAt).toLocaleTimeString()}
            </p>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full bg-white/10 border border-white/20 text-white font-semibold py-3 px-4 rounded-xl hover:bg-white/15 transition-all duration-200"
            >
              Go to Dashboard
            </button>
          </div>

          <p className="text-center text-xs text-gray-500 mt-6">
            © 2025 SAMS · Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            {/* Red X icon */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500/50 mb-6">
              <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">{errorMessage}</h1>
            <p className="text-gray-400 text-sm mb-6">{errorDetail}</p>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full bg-white/10 border border-white/20 text-white font-semibold py-3 px-4 rounded-xl hover:bg-white/15 transition-all duration-200"
            >
              Go to Dashboard
            </button>
          </div>

          <p className="text-center text-xs text-gray-500 mt-6">
            © 2025 SAMS · Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Info state (session details + mark attendance button)
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-purple-500/20 border border-purple-500/30 mb-4">
              <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.04a4.5 4.5 0 00-6.364-6.364L5.25 8.25" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">Link Attendance</h1>
            <p className="text-gray-400 text-sm mt-1">Confirm your presence</p>
          </div>

          {/* Session details */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Subject</span>
              <span className="text-sm font-medium text-white">{sessionInfo?.subject || '—'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Teacher</span>
              <span className="text-sm font-medium text-white">{sessionInfo?.teacherName || '—'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Class</span>
              <span className="text-sm font-medium text-white">{sessionInfo?.className || '—'}</span>
            </div>

            {/* Expiry countdown */}
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Expires in</span>
              <span className={`text-sm font-bold ${
                countdown === 'Expired' ? 'text-red-400' : 'text-emerald-400'
              }`}>
                {countdown || '—'}
              </span>
            </div>
          </div>

          {/* GPS status */}
          {sessionInfo?.requireGps === false ? (
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center gap-2">
              <svg className="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
              <p className="text-xs text-yellow-300">No GPS check — teacher has disabled location verification for this link</p>
            </div>
          ) : (
            <>
              {gpsError && (
                <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                  <p className="text-xs text-yellow-300">{gpsError}</p>
                </div>
              )}

              {gpsCoords && !gpsError && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-xs text-emerald-300">
                    GPS location acquired
                    {sessionInfo?.gpsRadiusM && (
                      <span className="text-emerald-400/70"> · must be within {sessionInfo.gpsRadiusM}m</span>
                    )}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Mark Attendance button */}
          <button
            onClick={handleMarkAttendance}
            disabled={pageState === 'submitting' || pageState === 'gps-pending'}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {pageState === 'submitting' || pageState === 'gps-pending' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {pageState === 'gps-pending' ? 'Getting location...' : 'Marking attendance...'}
              </span>
            ) : (
              'Mark Attendance'
            )}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-6">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default LinkAttendancePage;
