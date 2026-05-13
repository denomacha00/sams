import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { saveAttendanceRecord } from '../services/offlineStore';
import { AttendanceStatus } from '@sams/shared';
import { useAuthStore } from '../store/authStore';

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
        const { data } = await apiClient.get('/sessions?active=true');
        setSessions(data);
        if (data.length > 0) setSessionId(data[0].id);
      } catch {
        // ignore
      }
    };
    fetchSessions();
  }, []);

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
      } catch {
        // ignore
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
        await apiClient.post('/attendance/manual', {
          sessionId,
          records: entries.map((m) => ({
            studentId: m.studentId,
            status: m.status,
            note: m.note || undefined,
          })),
        });
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
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit attendance');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: AttendanceStatus) => {
    switch (status) {
      case AttendanceStatus.PRESENT: return 'text-emerald-400';
      case AttendanceStatus.LATE: return 'text-yellow-400';
      case AttendanceStatus.EXCUSED: return 'text-blue-400';
      case AttendanceStatus.ABSENT: return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Manual Attendance</h1>
          <p className="text-gray-400 text-sm mt-1">Mark attendance for each student manually</p>
        </div>

        {success && (
          <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-emerald-200 text-center">Attendance submitted successfully!</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        {/* Session selector */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <label htmlFor="session" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
            Active Session
          </label>
          <select
            id="session"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 appearance-none"
          >
            <option value="" className="bg-slate-800">-- Select Session --</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-800">
                {s.subject} — {s.className}
              </option>
            ))}
          </select>
        </div>

        {/* Student list */}
        {students.length > 0 && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Students ({students.length})</h2>
            </div>

            <div className="space-y-3">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-white/5 border border-white/5 rounded-xl"
                >
                  {/* Avatar + Name */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                      {student.fullName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{student.fullName}</p>
                      {student.admissionNumber && (
                        <p className="text-xs text-gray-500">{student.admissionNumber}</p>
                      )}
                    </div>
                  </div>

                  {/* Status dropdown */}
                  <select
                    value={marks[student.id]?.status || AttendanceStatus.PRESENT}
                    onChange={(e) => updateMark(student.id, 'status', e.target.value)}
                    className={`bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none ${getStatusColor(marks[student.id]?.status)}`}
                  >
                    <option value={AttendanceStatus.PRESENT} className="bg-slate-800 text-emerald-400">Present</option>
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
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 w-full sm:w-40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
              ))}
            </div>

            {/* Bulk actions bar */}
            <div className="mt-6 pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => markAllAs(AttendanceStatus.PRESENT)}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors"
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
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <p className="text-gray-500">No students found for this session.</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ManualAttendancePage;
