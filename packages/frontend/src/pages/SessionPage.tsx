import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { AttendanceStatus } from '@sams/shared';
import { getApiErrorMessage } from '../lib/apiError';

interface TimetableEntry {
  id: string;
  subject: string;
  className?: string;
  class?: { name?: string };
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
}

interface AttendanceRecord {
  id: string;
  studentName: string;
  status: AttendanceStatus;
  method: string;
  scannedAt: string;
}

interface ActiveSession {
  id: string;
  subject: string;
  className: string;
  qrToken: string;
  startedAt: string;
  locationRadiusM: number;
  records: AttendanceRecord[];
}

const SessionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Link generation state
  const [linkUrl, setLinkUrl] = useState<string>('');
  const [linkToken, setLinkToken] = useState<string>('');
  const [linkExpiresAt, setLinkExpiresAt] = useState<string>('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [expiryMinutes, setExpiryMinutes] = useState<number>(5);
  const [requireGps, setRequireGps] = useState<boolean>(true);
  const [gpsRadiusM, setGpsRadiusM] = useState<number>(100);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkTimeRemaining, setLinkTimeRemaining] = useState<number>(0);
  const linkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sessionRequireGps, setSessionRequireGps] = useState<boolean>(true);
  const [sessionRadiusM, setSessionRadiusM] = useState<number>(100);

  // Fetch today's timetable entries for this teacher
  useEffect(() => {
    const fetchEntries = async () => {
      try {
        const jsDayOfWeek = new Date().getDay();
        const schemaDayOfWeek = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
        const { data } = await apiClient.get('/timetable', {
          params: {
            dayOfWeek: schemaDayOfWeek,
            ...(user?.id ? { teacherId: user.id } : {}),
          },
        });
        const entries = (Array.isArray(data) ? data : []).map((entry: TimetableEntry) => ({
          ...entry,
          className: entry.className ?? entry.class?.name ?? 'Class',
        }));
        setTimetableEntries(entries);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load today\'s timetable'));
      }
    };
    fetchEntries();
  }, [user?.id]);

  // Generate QR code image from token
  useEffect(() => {
    if (activeSession?.qrToken) {
      QRCode.toDataURL(activeSession.qrToken, { width: 300, margin: 2 })
        .then(setQrDataUrl)
        .catch(console.error);
    }
  }, [activeSession?.qrToken]);

  // Socket.io connection for real-time updates
  useEffect(() => {
    if (!activeSession) return;

    const socket = io(import.meta.env.VITE_WS_URL || window.location.origin, {
      auth: { token: useAuthStore.getState().accessToken },
    });
    socketRef.current = socket;

    // Backend expects 'session:join' (not 'join:session')
    socket.emit('session:join', { sessionId: activeSession.id });
    // Also subscribe to QR refresh events
    socket.emit('qr:subscribe', { sessionId: activeSession.id });

    socket.on('qr:refresh', (data: { sessionId: string; qrToken: string }) => {
      if (data.sessionId === activeSession.id) {
        setActiveSession((prev) =>
          prev ? { ...prev, qrToken: data.qrToken } : null
        );
      }
    });

    // Backend emits 'attendance:new' and 'attendance:updated' (not 'attendance:update')
    const handleAttendanceRecord = (record: AttendanceRecord) => {
      setActiveSession((prev) => {
        if (!prev) return null;
        const exists = prev.records.find((r) => r.id === record.id);
        if (exists) {
          // Update existing record
          return { ...prev, records: prev.records.map((r) => r.id === record.id ? record : r) };
        }
        return { ...prev, records: [...prev.records, record] };
      });
    };

    socket.on('attendance:new', handleAttendanceRecord);
    socket.on('attendance:updated', handleAttendanceRecord);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSession?.id]);

  // Link countdown timer
  useEffect(() => {
    if (!linkExpiresAt) {
      setLinkTimeRemaining(0);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.floor((new Date(linkExpiresAt).getTime() - Date.now()) / 1000));
      setLinkTimeRemaining(remaining);
      if (remaining <= 0 && linkTimerRef.current) {
        clearInterval(linkTimerRef.current);
        linkTimerRef.current = null;
      }
    };

    updateRemaining();
    linkTimerRef.current = setInterval(updateRemaining, 1000);

    return () => {
      if (linkTimerRef.current) {
        clearInterval(linkTimerRef.current);
        linkTimerRef.current = null;
      }
    };
  }, [linkExpiresAt]);

  // Clear link state when session ends
  useEffect(() => {
    if (!activeSession) {
      setLinkUrl('');
      setLinkToken('');
      setLinkExpiresAt('');
      setLinkCopied(false);
    }
  }, [activeSession]);

  const generateLink = useCallback(async () => {
    if (!activeSession) return;
    setLinkLoading(true);
    setLinkCopied(false);
    try {
      const { data } = await apiClient.post('/attendance/link/generate', {
        sessionId: activeSession.id,
        expiryMinutes,
        requireGps,
        gpsRadiusM: requireGps ? gpsRadiusM : 100,
      });
      setLinkUrl(data.linkUrl);
      setLinkToken(data.linkToken);
      setLinkExpiresAt(data.expiresAt);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to generate link'));
    } finally {
      setLinkLoading(false);
    }
  }, [activeSession, expiryMinutes, requireGps, gpsRadiusM]);

  const copyLink = useCallback(async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch {
      // Fallback: create a temporary input
      const input = document.createElement('input');
      input.value = linkUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    }
  }, [linkUrl]);

  const shareLink = useCallback(async () => {
    if (!linkUrl || !activeSession) return;
    const shareData = {
      title: 'Attendance Link',
      text: `Mark your attendance for ${activeSession.subject} (${activeSession.className})`,
      url: linkUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback to copy
        await copyLink();
      }
    } catch {
      // User cancelled share or share failed — fallback to copy
      await copyLink();
    }
  }, [linkUrl, activeSession, copyLink]);

  const formatTimeRemaining = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startSession = async () => {
    if (!selectedEntry) return;
    setLoading(true);
    setError(null);

    try {
      let location: { lat: number; lng: number } | undefined;
      if (sessionRequireGps && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
          );
          location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          setError('Could not get your location. Allow GPS or turn off "Require GPS" for this session.');
          return;
        }
      }

      const { data } = await apiClient.post('/sessions', {
        timetableEntryId: selectedEntry,
        requireGps: sessionRequireGps,
        locationRadiusM: sessionRequireGps ? sessionRadiusM : 100,
        ...(location ? { location } : {}),
      });

      setActiveSession({
        id: data.id,
        subject: data.subject,
        className: data.className ?? 'Class',
        qrToken: data.qrToken ?? data.currentQRToken ?? '',
        startedAt: data.startedAt,
        locationRadiusM: data.locationRadiusM || 100,
        records: [],
      });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to start session'));
    } finally {
      setLoading(false);
    }
  };

  const endSession = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      await apiClient.post(`/sessions/${activeSession.id}/end`);
      setActiveSession(null);
      setQrDataUrl('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to end session'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: AttendanceStatus) => {
    switch (status) {
      case AttendanceStatus.PRESENT:
        return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      case AttendanceStatus.LATE:
        return 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30';
      default:
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
    }
  };

  // If no active session, show start form
  if (!activeSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="max-w-lg mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Start Attendance Session</h1>
            <p className="text-gray-400 text-sm mt-1">Select a class to begin taking attendance</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <label htmlFor="timetableEntry" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                Select Class / Subject
              </label>
              <select
                id="timetableEntry"
                value={selectedEntry}
                onChange={(e) => setSelectedEntry(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 appearance-none"
              >
                <option value="" className="bg-slate-800">-- Select --</option>
                {timetableEntries.map((entry) => (
                  <option key={entry.id} value={entry.id} className="bg-slate-800">
                    {entry.subject} — {entry.className} ({entry.startTime}–{entry.endTime})
                  </option>
                ))}
              </select>
              {timetableEntries.length === 0 && (
                <p className="text-xs text-amber-300/90 mt-2">
                  No classes on your timetable for today. Ask your HOD or admin to add entries, or try again on the scheduled day.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl">
              <div>
                <p className="text-sm font-medium text-white">Require GPS (QR scan)</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {sessionRequireGps
                    ? 'Students must be within radius of your location when scanning'
                    : 'No location check for QR — use link GPS toggle separately if needed'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSessionRequireGps((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                  sessionRequireGps ? 'bg-purple-600' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                    sessionRequireGps ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {sessionRequireGps && (
              <div>
                <label htmlFor="sessionRadiusM" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  QR allowed radius (meters)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="sessionRadiusM"
                    type="number"
                    min={10}
                    max={10000}
                    value={sessionRadiusM}
                    onChange={(e) =>
                      setSessionRadiusM(Math.max(10, Math.min(10000, parseInt(e.target.value, 10) || 100)))
                    }
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                  />
                  <span className="text-sm text-gray-400 shrink-0">m</span>
                </div>
              </div>
            )}

            <button
              onClick={startSession}
              disabled={!selectedEntry || loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Starting...
                </span>
              ) : (
                'Start Session'
              )}
            </button>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-gray-500 mt-8">
            © 2025 SAMS · Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Active session view
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Session header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{activeSession.subject}</h1>
            <p className="text-gray-400">{activeSession.className}</p>
          </div>
          <button
            onClick={endSession}
            disabled={loading}
            className="bg-white/10 border border-red-500/30 text-red-300 py-2 px-4 rounded-xl hover:bg-red-500/20 hover:border-red-400/50 disabled:opacity-50 transition-all duration-200"
          >
            End Session
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* QR Code Display */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 text-center">
          <h2 className="text-lg font-semibold text-white mb-4">Scan QR Code</h2>
          {qrDataUrl ? (
            <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl shadow-purple-500/20">
              <img src={qrDataUrl} alt="Attendance QR Code" className="w-64 h-64" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="flex space-x-2">
                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" />
                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-4">QR refreshes automatically every 30 seconds</p>
        </div>

        {/* Link Generation Panel */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Share Attendance Link</h2>
            {linkUrl && linkTimeRemaining > 0 && (
              <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full text-xs font-semibold text-emerald-300">
                Active
              </span>
            )}
            {linkUrl && linkTimeRemaining <= 0 && (
              <span className="px-3 py-1 bg-red-500/20 border border-red-500/30 rounded-full text-xs font-semibold text-red-300">
                Expired
              </span>
            )}
          </div>

          {/* Expiry selector and generate button */}
          {(!linkUrl || linkTimeRemaining <= 0) && (
            <div className="space-y-4 mb-4">
              {/* Expiry */}
              <div>
                <label htmlFor="expiryMinutes" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  Link Expiry
                </label>
                <select
                  id="expiryMinutes"
                  value={expiryMinutes}
                  onChange={(e) => setExpiryMinutes(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 appearance-none"
                >
                  <option value={5} className="bg-slate-800">5 minutes</option>
                  <option value={10} className="bg-slate-800">10 minutes</option>
                  <option value={15} className="bg-slate-800">15 minutes</option>
                  <option value={30} className="bg-slate-800">30 minutes</option>
                  <option value={60} className="bg-slate-800">60 minutes</option>
                </select>
              </div>

              {/* GPS toggle */}
              <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-white">Require GPS</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {requireGps ? 'Students must be physically present' : 'No location check — use for permissions/excused'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireGps((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                    requireGps ? 'bg-purple-600' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      requireGps ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* GPS radius — only shown when GPS is on */}
              {requireGps && (
                <div>
                  <label htmlFor="gpsRadiusM" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                    Allowed Radius (meters)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      id="gpsRadiusM"
                      type="number"
                      min={10}
                      max={10000}
                      value={gpsRadiusM}
                      onChange={(e) => setGpsRadiusM(Math.max(10, Math.min(10000, parseInt(e.target.value) || 100)))}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200"
                    />
                    <span className="text-sm text-gray-400 shrink-0">m</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Students outside this radius will be rejected. Typical classroom: 50–150m.
                  </p>
                </div>
              )}

              <button
                onClick={generateLink}
                disabled={linkLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-5 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {linkLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating...
                  </span>
                ) : linkUrl ? 'Regenerate' : 'Generate Link'}
              </button>
            </div>
          )}

          {/* Generated link display */}
          {linkUrl && (
            <div className="space-y-3">
              {/* GPS badge */}
              <div className="flex items-center gap-2">
                {requireGps ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/20 border border-purple-500/30 text-purple-300">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    GPS required · {gpsRadiusM}m radius
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-500/20 border border-yellow-500/30 text-yellow-300">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                    No GPS check
                  </span>
                )}
              </div>

              {/* Link URL display */}
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex-1 truncate text-sm text-gray-300 font-mono">
                  {linkUrl}
                </div>
                <button
                  onClick={copyLink}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    linkCopied
                      ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                      : 'bg-white/10 border border-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {linkCopied ? '✓ Copied' : 'Copy'}
                </button>
                <button
                  onClick={shareLink}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 border border-white/10 text-white hover:bg-white/20 transition-all duration-200"
                >
                  Share
                </button>
              </div>

              {/* Countdown timer */}
              {linkTimeRemaining > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Time remaining</span>
                  <span className={`text-sm font-mono font-semibold ${
                    linkTimeRemaining <= 60 ? 'text-yellow-300' : 'text-emerald-300'
                  }`}>
                    {formatTimeRemaining(linkTimeRemaining)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-red-400 font-medium">Link expired</span>
                  <button
                    onClick={generateLink}
                    disabled={linkLoading}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
                  >
                    Regenerate
                  </button>
                </div>
              )}

              {/* Regenerate button when link is still active */}
              {linkTimeRemaining > 0 && (
                <div className="pt-2 border-t border-white/5">
                  <button
                    onClick={generateLink}
                    disabled={linkLoading}
                    className="text-xs text-gray-400 hover:text-white transition-colors duration-200"
                  >
                    ↻ Regenerate link (invalidates current)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Real-time attendance list */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Live Attendance</h2>
            <span className="px-3 py-1 bg-purple-500/20 border border-purple-500/30 rounded-full text-xs font-semibold text-purple-300">
              {activeSession.records.length} scanned
            </span>
          </div>

          {activeSession.records.length === 0 ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/5 mb-3">
                <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-500 text-sm">Waiting for students to scan...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSession.records.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                      {record.studentName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-white text-sm">{record.studentName}</p>
                      <p className="text-xs text-gray-500">
                        {record.method} • {new Date(record.scannedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusBadge(record.status)}`}>
                    {record.status}
                  </span>
                </div>
              ))}
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

export default SessionPage;
