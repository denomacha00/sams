import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserRole } from '@sams/shared';
import apiClient from '../services/apiClient';
import { getApiErrorMessage } from '../lib/apiError';
import { useAuthStore } from '../store/authStore';

interface Student {
  id: string;
  fullName: string;
  admissionNumber?: string | null;
}

interface SessionOption {
  id: string;
  subject: string;
  className?: string | null;
  isActive?: boolean;
}

interface AttendanceRecordRow {
  studentId: string;
}

type FingerprintReaderStatus = 'unchecked' | 'checking' | 'ready' | 'missing' | 'error';

interface FingerprintReaderBridge {
  isReady: () => boolean | Promise<boolean>;
  scanStudent?: (student: {
    id: string;
    fullName: string;
    admissionNumber?: string | null;
    sessionId: string;
  }) => Promise<{ matched?: boolean; studentId?: string; message?: string } | void>;
}

declare global {
  interface Window {
    SAMS_FINGERPRINT_READER?: FingerprintReaderBridge;
  }
}

const FingerprintAttendancePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const sessionFromUrl = searchParams.get('sessionId') ?? '';

  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionId, setSessionId] = useState(sessionFromUrl);
  const [sessionLabel, setSessionLabel] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [readerStatus, setReaderStatus] = useState<FingerprintReaderStatus>('unchecked');
  const [readerMessage, setReaderMessage] = useState(
    'SAMS has not detected a supported fingerprint reader bridge on this browser.',
  );

  useEffect(() => {
    if (sessionFromUrl) setSessionId(sessionFromUrl);
  }, [sessionFromUrl]);

  useEffect(() => {
    if (!user?.id) {
      setLoadingSessions(false);
      return;
    }

    const fetchSessions = async () => {
      setLoadingSessions(true);
      setError(null);
      try {
        const params: Record<string, string | boolean> = { isActive: true };
        if (user.role === UserRole.TEACHER) params.teacherId = user.id;

        const { data } = await apiClient.get('/sessions', { params });
        const list: SessionOption[] = (Array.isArray(data) ? data : [])
          .filter((session: SessionOption) => session.isActive !== false)
          .map((session: SessionOption) => ({
            id: session.id,
            subject: session.subject,
            className: session.className ?? null,
            isActive: session.isActive,
          }));

        setSessions(list);
        setSessionId((current) => {
          if (sessionFromUrl && list.some((session) => session.id === sessionFromUrl)) return sessionFromUrl;
          if (current && list.some((session) => session.id === current)) return current;
          return list[0]?.id ?? '';
        });
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load active sessions'));
      } finally {
        setLoadingSessions(false);
      }
    };

    void fetchSessions();
  }, [sessionFromUrl, user?.id, user?.role]);

  useEffect(() => {
    if (!sessionId) {
      setStudents([]);
      setMarkedIds(new Set());
      setSessionLabel('');
      return;
    }

    const fetchRoster = async () => {
      setLoadingRoster(true);
      setError(null);
      setSuccess(null);
      try {
        const [sessionRes, recordsRes] = await Promise.all([
          apiClient.get(`/sessions/${sessionId}`),
          apiClient.get('/attendance', { params: { sessionId } }),
        ]);

        const sessionData = sessionRes.data;
        setStudents(sessionData.students ?? []);
        setSessionLabel(
          `${sessionData.subject ?? 'Session'}${sessionData.className ? ` - ${sessionData.className}` : ''}`,
        );

        const records: AttendanceRecordRow[] = Array.isArray(recordsRes.data) ? recordsRes.data : [];
        setMarkedIds(new Set(records.map((record) => record.studentId)));
      } catch (err) {
        setStudents([]);
        setMarkedIds(new Set());
        setError(getApiErrorMessage(err, 'Could not load class roster for this session'));
      } finally {
        setLoadingRoster(false);
      }
    };

    void fetchRoster();
  }, [sessionId]);

  const filteredStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((student) => {
      const name = student.fullName.toLowerCase();
      const admission = (student.admissionNumber ?? '').toLowerCase();
      return name.includes(needle) || admission.includes(needle);
    });
  }, [query, students]);

  const readerReady = readerStatus === 'ready';

  const checkFingerprintReader = useCallback(async () => {
    setReaderStatus('checking');
    setError(null);
    setSuccess(null);

    try {
      const bridge = window.SAMS_FINGERPRINT_READER;
      if (!bridge || typeof bridge.isReady !== 'function') {
        setReaderStatus('missing');
        setReaderMessage(
          'No SAMS fingerprint reader bridge was detected. Connect a supported reader and install its bridge before using fingerprint attendance.',
        );
        return;
      }

      const ready = await bridge.isReady();
      if (!ready) {
        setReaderStatus('missing');
        setReaderMessage('The fingerprint reader bridge is installed, but no ready reader was detected.');
        return;
      }

      setReaderStatus('ready');
      setReaderMessage('Fingerprint reader bridge is ready. Scan each student before saving attendance.');
    } catch (err) {
      setReaderStatus('error');
      setReaderMessage(getApiErrorMessage(err, 'Could not check the fingerprint reader.'));
    }
  }, []);

  useEffect(() => {
    void checkFingerprintReader();
  }, [checkFingerprintReader]);

  const markFingerprint = useCallback(async (student: Student) => {
    if (!sessionId) {
      setError('Choose an active session first.');
      return;
    }
    if (!readerReady) {
      setError('Fingerprint reader is not ready. Connect the reader, install the SAMS bridge, then check reader again.');
      return;
    }

    const bridge = window.SAMS_FINGERPRINT_READER;
    if (!bridge || typeof bridge.scanStudent !== 'function') {
      setError('Fingerprint scan support is not enabled. SAMS cannot safely mark fingerprint attendance from a normal click.');
      return;
    }

    setSubmittingId(student.id);
    setError(null);
    setSuccess(null);
    try {
      const scanResult = await bridge.scanStudent({
        id: student.id,
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        sessionId,
      });
      if (scanResult?.matched === false) {
        throw new Error(scanResult.message || 'Fingerprint did not match this student.');
      }
      if (scanResult?.studentId && scanResult.studentId !== student.id) {
        throw new Error('Fingerprint matched a different student. Attendance was not saved.');
      }

      await apiClient.post('/attendance/fingerprint', {
        sessionId,
        studentId: student.id,
      });
      setMarkedIds((current) => new Set(current).add(student.id));
      setSuccess(`${student.fullName} marked present by fingerprint.`);
      setQuery('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save fingerprint attendance'));
    } finally {
      setSubmittingId(null);
    }
  }, [readerReady, sessionId]);

  const noActiveSession = !loadingSessions && sessions.length === 0;

  return (
    <div className="page-shell p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Fingerprint Attendance</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Use this with an external fingerprint reader. Face attendance stays separate.
          </p>
        </div>

        {success && (
          <div className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-500/15 p-3">
            <p className="text-center text-sm text-emerald-200">{success}</p>
          </div>
        )}

        {error && (
          <div className="alert-error mb-4 p-3">
            <p className="text-center text-sm text-red-300">{error}</p>
          </div>
        )}

        {!readerReady && !noActiveSession && (
          <div className="mb-5 rounded-xl border border-accent-orange/40 bg-accent-orange/10 p-5">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-accent-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-ink">Fingerprint reader not ready</h3>
                <p className="mt-1 text-sm text-ink-muted">{readerMessage}</p>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-orange" />
                    Connect the supported external fingerprint reader to this computer.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-orange" />
                    Install the reader driver and SAMS fingerprint bridge.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-orange" />
                    Use face, QR, link, or manual attendance until the reader is detected.
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => void checkFingerprintReader()}
                  disabled={readerStatus === 'checking'}
                  className="mt-4 rounded-lg border border-accent-orange/30 bg-accent-orange/10 px-4 py-2 text-sm font-semibold text-accent-orange hover:bg-accent-orange/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {readerStatus === 'checking' ? 'Checking reader...' : 'Check reader again'}
                </button>
              </div>
            </div>
          </div>
        )}

        {readerReady && !noActiveSession && (
          <div className="mb-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-sm text-emerald-200">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="font-medium">Fingerprint reader bridge ready.</span>
              <span className="text-emerald-200/70">{readerMessage}</span>
            </div>
          </div>
        )}

        {noActiveSession ? (
          <div className="surface-card rounded-2xl p-8 text-center">
            <p className="font-medium text-ink">No active session</p>
            <p className="mt-2 text-sm text-ink-muted">
              Start a timetable session first, then return here to mark fingerprint attendance.
            </p>
            <Link to="/sessions" className="btn-primary mt-5 inline-flex rounded-xl px-6 py-2.5 font-semibold">
              Start session
            </Link>
          </div>
        ) : (
          <>
            <div className="surface-card mb-6 rounded-2xl p-6">
              <label htmlFor="session" className="form-label">
                Active session
              </label>
              {sessions.length === 1 ? (
                <p className="font-medium text-ink">{sessionLabel || sessions[0].subject}</p>
              ) : (
                <select
                  id="session"
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                  className="input-field w-full appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                >
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id} className="bg-slate-800">
                      {session.subject}
                      {session.className ? ` - ${session.className}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="surface-card rounded-2xl p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Class roster</h2>
                  <p className="text-sm text-ink-muted">
                    {markedIds.size} marked from {students.length} students
                  </p>
                </div>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search student or admission no."
                  className="input-field w-full sm:max-w-xs"
                />
              </div>

              {loadingRoster ? (
                <p className="py-10 text-center text-sm text-ink-muted">Loading students...</p>
              ) : filteredStudents.length === 0 ? (
                <p className="py-10 text-center text-sm text-ink-muted">No students found for this session.</p>
              ) : (
                <div className="divide-y divide-line">
                  {filteredStudents.map((student) => {
                    const alreadyMarked = markedIds.has(student.id);
                    return (
                      <div key={student.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-ink">{student.fullName}</p>
                          <p className="text-xs text-ink-subtle">{student.admissionNumber ?? 'No admission number'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void markFingerprint(student)}
                          disabled={!readerReady || alreadyMarked || submittingId === student.id}
                          className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                            alreadyMarked
                              ? 'border border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                              : 'btn-primary'
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {alreadyMarked
                            ? 'Already recorded'
                            : submittingId === student.id
                              ? 'Saving...'
                              : !readerReady
                                ? 'Reader not ready'
                              : 'Mark fingerprint'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FingerprintAttendancePage;
