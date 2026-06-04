import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';

interface Student {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  email: string | null;
  phone: string | null;
  isLocked: boolean;
}

const ClassStudentsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  useEffect(() => {
    if (user?.role !== 'TEACHER') return;
    apiClient.get('/users/me').then(({ data }) => {
      if (data.classId && data.classId !== user?.classId) {
        updateUser({ classId: data.classId });
      }
    }).catch(() => {});
  }, [user?.role, user?.classId, updateUser]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get('/users/class-roster')
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setStudents(list);
        if (list.length === 0) {
          setError('You are not assigned to a class, or your class has no students yet. Contact your HOD.');
        }
      })
      .catch((err: any) => setError(err.response?.data?.error || 'Failed to load students'))
      .finally(() => setLoading(false));
  }, [user?.classId]);

  const filtered = students.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.fullName.toLowerCase().includes(q) ||
      (s.admissionNumber?.toLowerCase().includes(q) ?? false) ||
      (s.email?.toLowerCase().includes(q) ?? false) ||
      (s.phone?.includes(q) ?? false)
    );
  });

  return (
    <div className="page-shell">
      <header className="inner-page-header">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">My Class Students</h1>
              <p className="text-xs text-ink-muted">{user?.fullName}</p>
            </div>
          </div>
          <Link to="/dashboard" className="text-sm text-ink-muted hover:text-cyan-400 transition-colors">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-ink">Students</h2>
            <p className="text-ink-muted text-sm mt-1">{students.length} student{students.length !== 1 ? 's' : ''} in your class</p>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6 relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, admission number, email or phone..."
            className="w-full pl-11 pr-4 py-3 bg-surface-muted border border-line rounded-xl text-ink placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand/40/40 focus:border-brand transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink text-sm">✕</button>
          )}
        </div>
        {searchQuery && <p className="text-xs text-ink-muted mb-4">{filtered.length} result{filtered.length !== 1 ? 's' : ''} found</p>}

        {error && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm mb-6">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-ink-muted py-12">Loading students...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-ink-muted mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-ink-muted">
              {searchQuery ? `No students found matching "${searchQuery}"` : 'No students in your class yet.'}
            </p>
          </div>
        ) : (
          <div className="surface-card rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">ADM No.</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Phone</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-blue-300">{s.fullName.charAt(0)}</span>
                        </div>
                        <span className="text-sm font-medium text-ink">{s.fullName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-ink-muted">{s.admissionNumber || '—'}</td>
                    <td className="px-6 py-4 text-sm text-ink-muted">{s.email || '—'}</td>
                    <td className="px-6 py-4 text-sm text-ink-muted">{s.phone || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${s.isLocked ? 'bg-red-500/20 text-red-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
                        {s.isLocked ? 'Locked' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default ClassStudentsPage;
