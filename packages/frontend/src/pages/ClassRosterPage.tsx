import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

interface Student {
  id: string;
  fullName: string;
  username?: string;
  admissionNumber?: string;
  isClassRep: boolean;
  classId?: string;
}

const ClassRosterPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAccess = user?.role === UserRole.TEACHER || user?.role === UserRole.HOD || user?.role === UserRole.SCHOOL_ADMIN;

  const fetchRoster = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/users/class-roster');
      setStudents(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to load class roster');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccess) void fetchRoster();
  }, [canAccess]);

  const toggleClassRep = async (student: Student) => {
    setUpdatingId(student.id);
    try {
      await apiClient.patch(`/users/${student.id}/class-rep`, { isClassRep: !student.isClassRep });
      await fetchRoster();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || 'Failed to update class representative');
    } finally {
      setUpdatingId(null);
    }
  };

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 text-center text-gray-400">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/dashboard" className="text-gray-400 hover:text-cyan-400 transition-colors">← Dashboard</Link>
          <h1 className="text-lg font-bold text-white">Class Representatives</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <p className="text-sm text-gray-400 mb-6">
          Class representatives can reply to messages from their teachers in the Messages inbox. Only one rep per class.
        </p>

        {user?.role === UserRole.TEACHER && !user.classId && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
            You are not assigned to a class yet. Ask your HOD or school admin to assign you to a class.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-gray-400">Loading students...</p>
          ) : students.length === 0 ? (
            <p className="p-8 text-center text-gray-400">No students found for your class scope.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {students.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-white/5">
                  <div>
                    <p className="text-white font-medium">{s.fullName}</p>
                    <p className="text-xs text-gray-400">
                      {s.admissionNumber || s.username || s.id.slice(0, 8)}
                      {s.isClassRep && (
                        <span className="ml-2 inline-flex px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium">
                          Class Rep
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={updatingId === s.id}
                    onClick={() => toggleClassRep(s)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
                      s.isClassRep
                        ? 'bg-white/10 text-gray-300 hover:bg-white/15'
                        : 'bg-indigo-600 text-white hover:bg-indigo-500'
                    }`}
                  >
                    {updatingId === s.id ? 'Saving...' : s.isClassRep ? 'Remove rep' : 'Make class rep'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
};

export default ClassRosterPage;
