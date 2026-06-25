import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import { UserAvatar } from '../components/UserAvatar';

interface Student {
  id: string;
  fullName: string;
  username?: string;
  avatarUrl?: string | null;
  admissionNumber?: string;
  isClassRep: boolean;
  classId?: string;
  className?: string | null;
  canManageClassRep?: boolean;
}

const ClassRosterPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTeacher = user?.role === UserRole.TEACHER;
  const isViewer = user?.role === UserRole.HOD || user?.role === UserRole.SCHOOL_ADMIN;
  const canAccess = isTeacher || isViewer;
  const canAssign = isTeacher;
  const groupedStudents = students.reduce<Record<string, Student[]>>((groups, student) => {
    const key = student.className || 'Unassigned class';
    groups[key] = groups[key] ?? [];
    groups[key].push(student);
    return groups;
  }, {});
  const hasManageableStudents = students.some((student) => student.canManageClassRep);

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
    if (!canAssign || !student.canManageClassRep) return;
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
      <div className="page-shell p-8 text-center text-ink-muted">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="inner-page-header">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/dashboard" className="text-ink-muted hover:text-indigo-400 transition-colors">← Dashboard</Link>
          <h1 className="text-lg font-bold text-ink">
            {canAssign ? 'Class Representatives' : 'View Class Representatives'}
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <p className="text-sm text-ink-muted mb-6">
          {canAssign
            ? 'View students in every class you teach. Class-rep actions are only enabled for classes where you are the assigned class teacher.'
            : 'View-only list of class representatives. Only the class teacher can assign or remove a rep.'}
        </p>

        {isTeacher && students.length > 0 && !hasManageableStudents && (
          <div className="mb-6 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm">
            You can view these taught classes, but class-rep assignment is disabled until your HOD or school admin assigns you as class teacher.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        <div className="surface-card rounded-2xl overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-ink-muted">Loading students...</p>
          ) : students.length === 0 ? (
            <p className="p-8 text-center text-ink-muted">No students found for your class scope.</p>
          ) : (
            <div className="divide-y divide-white/10">
              {Object.entries(groupedStudents).map(([className, classStudents]) => (
                <section key={className}>
                  <div className="flex items-center justify-between gap-3 px-6 py-3 bg-white/5">
                    <span className="text-sm font-semibold text-ink">{className}</span>
                    <span className="text-xs text-ink-muted">
                      {classStudents.length} student{classStudents.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <ul className="divide-y divide-white/5">
                    {classStudents.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-white/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar
                      avatarUrl={s.avatarUrl}
                      fullName={s.fullName}
                      previewable
                      className="h-10 w-10 rounded-full"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{s.fullName}</p>
                      <p className="text-xs text-ink-muted">
                        {s.admissionNumber || s.username || s.id.slice(0, 8)}
                        {s.isClassRep && (
                          <span className="ml-2 inline-flex px-2 py-0.5 rounded-full bg-indigo-500/20 text-brand text-xs font-medium">
                            Class Rep
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {canAssign ? (
                    <button
                      type="button"
                      disabled={updatingId === s.id || !s.canManageClassRep}
                      title={!s.canManageClassRep ? 'Only the assigned class teacher can manage this class rep' : undefined}
                      onClick={() => toggleClassRep(s)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
                        s.isClassRep
                          ? 'bg-white/10 text-ink-muted hover:bg-white/15'
                          : 'bg-indigo-600 text-white hover:bg-indigo-500'
                      }`}
                    >
                      {updatingId === s.id ? 'Saving...' : s.isClassRep ? 'Remove rep' : 'Make class rep'}
                    </button>
                  ) : (
                    <span className="text-xs text-ink-subtle">
                      {s.isClassRep ? 'Class rep' : '—'}
                    </span>
                  )}
                </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ClassRosterPage;
