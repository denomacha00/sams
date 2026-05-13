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
        // Initialize marks
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
        // Save offline
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Manual Attendance</h1>

        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-700">Attendance submitted successfully!</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Session selector */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label htmlFor="session" className="block text-sm font-medium text-gray-700 mb-2">
            Active Session
          </label>
          <select
            id="session"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">-- Select Session --</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.subject} — {s.className}
              </option>
            ))}
          </select>
        </div>

        {/* Student list */}
        {students.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="space-y-4">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-gray-50 rounded-md"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{student.fullName}</p>
                    {student.admissionNumber && (
                      <p className="text-xs text-gray-500">{student.admissionNumber}</p>
                    )}
                  </div>

                  <select
                    value={marks[student.id]?.status || AttendanceStatus.PRESENT}
                    onChange={(e) => updateMark(student.id, 'status', e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value={AttendanceStatus.PRESENT}>Present</option>
                    <option value={AttendanceStatus.LATE}>Late</option>
                    <option value={AttendanceStatus.EXCUSED}>Excused</option>
                    <option value={AttendanceStatus.ABSENT}>Absent</option>
                  </select>

                  <input
                    type="text"
                    placeholder="Note (optional)"
                    maxLength={500}
                    value={marks[student.id]?.note || ''}
                    onChange={(e) => updateMark(student.id, 'note', e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm w-full sm:w-48 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || students.length === 0}
              className="mt-6 w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Attendance'}
            </button>
          </div>
        )}

        {students.length === 0 && sessionId && (
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-gray-500">No students found for this session.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ManualAttendancePage;
