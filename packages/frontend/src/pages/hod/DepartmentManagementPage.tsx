import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import apiClient from '../../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Teacher {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

interface ClassWithTeacher {
  id: string;
  name: string;
  capacity: number;
  classTeacherId: string | null;
  classTeacherName: string | null;
}

// ─── Main Page Component ─────────────────────────────────────────────────────

const DepartmentManagementPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<ClassWithTeacher[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [teachersError, setTeachersError] = useState('');
  const [classesError, setClassesError] = useState('');

  // Assignment state
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.departmentId) return;

    // Fetch teachers
    setLoadingTeachers(true);
    setTeachersError('');
    apiClient
      .get<Teacher[]>(`/departments/${user.departmentId}/teachers`)
      .then(({ data }) => setTeachers(data))
      .catch((err: any) => {
        setTeachersError(
          err?.response?.data?.error ||
            err?.response?.data?.message ||
            'Failed to load teachers'
        );
      })
      .finally(() => setLoadingTeachers(false));

    // Fetch classes
    setLoadingClasses(true);
    setClassesError('');
    apiClient
      .get<ClassWithTeacher[]>(`/departments/${user.departmentId}/classes`)
      .then(({ data }) => setClasses(data))
      .catch((err: any) => {
        setClassesError(
          err?.response?.data?.error ||
            err?.response?.data?.message ||
            'Failed to load classes'
        );
      })
      .finally(() => setLoadingClasses(false));
  }, [user?.departmentId]);

  // ── Assignment handler ─────────────────────────────────────────────────────

  const handleAssign = async (classId: string) => {
    if (!selectedTeacherId) {
      setAssignError('Please select a teacher first.');
      return;
    }
    setAssigning(true);
    setAssignError('');
    setAssignSuccess('');
    try {
      const { data } = await apiClient.post<ClassWithTeacher & { classTeacherName: string | null }>(
        `/classes/${classId}/assign-teacher`,
        { teacherId: selectedTeacherId }
      );
      // Update the matching class in state
      setClasses((prev) =>
        prev.map((cls) =>
          cls.id === classId
            ? {
                ...cls,
                classTeacherId: data.classTeacherId,
                classTeacherName: data.classTeacherName,
              }
            : cls
        )
      );
      setAssignSuccess('Teacher assigned successfully.');
      setSelectedClassId(null);
      setSelectedTeacherId('');
    } catch (err: any) {
      setAssignError(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'Failed to assign teacher. Please try again.'
      );
    } finally {
      setAssigning(false);
    }
  };

  const openAssignForm = (classId: string) => {
    setSelectedClassId(classId);
    setSelectedTeacherId('');
    setAssignError('');
    setAssignSuccess('');
  };

  const cancelAssign = () => {
    setSelectedClassId(null);
    setSelectedTeacherId('');
    setAssignError('');
    setAssignSuccess('');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              {/* Building icon */}
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Department Management</h1>
              <p className="text-xs text-gray-400">Manage teachers and class assignments</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{user?.fullName}</span>
            <Link
              to="/dashboard"
              className="text-sm text-gray-400 hover:text-cyan-400 transition-colors"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Page title */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-1">Department Management</h2>
          <p className="text-gray-400">
            View your department's teachers and assign class teachers.
          </p>
        </div>

        {/* Global assignment success banner */}
        {assignSuccess && (
          <div className="mb-6 p-4 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-300 text-sm flex items-center justify-between">
            <span>{assignSuccess}</span>
            <button
              onClick={() => setAssignSuccess('')}
              className="ml-4 text-teal-400 hover:text-white transition-colors"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── Left column: Teachers list ── */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">
                Teachers
                {!loadingTeachers && (
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    ({teachers.length})
                  </span>
                )}
              </h3>
            </div>

            {/* Teachers error */}
            {teachersError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {teachersError}
              </div>
            )}

            {/* Teachers loading skeleton */}
            {loadingTeachers ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="h-4 w-32 bg-white/10 rounded mb-2" />
                    <div className="h-3 w-48 bg-white/10 rounded" />
                  </div>
                ))}
              </div>
            ) : teachers.length === 0 && !teachersError ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 text-sm">No teachers in this department yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {teachers.map((teacher) => (
                  <div
                    key={teacher.id}
                    className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar placeholder */}
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-blue-500/30 border border-indigo-500/20 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-indigo-300">
                          {teacher.fullName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {teacher.fullName}
                        </p>
                        {teacher.email && (
                          <p className="text-xs text-gray-400 truncate">{teacher.email}</p>
                        )}
                        {teacher.phone && !teacher.email && (
                          <p className="text-xs text-gray-400 truncate">{teacher.phone}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Right column: Classes list with assignment UI ── */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white">
                Classes
                {!loadingClasses && (
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    ({classes.length})
                  </span>
                )}
              </h3>
            </div>

            {/* Classes error */}
            {classesError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {classesError}
              </div>
            )}

            {/* Assignment inline error */}
            {assignError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center justify-between">
                <span>{assignError}</span>
                <button
                  onClick={() => setAssignError('')}
                  className="ml-4 text-red-400 hover:text-white transition-colors"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Classes loading skeleton */}
            {loadingClasses ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="h-4 w-24 bg-white/10 rounded mb-2" />
                    <div className="h-3 w-40 bg-white/10 rounded" />
                  </div>
                ))}
              </div>
            ) : classes.length === 0 && !classesError ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                </div>
                <p className="text-gray-400 text-sm">No classes in this department yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {classes.map((cls) => (
                  <div
                    key={cls.id}
                    className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                  >
                    {/* Class info row */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{cls.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Capacity: {cls.capacity}
                        </p>
                        <p className="text-xs mt-1">
                          {cls.classTeacherName ? (
                            <span className="text-teal-300">
                              Class Teacher: {cls.classTeacherName}
                            </span>
                          ) : (
                            <span className="text-gray-500 italic">
                              No class teacher assigned
                            </span>
                          )}
                        </p>
                      </div>
                      {selectedClassId !== cls.id && (
                        <button
                          onClick={() => openAssignForm(cls.id)}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 shadow-sm shadow-teal-500/20 transition-all hover:scale-[1.02]"
                        >
                          Assign Teacher
                        </button>
                      )}
                    </div>

                    {/* Inline assignment form */}
                    {selectedClassId === cls.id && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-xs font-medium text-gray-300 mb-2">
                          Select a teacher to assign:
                        </p>
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedTeacherId}
                            onChange={(e) => setSelectedTeacherId(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/50 transition-colors appearance-none"
                            disabled={assigning}
                          >
                            <option value="" className="bg-slate-800 text-gray-400">
                              — Choose a teacher —
                            </option>
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id} className="bg-slate-800 text-white">
                                {t.fullName}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssign(cls.id)}
                            disabled={assigning || !selectedTeacherId}
                            className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 shadow-sm shadow-teal-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          >
                            {assigning ? 'Assigning…' : 'Assign'}
                          </button>
                          <button
                            onClick={cancelAssign}
                            disabled={assigning}
                            className="px-3 py-2 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-500">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default DepartmentManagementPage;
