import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { saveAttendanceRecord } from '../services/offlineStore';
import { AttendanceStatus } from '@sams/shared';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../lib/apiError';

interface Student {
  id: string;
  fullName: string;
  admissionNumber?: string;
}

interface MarkEntry {
  studentId: string;
  status: AttendanceStatus;
  note: string;
}

const ManualAttendancePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [students, setStudents] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkEntry>>({});
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<Array<{ id: string; subject: string; className: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch active sessions for teacher
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const { data } = await apiClient.get('/sessions', {
          params: { isActive: true, teacherId: user?.id },
        });
        const list = Array.isArray(data) ? data : [];
        setSessions(list);
        if (list.length > 0) setSessionId(list[0].id);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load active sessions'));
      }
    };
    void fetchSessions();
  }, [user?.id]);

  // Fetch students when session is selected
  useEffect(() => {
    if (!sessionId) return;
    const fetchStudents = async () => {
      try {
        const { data } = await apiClient.get(`/sessions/${sessionId}`);
        const studentList: Student[] = data.students || [];
        setStudents(studentList);
        const initial: Record<string, MarkEntry> = {};
        studentList.forEach((s) => {
          initial[s.id] = { studentId: s.id, status: AttendanceStatus.PRESENT, note: '' };
        });
        setMarks(initial);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load students for this session'));
      }
    };
    fetchStudents();
  }, [sessionId]);

  const updateMark = (studentId: string, field: 'status' | 'note', value: string) => {
    setMarks((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        [field]: value,
      },
    }));
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

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    const entries = Object.values(marks);

    try {
      if (navigator.onLine) {
        for (const entry of entries) {
          await apiClient.post('/attendance/manual', {
            sessionId,
            studentId: entry.studentId,
            status: entry.status,
            note: entry.note || undefined,
          });
        }
        setSuccess(true);
      } else {
        for (const entry of entries) {
          await saveAttendanceRecord({
            id: crypto.randomUUID(),
            sessionId,
            studentId: entry.studentId,
            status: entry.status,
            method: 'OFFLINE_MANUAL',
            note: entry.note || undefined,
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
      setLoading(false);
    }
  };

  const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
      case AttendanceStatus.PRESENT: return 'text-orange-400';
      case AttendanceStatus.LATE: return 'text-amber-700';
      case AttendanceStatus.EXCUSED: return 'text-blue-700';
      case AttendanceStatus.ABSENT: return 'text-red-700';
      default: return 'text-ink-muted';
    }
  };

  return (
    <div className="page-shell p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Manual Attendance</h1>
          <p className="text-ink-muted text-sm mt-1">Mark attendance for each student manually</p>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-indigo-500/20 border border-indigo-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-indigo-200 text-center">Attendance submitted successfully!</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-800 text-center">{error}</p>
          </div>
        )}

        {/* Session selector */}
        <div className="surface-card rounded-2xl p-6 mb-6">
          <label htmlFor="session" className="form-label">
            Active Session
          </label>
          <select
            id="session"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full input-field focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 appearance-none"
          >
            <option value="" className="bg-slate-800">-- Select Session --</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-800">
                {s.subject} — {s.className}
              </option>
            ))}
          </select>
          {sessions.length === 0 && (
            <p className="text-xs text-amber-800 mt-2">
              No active session. Start one from{' '}
              <a href="/sessions" className="text-brand hover:text-brand-hover underline">
                Sign In Students
              </a>{' '}
              first.
            </p>
          )}
        </div>

        {/* Student list */}
        {students.length > 0 && (
          <div className="surface-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ink">Students ({students.length})</h2>
            </div>

            <div className="space-y-3">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 surface-muted-row"
                >
                  {/* Avatar + Name */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {student.fullName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{student.fullName}</p>
                      {student.admissionNumber && (
                        <p className="text-xs text-ink-subtle">{student.admissionNumber}</p>
                      )}
                    </div>
                  </div>

                  {/* Status dropdown */}
                  <select
                    value={marks[student.id]?.status || AttendanceStatus.PRESENT}
                    onChange={(e) => updateMark(student.id, 'status', e.target.value)}
                    className={`bg-surface-muted border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none ${getStatusColor(marks[student.id]?.status)}`}
                  >
                    <option value={AttendanceStatus.PRESENT} className="bg-slate-800 text-orange-400">Present</option>
                    <option value={AttendanceStatus.LATE} className="bg-slate-800 text-yellow-400">Late</option>
                    <option value={AttendanceStatus.EXCUSED} className="bg-slate-800 text-blue-400">Excused</option>
                    <option value={AttendanceStatus.ABSENT} className="bg-slate-800 text-red-400">Absent</option>
                  </select>

                  {/* Note input */}
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    maxLength={500}
                    value={marks[student.id]?.note || ''}
                    onChange={(e) => updateMark(student.id, 'note', e.target.value)}
                    className="bg-surface-muted border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-subtle w-full sm:w-40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
              ))}
            </div>

            {/* Bulk actions bar */}
            <div className="mt-6 pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => markAllAs(AttendanceStatus.PRESENT)}
                  className="px-3 py-1.5 text-xs font-medium bg-orange-500/20 text-indigo-300 border border-orange-500/30 rounded-lg hover:bg-indigo-500/30 transition-colors"
                >
                  All Present
                </button>
                <button
                  onClick={() => markAllAs(AttendanceStatus.ABSENT)}
                  className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  All Absent
                </button>
              </div>
              <div className="flex-1" />
              <button
                onClick={handleSubmit}
                disabled={loading || students.length === 0}
                className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-2.5 px-6 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {loading ? 'Submitting...' : 'Submit Attendance'}
              </button>
            </div>
          </div>
        )}

        {students.length === 0 && sessionId && (
          <div className="surface-card rounded-2xl p-8 text-center">
            <p className="text-ink-subtle">No students found for this session.</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-ink-subtle mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ManualAttendancePage;
