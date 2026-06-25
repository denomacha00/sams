import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import type { AxiosError } from 'axios';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { AttendanceStatus, UserRole } from '@sams/shared';
import { getApiErrorMessage } from '../lib/apiError';
import { getGpsErrorMessage, getTeacherLocation } from '../lib/geolocation';
import { UserAvatar } from '../components/UserAvatar';

const SESSION_START_TIMEOUT_MS = 18_000;
const ACTIVE_SESSION_REFRESH_MS = 10_000;

interface TimetableEntry {
  id: string;
  subject: string;
  className?: string;
  class?: { name?: string };
  teacherName?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
  isOpenNow?: boolean;
  isPast?: boolean;
  windowLabel?: string;
  activeSessionId?: string | null;
  activeRecordCount?: number;
}

interface ServerToday {
  dayOfWeek: number;
  dayLabel: string;
  currentMinutes: number;
}

interface AttendanceRecord {
  id: string;
  studentId?: string;
  studentName: string;
  studentAvatarUrl?: string | null;
  status: AttendanceStatus;
  method: string;
  scannedAt: string;
}

interface ActiveSession {
  id: string;
  subject: string;
  className: string;
  timetableEntryId?: string;
  hasGpsAnchor: boolean;
  qrToken: string;
  currentLinkToken?: string | null;
  linkExpiresAt?: string | null;
  startedAt: string;
  locationRadiusM: number;
  studentCount?: number;
  records: AttendanceRecord[];
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  return (hours * 60) + minutes;
}

function buildAttendanceLinkUrl(token: string): string {
  return `${window.location.origin}/attend/${token}`;
}

function decodeAttendanceLinkSettings(token: string): { requireGps?: boolean; gpsRadiusM?: number; maxUses?: number | null } {
  try {
    const [, payload] = token.split('.');
    if (!payload) return {};
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = JSON.parse(window.atob(padded)) as Record<string, unknown>;
    return {
      requireGps: typeof decoded.requireGps === 'boolean' ? decoded.requireGps : undefined,
      gpsRadiusM: typeof decoded.gpsRadiusM === 'number' ? decoded.gpsRadiusM : undefined,
      maxUses: typeof decoded.maxUses === 'number' ? decoded.maxUses : decoded.maxUses === null ? null : undefined,
    };
  } catch {
    return {};
  }
}

const SessionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverToday, setServerToday] = useState<ServerToday | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const qrPanelRef = useRef<HTMLDivElement>(null);
  const linkPanelRef = useRef<HTMLDivElement>(null);

  // Link generation state
  const [linkUrl, setLinkUrl] = useState<string>('');
  const [linkToken, setLinkToken] = useState<string>('');
  const [linkExpiresAt, setLinkExpiresAt] = useState<string>('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [expiryMinutes, setExpiryMinutes] = useState<number>(5);
  const [requireGps, setRequireGps] = useState<boolean>(true);
  const [gpsRadiusM, setGpsRadiusM] = useState<number>(100);
  const [linkLimitEnabled, setLinkLimitEnabled] = useState<boolean>(true);
  const [linkMaxUses, setLinkMaxUses] = useState<number>(1);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkTimeRemaining, setLinkTimeRemaining] = useState<number>(0);
  const linkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sessionRequireGps, setSessionRequireGps] = useState<boolean>(true);
  const [sessionRadiusM, setSessionRadiusM] = useState<number>(100);

  const normalizeSessionFromApi = useCallback((data: {
    id: string;
    subject: string;
    className?: string | null;
    timetableEntryId?: string | null;
    qrToken?: string | null;
    currentQRToken?: string | null;
    currentLinkToken?: string | null;
    linkExpiresAt?: string | null;
    hasGpsAnchor?: boolean;
    locationLat?: number | null;
    locationLng?: number | null;
    startedAt: string;
    locationRadiusM?: number;
    students?: Array<{ id: string }>;
    studentCount?: number;
    records?: AttendanceRecord[];
  }): ActiveSession => ({
      id: data.id,
      subject: data.subject,
      className: data.className ?? 'Class',
      timetableEntryId: data.timetableEntryId ?? undefined,
      hasGpsAnchor: data.hasGpsAnchor ?? (data.locationLat != null && data.locationLng != null),
      qrToken: data.qrToken ?? data.currentQRToken ?? '',
      currentLinkToken: data.currentLinkToken ?? null,
      linkExpiresAt: data.linkExpiresAt ?? null,
      startedAt: data.startedAt,
      locationRadiusM: data.locationRadiusM || 100,
      studentCount: typeof data.studentCount === 'number'
        ? data.studentCount
        : Array.isArray(data.students)
          ? data.students.length
          : undefined,
      records: data.records ?? [],
    }), []);

  const refreshActiveSessions = useCallback(async (
    options: { selectFirst?: boolean; quiet?: boolean } = {},
  ) => {
    if (!user?.id) return;

    try {
      const params: Record<string, string | boolean> = { isActive: true };
      if (user.role === UserRole.TEACHER || user.role === UserRole.HOD) {
        params.teacherId = user.id;
      }

      const { data } = await apiClient.get('/sessions', {
        params,
        timeout: 10_000,
      });
      const normalized = (Array.isArray(data) ? data : [])
        .filter((s: { isActive?: boolean }) => s.isActive !== false)
        .map(normalizeSessionFromApi);

      setActiveSessions(normalized);
      if (normalized.length === 0) {
        setQrDataUrl('');
      }
      setActiveSession((current) => {
        if (normalized.length === 0) {
          return null;
        }
        if (current) {
          const stillActive = normalized.find((session) => session.id === current.id);
          if (stillActive) {
            return {
              ...current,
              ...stillActive,
              studentCount: stillActive.studentCount ?? current.studentCount,
            };
          }
        }
        return options.selectFirst ? normalized[0] : current;
      });
    } catch (err: unknown) {
      if (!options.quiet) {
        setError(getApiErrorMessage(err, 'Could not refresh active sessions'));
      }
    }
  }, [normalizeSessionFromApi, user?.id, user?.role]);

  // Resume an in-progress session so the page is not blocked after navigation
  useEffect(() => {
    void refreshActiveSessions({ selectFirst: true, quiet: true });
  }, [refreshActiveSessions]);

  useEffect(() => {
    if (!user?.id) return;
    const timer = window.setInterval(() => {
      void refreshActiveSessions({ selectFirst: true, quiet: true });
    }, ACTIVE_SESSION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshActiveSessions, user?.id]);

  const loadAvailableEntries = useCallback(async (quiet = false) => {
    try {
      const { data } = await apiClient.get('/sessions/available', { timeout: 10_000 });
      const entries = (Array.isArray(data.entries) ? data.entries : []).map((entry: TimetableEntry) => ({
        ...entry,
        className: entry.className ?? entry.class?.name ?? 'Class',
      }));
      setServerToday(data.today ?? null);
      setTimetableEntries(entries);
    } catch (err) {
      if (!quiet) {
        setError(getApiErrorMessage(err, 'Could not load today\'s timetable'));
      }
    }
  }, []);

  // Fetch server-time timetable windows so browser timezone does not hide valid sessions.
  useEffect(() => {
    void loadAvailableEntries(false);
    const timer = window.setInterval(() => {
      void loadAvailableEntries(true);
    }, ACTIVE_SESSION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadAvailableEntries]);

  const openTimetableEntries = useMemo(
    () => timetableEntries.filter((entry) => entry.isOpenNow),
    [timetableEntries],
  );

  const canRequireGpsForLink = !!activeSession?.hasGpsAnchor;

  const nextTimetableEntry = useMemo(() => {
    return timetableEntries
      .filter((entry) => !entry.isOpenNow && !entry.isPast)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0];
  }, [timetableEntries]);

  useEffect(() => {
    if (selectedEntry && !openTimetableEntries.some((entry) => entry.id === selectedEntry)) {
      setSelectedEntry('');
      return;
    }
    if (!selectedEntry && openTimetableEntries.length === 1) {
      setSelectedEntry(openTimetableEntries[0].id);
    }
  }, [openTimetableEntries, selectedEntry]);

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
      setActiveSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSession.id) return session;
          const exists = session.records.find((r) => r.id === record.id);
          return {
            ...session,
            records: exists
              ? session.records.map((r) => r.id === record.id ? record : r)
              : [...session.records, record],
          };
        }),
      );
    };

    socket.on('attendance:new', handleAttendanceRecord);
    socket.on('attendance:updated', handleAttendanceRecord);
    socket.on('session:ended', (data: { sessionId: string }) => {
      if (data.sessionId !== activeSession.id) return;
      setActiveSessions((prev) => prev.filter((session) => session.id !== data.sessionId));
      setActiveSession(null);
      setQrDataUrl('');
      setError('This attendance session has ended.');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSession?.id, normalizeSessionFromApi]);

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

  // Restore link state when a live session already has a valid link token.
  useEffect(() => {
    if (!activeSession) {
      setLinkUrl('');
      setLinkToken('');
      setLinkExpiresAt('');
      setLinkCopied(false);
      return;
    }

    const sessionStudentCount = activeSession.studentCount;
    if (typeof sessionStudentCount === 'number' && sessionStudentCount > 0) {
      setLinkMaxUses(sessionStudentCount);
    }

    const storedToken = activeSession.currentLinkToken;
    const storedExpiry = activeSession.linkExpiresAt;
    if (storedToken && storedExpiry && new Date(storedExpiry).getTime() > Date.now()) {
      const settings = decodeAttendanceLinkSettings(storedToken);
      setLinkToken(storedToken);
      setLinkUrl(buildAttendanceLinkUrl(storedToken));
      setLinkExpiresAt(storedExpiry);
      setLinkCopied(false);
      setRequireGps(settings.requireGps ?? activeSession.hasGpsAnchor);
      if (typeof settings.gpsRadiusM === 'number') setGpsRadiusM(settings.gpsRadiusM);
      if (typeof settings.maxUses === 'number') {
        setLinkLimitEnabled(true);
        setLinkMaxUses(settings.maxUses);
      } else if (settings.maxUses === null) {
        setLinkLimitEnabled(false);
      }
      return;
    }

    setLinkUrl('');
    setLinkToken('');
    setLinkExpiresAt('');
    setLinkCopied(false);
    setRequireGps(activeSession.hasGpsAnchor);
  }, [
    activeSession?.id,
    activeSession?.hasGpsAnchor,
    activeSession?.currentLinkToken,
    activeSession?.linkExpiresAt,
    activeSession?.studentCount,
  ]);

  useEffect(() => {
    if (!activeSession?.id) return;
    let cancelled = false;

    const loadExistingRecords = async () => {
      try {
        const [sessionRes, recordsRes] = await Promise.all([
          apiClient.get(`/sessions/${activeSession.id}`),
          apiClient.get('/attendance', { params: { sessionId: activeSession.id } }),
        ]);
        if (cancelled) return;

        const students: Array<{ id: string; fullName: string; avatarUrl?: string | null }> = sessionRes.data.students ?? [];
        const nameByStudent = new Map(students.map((student) => [student.id, student.fullName]));
        const avatarByStudent = new Map(students.map((student) => [student.id, student.avatarUrl ?? null]));
        const records = (Array.isArray(recordsRes.data) ? recordsRes.data : []).map((record: {
          id: string;
          studentId: string;
          studentAvatarUrl?: string | null;
          status: AttendanceStatus;
          method: string;
          scannedAt: string;
        }): AttendanceRecord => ({
          id: record.id,
          studentId: record.studentId,
          studentName: nameByStudent.get(record.studentId) ?? 'Student',
          studentAvatarUrl: record.studentAvatarUrl ?? avatarByStudent.get(record.studentId) ?? null,
          status: record.status,
          method: record.method,
          scannedAt: record.scannedAt,
        }));
        const sessionDetails = normalizeSessionFromApi({ ...sessionRes.data, records });

        setActiveSession((current) =>
          current?.id === activeSession.id ? { ...current, ...sessionDetails, records } : current,
        );
        setActiveSessions((current) =>
          current.map((session) =>
            session.id === activeSession.id ? { ...session, ...sessionDetails, records } : session,
          ),
        );
      } catch {
        // Live socket updates still continue even if the historical load fails.
      }
    };

    void loadExistingRecords();

    return () => {
      cancelled = true;
    };
  }, [activeSession?.id]);

  const generateLink = useCallback(async () => {
    if (!activeSession) return;
    setLinkLoading(true);
    setLinkCopied(false);
    setError(null);
    try {
      if (requireGps && !canRequireGpsForLink) {
        setError(
          'GPS links need a teacher location anchor. Start or restart this session with session GPS enabled, or turn GPS off for this link.',
        );
        return;
      }

      const { data } = await apiClient.post('/attendance/link/generate', {
        sessionId: activeSession.id,
        expiryMinutes,
        requireGps,
        gpsRadiusM: requireGps ? gpsRadiusM : 100,
        maxUses: linkLimitEnabled ? linkMaxUses : null,
      });
      setLinkUrl(data.linkUrl);
      setLinkToken(data.linkToken);
      setLinkExpiresAt(data.expiresAt);
      setRequireGps(Boolean(data.requireGps));
      if (typeof data.gpsRadiusM === 'number') setGpsRadiusM(data.gpsRadiusM);
      if (typeof data.maxUses === 'number') {
        setLinkLimitEnabled(true);
        setLinkMaxUses(data.maxUses);
      } else {
        setLinkLimitEnabled(false);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to generate link'));
    } finally {
      setLinkLoading(false);
    }
  }, [activeSession, expiryMinutes, requireGps, gpsRadiusM, linkLimitEnabled, linkMaxUses, canRequireGpsForLink]);

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
      if (sessionRequireGps) {
        if (!navigator.geolocation) {
          setError(
            'Location is not available in this browser. Use HTTPS and allow GPS before starting this attendance session.',
          );
          return;
        }
        try {
          location = await getTeacherLocation(20_000);
        } catch (geoErr: unknown) {
          setError(getGpsErrorMessage(geoErr));
          return;
        }
      }

      const { data } = await apiClient.post(
        '/sessions',
        {
          timetableEntryId: selectedEntry,
          requireGps: sessionRequireGps,
          locationRadiusM: sessionRequireGps ? sessionRadiusM : 100,
          ...(location ? { location } : {}),
        },
        { timeout: SESSION_START_TIMEOUT_MS },
      );

      const normalized = normalizeSessionFromApi(data);
      setActiveSessions((current) => [
        normalized,
        ...current.filter((session) => session.id !== normalized.id),
      ]);
      setActiveSession(normalized);
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ code?: string }>;
      const code = axiosErr.response?.data?.code;
      if (code === 'OUTSIDE_SCHEDULED_TIME' || code === 'WRONG_DAY') {
        setError(getApiErrorMessage(err, 'Cannot start session outside the scheduled slot'));
      } else if (code === 'TIMETABLE_NOT_FOUND') {
        setError(
          'This class is not assigned to your account for this period. Ask your HOD to set you as the teacher on the timetable entry.',
        );
      } else if (code === 'SESSION_ALREADY_ACTIVE') {
        try {
          const params: Record<string, string | boolean> = { isActive: true };
          if (user?.role === UserRole.TEACHER && user.id) {
            params.teacherId = user.id;
          }
          const { data: sessions } = await apiClient.get('/sessions', {
            params,
          });
          const list = (Array.isArray(sessions) ? sessions : []).filter(
            (s: { isActive?: boolean }) => s.isActive !== false,
          );
          const match =
            list.find(
              (s: { timetableEntryId?: string }) => s.timetableEntryId === selectedEntry,
            ) ?? list[0];
          if (match) {
            const normalized = list.map(normalizeSessionFromApi);
            setActiveSessions(normalized);
            setActiveSession(normalizeSessionFromApi(match));
            return;
          }
        } catch {
          // fall through
        }
        setError('A session is already active for this class. Open Sign In Students to continue it.');
      } else if (axiosErr.code === 'ECONNABORTED') {
        setError('Request timed out. Check your connection and try again.');
      } else {
        setError(getApiErrorMessage(err, 'Failed to start session'));
      }
    } finally {
      setLoading(false);
    }
  };

  const endSession = async () => {
    if (!activeSession) return;
    const endedSessionId = activeSession.id;
    setLoading(true);
    try {
      await apiClient.post(`/sessions/${endedSessionId}/end`);
      const remaining = activeSessions.filter((session) => session.id !== endedSessionId);
      setActiveSessions(remaining);
      setActiveSession(remaining[0] ?? null);
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
        return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35';
      case AttendanceStatus.LATE:
        return 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30';
      case AttendanceStatus.EXCUSED:
        return 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30';
      default:
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
    }
  };

  // If no active session, show start form
  if (!activeSession) {
    return (
      <div className="page-shell p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Attendance control</p>
              <h1 className="text-2xl font-bold text-ink">Start Attendance Session</h1>
              <p className="text-ink-muted text-sm mt-1">
                Sessions open from the timetable window. Choose QR, link, manual, or face attendance after starting.
              </p>
              {serverToday && (
                <p className="text-xs text-ink-subtle mt-1">
                  School time: {serverToday.dayLabel}, {Math.floor(serverToday.currentMinutes / 60).toString().padStart(2, '0')}:
                  {(serverToday.currentMinutes % 60).toString().padStart(2, '0')}
                </p>
              )}
            </div>
            <Link to="/" className="btn-secondary px-4 py-2 text-sm w-full sm:w-auto text-center">
              Back to dashboard
            </Link>
          </div>

          {error && (
            <div className="mb-4 p-3 alert-error">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="surface-card rounded-2xl p-6 space-y-5">
            <div>
              <label htmlFor="timetableEntry" className="form-label">
                Current class / subject
              </label>
              <select
                id="timetableEntry"
                value={selectedEntry}
                onChange={(e) => setSelectedEntry(e.target.value)}
                disabled={openTimetableEntries.length === 0}
                className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 appearance-none disabled:opacity-60"
              >
                <option value="" className="bg-slate-800">
                  {openTimetableEntries.length === 0 ? 'No class open now' : 'Choose current class'}
                </option>
                {openTimetableEntries.map((entry) => (
                  <option key={entry.id} value={entry.id} className="bg-slate-800">
                    {entry.subject} — {entry.className} ({entry.startTime}–{entry.endTime})
                  </option>
                ))}
              </select>
              {timetableEntries.length === 0 ? (
                <p className="text-xs text-ink-muted mt-2">
                  No class is assigned on today's timetable. SAMS will not open an attendance session until the HOD/admin adds the timetable entry.
                </p>
              ) : openTimetableEntries.length === 0 ? (
                <p className="text-xs text-amber-200 mt-2">
                  No attendance session is open right now. Sessions can only start during the timetable window.
                  {nextTimetableEntry
                    ? ` Next: ${nextTimetableEntry.subject} (${nextTimetableEntry.startTime}-${nextTimetableEntry.endTime}).`
                    : ' Today\'s scheduled sessions are already outside the allowed window.'}
                </p>
              ) : (
                <p className="text-xs text-ink-muted mt-2">
                  The selected session will stay live until it is ended or the timetable window expires.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between p-3 bg-surface-muted border border-line rounded-xl">
              <div>
                <p className="text-sm font-medium text-ink">GPS protection</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  {sessionRequireGps
                    ? 'Students must be within your set radius when scanning'
                    : 'No location check for QR — use only with school-admin approval'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSessionRequireGps((current) => !current)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                  sessionRequireGps ? 'bg-indigo-600' : 'bg-white/20'
                }`}
                aria-pressed={sessionRequireGps}
                aria-label="Toggle GPS requirement for this session"
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
                <label htmlFor="sessionRadiusM" className="form-label">
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
                    className="flex-1 input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200"
                  />
                  <span className="text-sm text-ink-muted shrink-0">m</span>
                </div>
              </div>
            )}

            <button
              onClick={startSession}
              disabled={!selectedEntry || loading}
              className="w-full btn-primary font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-indigo-500/25 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? 'Starting...' : 'Start Session'}
            </button>
          </div>

          <aside className="surface-panel rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-ink">Today&apos;s timetable</h2>
            <div className="mt-4 space-y-3">
              {timetableEntries.length === 0 ? (
                <p className="text-sm text-ink-subtle">No timetable entries found for today.</p>
              ) : (
                timetableEntries.map((entry) => {
                  const open = Boolean(entry.isOpenNow);
                  return (
                    <div key={entry.id} className="rounded-xl border border-line bg-surface-muted p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{entry.subject}</p>
                          <p className="truncate text-xs text-ink-muted">{entry.className}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
                          open ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/10 text-ink-subtle'
                        }`}>
                          {entry.windowLabel ?? 'Check timetable'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-ink-subtle">
                        {entry.startTime}-{entry.endTime}{entry.room ? ` - ${entry.room}` : ''}
                      </p>
                      {entry.activeSessionId && (
                        <p className="mt-1 text-xs text-emerald-200">
                          Active session - {entry.activeRecordCount ?? 0} marked
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-ink-subtle mt-8">
            (c) 2025 SAMS - Developed by Denis Macharia
          </p>
        </div>
      </div>
    );
  }

  // Active session view
  return (
    <div className="page-shell p-6">
      <div className="max-w-6xl mx-auto">
        {/* Session header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-red-200">
                <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse" />
                Live session
              </span>
              <span className="text-xs text-ink-subtle">
                Started {new Date(activeSession.startedAt).toLocaleTimeString()}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-ink">{activeSession.subject}</h1>
            <p className="text-ink-muted">{activeSession.className}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/"
              className="btn-secondary py-2 px-4 text-sm font-medium transition-all duration-200"
            >
              Back dashboard
            </Link>
            <Link
              to={`/attendance?sessionId=${activeSession.id}`}
              className="btn-attendance py-2 px-4 text-sm font-medium transition-all duration-200"
            >
              Manual roll call
            </Link>
            <Link
              to={`/biometric/attendance?sessionId=${activeSession.id}`}
              className="btn-secondary py-2 px-4 text-sm font-medium transition-all duration-200"
            >
              Face attendance
            </Link>
            <button
              onClick={endSession}
              disabled={loading}
              className="btn-secondary text-red-300 border-red-500/40 hover:bg-red-500/15 py-2 px-4 disabled:opacity-50 transition-all duration-200"
            >
              End Session
            </button>
          </div>
        </div>

        {activeSessions.length > 1 && (
          <div className="surface-card rounded-2xl p-4 mb-5">
            <label htmlFor="activeSession" className="form-label">
              Active session
            </label>
            <select
              id="activeSession"
              value={activeSession.id}
              onChange={(e) => {
                const selected = activeSessions.find((session) => session.id === e.target.value);
                if (selected) {
                  setActiveSession(selected);
                  setLinkUrl('');
                  setLinkToken('');
                  setLinkExpiresAt('');
                }
              }}
              className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 appearance-none"
            >
              {activeSessions.map((session) => (
                <option key={session.id} value={session.id} className="bg-slate-800">
                  {session.subject} - {session.className}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Check-in methods */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <button
            type="button"
            onClick={() => qrPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="surface-card border border-line p-4 text-left hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-all"
          >
            <p className="text-sm font-semibold text-ink">QR scan</p>
            <p className="mt-1 text-xs text-ink-subtle">Display the rotating code</p>
          </button>
          <button
            type="button"
            onClick={() => {
              linkPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              if (!linkUrl || linkTimeRemaining <= 0) void generateLink();
            }}
            className="surface-card border border-line p-4 text-left hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-all"
          >
            <p className="text-sm font-semibold text-ink">Share link</p>
            <p className="mt-1 text-xs text-ink-subtle">Copy or share to class group</p>
          </button>
          <Link
            to={`/attendance?sessionId=${activeSession.id}`}
            className="surface-card border border-line p-4 text-left hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-all"
          >
            <p className="text-sm font-semibold text-ink">Manual roll call</p>
            <p className="mt-1 text-xs text-ink-subtle">Teacher/HOD marks students</p>
          </Link>
          <Link
            to={`/biometric/attendance?sessionId=${activeSession.id}`}
            className="surface-card border border-line p-4 text-left hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-all"
          >
            <p className="text-sm font-semibold text-ink">Face attendance</p>
            <p className="mt-1 text-xs text-ink-subtle">Camera match for enrolled students</p>
          </Link>
          <div className="surface-card border border-line p-4 text-left opacity-80">
            <p className="text-sm font-semibold text-ink">Fingerprint station</p>
            <p className="mt-1 text-xs text-ink-subtle">External scanner integration</p>
          </div>
        </div>

        {/* QR Code Display */}
        <div ref={qrPanelRef} className="surface-card rounded-2xl p-6 mb-6 text-center scroll-mt-6">
          <h2 className="text-lg font-semibold text-ink mb-4">Scan QR Code</h2>
          {qrDataUrl ? (
            <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl shadow-indigo-500/20">
              <img src={qrDataUrl} alt="Attendance QR Code" className="w-64 h-64" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="flex space-x-2">
                <div className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce" />
                <div className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          )}
          <p className="text-xs text-ink-subtle mt-4">QR refreshes automatically every 30 seconds</p>
        </div>

        {/* Link Generation Panel */}
        <div ref={linkPanelRef} className="surface-card rounded-2xl p-6 mb-6 scroll-mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-ink">Share Attendance Link</h2>
            {linkUrl && linkTimeRemaining > 0 && (
              <span className="px-3 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full text-xs font-semibold text-indigo-300">
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
                <label htmlFor="expiryMinutes" className="form-label">
                  Link Expiry
                </label>
                <select
                  id="expiryMinutes"
                  value={expiryMinutes}
                  onChange={(e) => setExpiryMinutes(Number(e.target.value))}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 appearance-none"
                >
                  <option value={5} className="bg-slate-800">5 minutes</option>
                  <option value={10} className="bg-slate-800">10 minutes</option>
                  <option value={15} className="bg-slate-800">15 minutes</option>
                  <option value={30} className="bg-slate-800">30 minutes</option>
                  <option value={60} className="bg-slate-800">60 minutes</option>
                </select>
              </div>

              {/* GPS toggle */}
              <div className="flex items-center justify-between p-3 bg-surface-muted border border-line rounded-xl">
                <div>
                  <p className="text-sm font-medium text-ink">Require GPS</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {!canRequireGpsForLink && requireGps
                      ? 'GPS selected. Restart this session with GPS on before generating a GPS link.'
                      : requireGps
                        ? 'Students must be physically present'
                        : 'No location check - use for permissions/excused'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireGps((current) => !current)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                    requireGps ? 'bg-indigo-600' : 'bg-white/20'
                  }`}
                  aria-pressed={requireGps}
                  aria-label="Toggle GPS requirement for this attendance link"
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
                  <label htmlFor="gpsRadiusM" className="form-label">
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
                      className="flex-1 input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200"
                    />
                    <span className="text-sm text-ink-muted shrink-0">m</span>
                  </div>
                  <p className="text-xs text-ink-subtle mt-1">
                    Students outside this radius will be rejected when the session has a teacher GPS anchor.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between p-3 bg-surface-muted border border-line rounded-xl">
                <div>
                  <p className="text-sm font-medium text-ink">Limit link sign-ins</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    Default is the current class size{activeSession.studentCount ? ` (${activeSession.studentCount})` : ''}. Turn off only for supervised exceptions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLinkLimitEnabled((current) => !current)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                    linkLimitEnabled ? 'bg-indigo-600' : 'bg-white/20'
                  }`}
                  aria-pressed={linkLimitEnabled}
                  aria-label="Toggle attendance link sign-in limit"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      linkLimitEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {linkLimitEnabled && (
                <div>
                  <label htmlFor="linkMaxUses" className="form-label">
                    Maximum Link Sign-ins
                  </label>
                  <input
                    id="linkMaxUses"
                    type="number"
                    min={1}
                    max={10000}
                    value={linkMaxUses}
                    onChange={(e) => setLinkMaxUses(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1)))}
                    className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200"
                  />
                  <p className="text-xs text-ink-subtle mt-1">
                    After this many students mark through the link, SAMS will reject more link marks and ask for teacher action.
                  </p>
                </div>
              )}

              <button
                onClick={generateLink}
                disabled={linkLoading}
                className="w-full btn-primary font-semibold py-3 px-5 rounded-xl shadow-lg shadow-indigo-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
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
              <div className="flex flex-wrap items-center gap-2">
                {requireGps ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 border border-indigo-500/30 text-indigo-300">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    GPS required · {gpsRadiusM}m radius
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 border border-indigo-500/30 text-indigo-300">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                    No GPS check
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-200">
                  {linkLimitEnabled ? `Limit ${linkMaxUses} sign-ins` : 'Unlimited sign-ins'}
                </span>
              </div>

              {/* Link URL display */}
              <div className="flex items-center gap-2 bg-surface-muted border border-line rounded-xl p-3">
                <div className="flex-1 truncate text-sm text-ink-muted font-mono">
                  {linkUrl}
                </div>
                <button
                  onClick={copyLink}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    linkCopied
                      ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-300'
                      : 'btn-secondary hover:bg-white/20'
                  }`}
                >
                  {linkCopied ? '✓ Copied' : 'Copy'}
                </button>
                <button
                  onClick={shareLink}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold btn-secondary hover:bg-white/20 transition-all duration-200"
                >
                  Share
                </button>
              </div>

              {/* Countdown timer */}
              {linkTimeRemaining > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-muted">Time remaining</span>
                  <span className={`text-sm font-mono font-semibold ${
                    linkTimeRemaining <= 60 ? 'text-red-400' : 'text-indigo-300'
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
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold btn-primary hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
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
                    className="text-xs text-ink-muted hover:text-ink transition-colors duration-200"
                  >
                    ↻ Regenerate link (invalidates current)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Real-time attendance list */}
        <div className="surface-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-ink">Live Attendance</h2>
            <span className="px-3 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-full text-xs font-semibold text-indigo-300">
              {activeSession.records.length} scanned
            </span>
          </div>

          {activeSession.records.length === 0 ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/5 mb-3">
                <svg className="w-6 h-6 text-ink-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-ink-subtle text-sm">Waiting for students to scan...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSession.records.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-3 surface-muted-row"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      avatarUrl={record.studentAvatarUrl}
                      fullName={record.studentName}
                      previewable
                      className="h-8 w-8 rounded-full shrink-0"
                    />
                    <div>
                      <p className="font-medium text-ink text-sm">{record.studentName}</p>
                      <p className="text-xs text-ink-subtle">
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
        <p className="text-center text-xs text-ink-subtle mt-8">
          (c) 2025 SAMS - Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default SessionPage;
