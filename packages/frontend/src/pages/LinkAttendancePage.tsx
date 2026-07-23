import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { getAttendanceDeviceId } from '../lib/attendanceDevice';
import { getAttendanceLocation, getGpsErrorMessage } from '../lib/geolocation';

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

const PENDING_LINK_ATTENDANCE_PREFIX = 'sams-pending-link-attendance:';

function pendingAttendanceKey(token: string): string {
  return `${PENDING_LINK_ATTENDANCE_PREFIX}${token}`;
}

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
  const autoSubmitAttemptedRef = useRef(false);

  // Fetch session info on mount
  useEffect(() => {
    if (!token) return;

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
  }, [token]);

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

  const handleMarkAttendance = useCallback(async () => {
    if (!token) return;

    if (!isAuthenticated) {
      sessionStorage.setItem(pendingAttendanceKey(token), '1');
      navigate(`/login?redirect=${encodeURIComponent(`/attend/${token}`)}`, { replace: true });
      return;
    }

    // If GPS is not required, submit with zeroed coords (backend will ignore them)
    if (sessionInfo?.requireGps === false) {
      submitAttendance({ lat: 0, lng: 0 });
      return;
    }

    setPageState('gps-pending');
    setGpsCoords(null);
    setGpsError('');
    try {
      const location = await getAttendanceLocation(20_000);
      const coords = { lat: location.lat, lng: location.lng };
      setGpsCoords(coords);
      await submitAttendance(coords);
    } catch (err) {
      setGpsError(getGpsErrorMessage(err));
      setPageState('info');
    }
  }, [token, isAuthenticated, navigate, sessionInfo?.requireGps]);

  async function submitAttendance(coords: { lat: number; lng: number }) {
    setPageState('submitting');
    setErrorMessage('');
    setErrorDetail('');

    try {
      const { data } = await apiClient.post<AttendanceResult>('/attendance/link', {
        linkToken: token,
        gpsCoords: coords,
        deviceId: getAttendanceDeviceId(),
      });
      setResult(data);
      setPageState('success');
    } catch (err: any) {
      const errorCode = err.response?.data?.code || err.response?.data?.error || '';
      const errorMsg = err.response?.data?.error || err.response?.data?.message || '';

      if (errorCode === 'GPS_OUT_OF_RANGE' || errorMsg.includes('out of range') || errorMsg.includes('GPS')) {
        const distance = err.response?.data?.distance;
        const detail =
          distance
            ? `You are ${Math.round(distance)}m away from the class. You need to be within range to mark attendance.`
            : 'You are too far from the classroom to mark attendance.';
        setGpsCoords(null);
        setGpsError(`${detail} Move closer, then tap Mark Attendance again.`);
        setPageState('info');
      } else if (errorCode === 'LINK_EXPIRED' || errorMsg.includes('expired')) {
        setPageState('error');
        setErrorMessage('Link Expired');
        setErrorDetail('This attendance link has expired. Ask your teacher for a new one.');
      } else if (errorCode === 'DEVICE_ALREADY_USED') {
        setPageState('error');
        setErrorMessage('Device Already Used');
        setErrorDetail('This phone/browser has already marked another student present for this session. Use your own device or ask the teacher.');
      } else if (errorCode === 'LINK_CAP_REACHED') {
        setPageState('error');
        setErrorMessage('Link Full');
        setErrorDetail('This attendance link has reached its sign-in limit. Ask your teacher for a new link or to mark you manually.');
      } else if (errorCode === 'DUPLICATE_SCAN' || errorMsg.includes('already') || errorMsg.includes('duplicate')) {
        setPageState('error');
        setErrorMessage('Already Recorded');
        setErrorDetail('Your attendance for this session has already been recorded. You cannot mark again with QR or link.');
      } else if (errorCode === 'SESSION_ENDED' || errorMsg.includes('ended') || errorMsg.includes('not active')) {
        setPageState('error');
        setErrorMessage('Session Ended');
        setErrorDetail('This attendance session has already ended.');
      } else {
        setPageState('error');
        setErrorMessage('Attendance Failed');
        setErrorDetail(errorMsg || 'Something went wrong. Please try again.');
      }
    }
  }

  useEffect(() => {
    if (!token || !isAuthenticated || pageState !== 'info' || !sessionInfo?.valid) return;
    if (autoSubmitAttemptedRef.current) return;
    if (sessionStorage.getItem(pendingAttendanceKey(token)) !== '1') return;

    autoSubmitAttemptedRef.current = true;
    sessionStorage.removeItem(pendingAttendanceKey(token));
    void handleMarkAttendance();
  }, [handleMarkAttendance, isAuthenticated, pageState, sessionInfo?.valid, token]);

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="page-shell flex items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-surface-muted border border-line mb-4">
            <svg className="animate-spin h-8 w-8 text-indigo-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-ink-muted text-sm">Loading session info...</p>
        </div>
      </div>
    );
  }

  // Success state
  if (pageState === 'success' && result) {
    return (
      <div className="page-shell flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="surface-card rounded-2xl p-8 text-center">
            {/* Success checkmark */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-brand-light border-2 border-indigo-500/50 mb-6">
              <svg className="w-10 h-10 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-ink mb-2">Attendance Recorded!</h1>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-4 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
              {result.status}
            </div>

            <p className="text-ink-muted text-sm mb-6">
              Marked at {new Date(result.scannedAt).toLocaleTimeString()}
            </p>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full btn-secondary font-semibold py-3 px-4 rounded-xl hover:bg-white/15 transition-all duration-200"
            >
              Go to Dashboard
            </button>
          </div>

          <p className="text-center text-xs text-ink-subtle mt-6">
            (c) 2025 SAMS - Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="page-shell flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="surface-card rounded-2xl p-8 text-center">
            {/* Red X icon */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500/50 mb-6">
              <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-ink mb-2">{errorMessage}</h1>
            <p className="text-ink-muted text-sm mb-6">{errorDetail}</p>

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full btn-secondary font-semibold py-3 px-4 rounded-xl hover:bg-white/15 transition-all duration-200"
            >
              Go to Dashboard
            </button>
          </div>

          <p className="text-center text-xs text-ink-subtle mt-6">
            (c) 2025 SAMS - Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Info state (session details + mark attendance button)
  return (
    <div className="page-shell flex items-center justify-center p-6">
      <div className="max-w-sm w-full">
        <div className="surface-card rounded-2xl p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-500/20 border border-indigo-500/30 mb-4">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.04a4.5 4.5 0 00-6.364-6.364L5.25 8.25" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-ink">Link Attendance</h1>
            <p className="text-ink-muted text-sm mt-1">Confirm your presence</p>
          </div>

          {/* Session details */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Unit</span>
              <span className="text-sm font-medium text-ink">{sessionInfo?.subject || '-'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Teacher</span>
              <span className="text-sm font-medium text-ink">{sessionInfo?.teacherName || '-'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Class</span>
              <span className="text-sm font-medium text-ink">{sessionInfo?.className || '-'}</span>
            </div>

            {/* Expiry countdown */}
            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Expires in</span>
              <span className={`text-sm font-bold ${
                countdown === 'Expired' ? 'text-red-400' : 'text-indigo-300'
              }`}>
                {countdown || '-'}
              </span>
            </div>
          </div>

          {/* GPS status */}
          {sessionInfo?.requireGps !== false && (
            <>
              {gpsError && (
                <div className="mb-4 p-3 alert-error rounded-xl">
                  <p className="text-xs text-red-300">{gpsError}</p>
                </div>
              )}

              {gpsCoords && !gpsError && (
                <div className="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-xs text-indigo-300">
                    GPS location acquired
                    {sessionInfo?.gpsRadiusM && (
                      <span className="text-ink-muted"> - must be within {sessionInfo.gpsRadiusM}m</span>
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
            className="w-full btn-attendance font-semibold py-3.5 px-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {pageState === 'submitting' || pageState === 'gps-pending' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {pageState === 'gps-pending' ? 'Getting location...' : 'Marking attendance...'}
              </span>
            ) : isAuthenticated ? 'Mark Attendance' : 'Sign in to mark attendance'}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-ink-subtle mt-6">
          (c) 2025 SAMS - Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default LinkAttendancePage;
