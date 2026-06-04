import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { saveAttendanceRecord } from '../services/offlineStore';
import { AttendanceStatus } from '@sams/shared';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../lib/apiError';

interface Student {
  id: string;
  fullName: string;
  admissionNumber?: string | null;
}

interface SessionOption {
  id: string;
  subject: string;
  className: string | null;
  isActive?: boolean;
}

interface AttendanceRecordRow {
  id: string;
  studentId: string;
  status: AttendanceStatus;
  note?: string | null;
}

type MarkStatus = AttendanceStatus | null;

interface MarkEntry {
  studentId: string;
  status: MarkStatus;
  note: string;
  recordId?: string;
}

const STATUS_OPTIONS: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.EXCUSED,
  AttendanceStatus.ABSENT,
];

const ManualAttendancePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const sessionFromUrl = searchParams.get('sessionId') ?? '';

  const [students, setStudents] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkEntry>>({});
  const [sessionId, setSessionId] = useState(sessionFromUrl);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionLabel, setSessionLabel] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
        const { data } = await apiClient.get('/sessions', {
          params: { isActive: true, teacherId: user.id },
        });
        const list: SessionOption[] = (Array.isArray(data) ? data : [])
          .filter((s: SessionOption) => s.isActive !== false)
          .map((s: SessionOption & { className?: string | null }) => ({
            id: s.id,
            subject: s.subject,
            className: s.className ?? null,
            isActive: s.isActive,
          }));
        setSessions(list);
        setSessionId((current) => {
          if (sessionFromUrl && list.some((s) => s.id === sessionFromUrl)) {
            return sessionFromUrl;
          }
          if (current && list.some((s) => s.id === current)) {
            return current;
          }
          return list[0]?.id ?? '';
        });
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load active sessions'));
      } finally {
        setLoadingSessions(false);
      }
    };
    void fetchSessions();
  }, [user?.id, sessionFromUrl]);

  useEffect(() => {
    if (!sessionId) {
      setStudents([]);
      setMarks({});
      setSessionLabel('');
      return;
    }

    const fetchRoster = async () => {
      setLoadingRoster(true);
      setError(null);
      setSuccess(false);
      try {
        const [sessionRes, recordsRes] = await Promise.all([
          apiClient.get(`/sessions/${sessionId}`),
          apiClient.get('/attendance', { params: { sessionId } }),
        ]);

        const sessionData = sessionRes.data;
        const studentList: Student[] = sessionData.students ?? [];
        const records: AttendanceRecordRow[] = Array.isArray(recordsRes.data) ? recordsRes.data : [];

        setStudents(studentList);
        setSessionLabel(
          `${sessionData.subject ?? 'Session'}${sessionData.className ? ` — ${sessionData.className}` : ''}`,
        );

        const recordByStudent = new Map(records.map((r) => [r.studentId, r]));
        const initial: Record<string, MarkEntry> = {};
        studentList.forEach((s) => {
          const existing = recordByStudent.get(s.id);
          initial[s.id] = {
            studentId: s.id,
            status: existing ? (existing.status as AttendanceStatus) : null,
            note: existing?.note ?? '',
            recordId: existing?.id,
          };
        });
        setMarks(initial);
      } catch (err) {
        setStudents([]);
        setMarks({});
        setError(getApiErrorMessage(err, 'Could not load class roster for this session'));
      } finally {
        setLoadingRoster(false);
      }
    };

    void fetchRoster();
  }, [sessionId]);

  const setStudentStatus = useCallback((studentId: string, status: MarkStatus) => {
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        studentId,
        status,
        note: prev[studentId]?.note ?? '',
        recordId: prev[studentId]?.recordId,
      },
    }));
  }, []);

  const togglePresent = (studentId: string) => {
    const current = marks[studentId]?.status;
    if (current === AttendanceStatus.PRESENT) {
      setStudentStatus(studentId, null);
    } else {
      setStudentStatus(studentId, AttendanceStatus.PRESENT);
    }
  };

  const markAllAs = (status: AttendanceStatus) => {
    setMarks((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((id) => {
        updated[id] = { ...updated[id], status };
      });
      return updated;
    });
  };

  const markedCount = Object.values(marks).filter((m) => m.status !== null).length;
  const presentCount = Object.values(marks).filter((m) => m.status === AttendanceStatus.PRESENT).length;

  const handleSubmit = async () => {
    const entries = Object.values(marks).filter((e) => e.status !== null) as Array<
      MarkEntry & { status: AttendanceStatus }
    >;

    if (entries.length === 0) {
      setError('Mark at least one student (tap a name or use All Present) before submitting.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      if (navigator.onLine) {
        await Promise.all(
          entries.map((entry) =>
            apiClient.post('/attendance/manual', {
              sessionId,
              studentId: entry.studentId,
              status: entry.status,
              note: entry.note.trim() || undefined,
            }),
          ),
        );
        setSuccess(true);
      } else {
        for (const entry of entries) {
          await saveAttendanceRecord({
            id: crypto.randomUUID(),
            sessionId,
            studentId: entry.studentId,
            status: entry.status,
            method: 'OFFLINE_MANUAL',
            note: entry.note.trim() || undefined,
            scannedAt: new Date().toISOString(),
            synced: false,
          });
        }
        setSuccess(true);
        setError('Saved offline. Will sync when connected.');
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to submit attendance'));
    } finally {
      setSubmitting(false);
    }
  };

  const statusChipClass = (status: AttendanceStatus, selected: boolean) => {
    if (!selected) {
      return 'border-line text-ink-muted hover:border-white/25 hover:text-ink';
    }
    switch (status) {
      case AttendanceStatus.PRESENT:
        return 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300';
      case AttendanceStatus.LATE:
        return 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200';
      case AttendanceStatus.EXCUSED:
        return 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200';
      case AttendanceStatus.ABSENT:
        return 'border-red-500/50 bg-red-500/20 text-red-300';
      default:
        return 'border-line text-ink-muted';
    }
  };

  const noActiveSession = !loadingSessions && sessions.length === 0;

  return (
    <div className="page-shell p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Manual Attendance</h1>
          <p className="text-ink-muted text-sm mt-1">
            Tap each student to mark present, or set Late / Absent / Excused
          </p>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-emerald-500/15 border border-emerald-500/35 rounded-xl">
            <p className="text-sm text-emerald-200 text-center">Attendance saved successfully.</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-300 text-center">{error}</p>
          </div>
        )}

        {noActiveSession ? (
          <div className="surface-card rounded-2xl p-8 text-center space-y-4">
            <p className="text-ink font-medium">No active session</p>
            <p className="text-sm text-ink-muted">
              Start a session from Sign In Students, then return here to mark the class roll.
            </p>
            <Link
              to="/sessions"
              className="inline-flex items-center justify-center btn-primary font-semibold py-2.5 px-6 rounded-xl"
            >
              Start session
            </Link>
          </div>
        ) : (
          <>
            <div className="surface-card rounded-2xl p-6 mb-6">
              <label htmlFor="session" className="form-label">
                Active session
              </label>
              {sessions.length === 1 ? (
                <p className="text-ink font-medium">{sessionLabel || sessions[0].subject}</p>
              ) : (
                <select
                  id="session"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id} className="bg-slate-800">
                      {s.subject}
                      {s.className ? ` — ${s.className}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {sessionLabel && sessions.length > 1 && (
                <p className="text-xs text-ink-subtle mt-2">{sessionLabel}</p>
              )}
            </div>

            {loadingRoster ? (
              <div className="surface-card rounded-2xl p-10 text-center">
                <p className="text-ink-muted text-sm">Loading class roster…</p>
              </div>
            ) : students.length === 0 && sessionId ? (
              <div className="surface-card rounded-2xl p-8 text-center space-y-2">
                <p className="text-ink-subtle">No students in this class.</p>
                <p className="text-xs text-ink-muted">
                  Assign students to the class in user management, then refresh.
                </p>
              </div>
            ) : students.length > 0 ? (
              <div className="surface-card rounded-2xl p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h2 className="text-lg font-semibold text-ink">
                    Class roster ({students.length})
                  </h2>
                  <span className="text-xs text-ink-muted">
                    {presentCount} present · {markedCount} marked
                  </span>
                </div>

                <div className="space-y-3">
                  {students.map((student) => {
                    const mark = marks[student.id];
                    const status = mark?.status ?? null;
                    const isPresent = status === AttendanceStatus.PRESENT;

                    return (
                      <div
                        key={student.id}
                        className={`rounded-xl border p-4 transition-all duration-200 ${
                          isPresent
                            ? 'border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.15)]'
                            : status === AttendanceStatus.ABSENT
                              ? 'border-red-500/25 bg-red-500/5 surface-muted-row'
                              : 'border-line surface-muted-row'
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <button
                            type="button"
                            onClick={() => togglePresent(student.id)}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                          >
                            <div
                              className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors ${
                                isPresent
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-indigo-600/80 text-white'
                              }`}
                            >
                              {isPresent ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                student.fullName.charAt(0)
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink truncate">{student.fullName}</p>
                              {student.admissionNumber && (
                                <p className="text-xs text-ink-subtle">{student.admissionNumber}</p>
                              )}
                              <p className="text-xs mt-0.5 text-ink-muted sm:hidden">
                                {isPresent ? 'Present — tap to clear' : 'Tap to mark present'}
                              </p>
                            </div>
                            {isPresent && (
                              <span className="hidden sm:inline-flex px-2.5 py-1 text-xs font-semibold rounded-full border border-emerald-500/40 bg-emerald-500/20 text-emerald-300">
                                Present
                              </span>
                            )}
                          </button>

                          <div className="flex flex-wrap gap-1.5 sm:justify-end">
                            {STATUS_OPTIONS.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() =>
                                  setStudentStatus(
                                    student.id,
                                    status === opt ? null : opt,
                                  )
                                }
                                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${statusChipClass(
                                  opt,
                                  status === opt,
                                )}`}
                              >
                                {opt.charAt(0) + opt.slice(1).toLowerCase()}
                              </button>
                            ))}
                          </div>
                        </div>

                        <input
                          type="text"
                          placeholder="Note (optional)"
                          maxLength={500}
                          value={mark?.note ?? ''}
                          onChange={(e) =>
                            setMarks((prev) => ({
                              ...prev,
                              [student.id]: {
                                ...prev[student.id],
                                studentId: student.id,
                                status: prev[student.id]?.status ?? null,
                                note: e.target.value,
                                recordId: prev[student.id]?.recordId,
                              },
                            }))
                          }
                          className="mt-3 w-full bg-surface-muted border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => markAllAs(AttendanceStatus.PRESENT)}
                      className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 rounded-lg hover:bg-emerald-500/30 transition-colors"
                    >
                      All present
                    </button>
                    <button
                      type="button"
                      onClick={() => markAllAs(AttendanceStatus.ABSENT)}
                      className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
                    >
                      All absent
                    </button>
                  </div>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || markedCount === 0}
                    className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-semibold py-2.5 px-6 rounded-xl shadow-lg shadow-indigo-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    {submitting ? 'Saving…' : `Save attendance (${markedCount})`}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}

        <p className="text-center text-xs text-ink-subtle mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ManualAttendancePage;
