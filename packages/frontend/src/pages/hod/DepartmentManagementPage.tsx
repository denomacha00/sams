import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import apiClient from '../../services/apiClient';
import { UserAvatar } from '../../components/UserAvatar';

interface Teacher {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl?: string | null;
}

interface ClassWithTeacher {
  id: string;
  name: string;
  capacity: number;
  classTeacherId: string | null;
  classTeacherName: string | null;
}

interface Student {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  avatarUrl?: string | null;
  classId: string | null;
  email: string | null;
  phone: string | null;
}

interface StudentClassGroup {
  id: string;
  name: string;
  capacity: number | null;
  classTeacherName: string | null;
  students: Student[];
}

const DepartmentManagementPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<ClassWithTeacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [teachersError, setTeachersError] = useState('');
  const [classesError, setClassesError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudentClassId, setSelectedStudentClassId] = useState('all');
  const [activeTab, setActiveTab] = useState<'teachers' | 'classes' | 'students'>('teachers');

  // Assignment state
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');
  const [newClassName, setNewClassName] = useState('');
  const [newClassCapacity, setNewClassCapacity] = useState(50);
  const [addingClass, setAddingClass] = useState(false);
  const [addClassError, setAddClassError] = useState('');

  useEffect(() => {
    if (!user?.departmentId) return;

    setLoadingTeachers(true);
    apiClient.get<Teacher[]>(`/departments/${user.departmentId}/teachers`)
      .then(({ data }) => setTeachers(data))
      .catch((err: any) => setTeachersError(err?.response?.data?.error || 'Failed to load teachers'))
      .finally(() => setLoadingTeachers(false));

    setLoadingClasses(true);
    apiClient.get<ClassWithTeacher[]>(`/departments/${user.departmentId}/classes`)
      .then(({ data }) => setClasses(data))
      .catch((err: any) => setClassesError(err?.response?.data?.error || 'Failed to load classes'))
      .finally(() => setLoadingClasses(false));

    setLoadingStudents(true);
    apiClient.get('/users', { params: { role: 'STUDENT', departmentId: user.departmentId } })
      .then(({ data }) => setStudents(data.users || data || []))
      .catch(() => setStudents([]))
      .finally(() => setLoadingStudents(false));
  }, [user?.departmentId]);

  const handleAssign = async (classId: string) => {
    if (!selectedTeacherId) { setAssignError('Please select a teacher first.'); return; }
    setAssigning(true);
    setAssignError('');
    setAssignSuccess('');
    try {
      const { data } = await apiClient.post<ClassWithTeacher & { classTeacherName: string | null }>(
        `/classes/${classId}/assign-teacher`,
        { teacherId: selectedTeacherId }
      );
      setClasses((prev) => prev.map((cls) =>
        cls.id === classId ? { ...cls, classTeacherId: data.classTeacherId, classTeacherName: data.classTeacherName } : cls
      ));
      setAssignSuccess('Teacher assigned successfully.');
      setSelectedClassId(null);
      setSelectedTeacherId('');
    } catch (err: any) {
      setAssignError(err?.response?.data?.error || 'Failed to assign teacher.');
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

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.departmentId) return;
    if (!newClassName.trim()) {
      setAddClassError('Class name is required.');
      return;
    }
    setAddingClass(true);
    setAddClassError('');
    setAssignSuccess('');
    try {
      const { data } = await apiClient.post<ClassWithTeacher>('/classes', {
        name: newClassName.trim(),
        capacity: newClassCapacity,
        departmentId: user.departmentId,
      });
      setClasses((prev) => [...prev, { ...data, classTeacherName: data.classTeacherName ?? null }]);
      setNewClassName('');
      setNewClassCapacity(50);
      setAssignSuccess('Class added to your department.');
    } catch (err: any) {
      setAddClassError(err?.response?.data?.error || 'Failed to add class.');
    } finally {
      setAddingClass(false);
    }
  };

  const studentsWithoutClass = useMemo(
    () => students.filter((student) => !student.classId).length,
    [students],
  );

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((student) => {
      const matchesClass =
        selectedStudentClassId === 'all' ||
        (selectedStudentClassId === 'unassigned' && !student.classId) ||
        student.classId === selectedStudentClassId;
      if (!matchesClass) return false;
      if (!q) return true;
      return [
        student.fullName,
        student.admissionNumber,
        student.email,
        student.phone,
      ].some((value) => value?.toLowerCase().includes(q));
    });
  }, [searchQuery, selectedStudentClassId, students]);

  const studentClassGroups = useMemo<StudentClassGroup[]>(() => {
    const groups = classes.map((cls) => ({
      id: cls.id,
      name: cls.name,
      capacity: cls.capacity,
      classTeacherName: cls.classTeacherName,
      students: [] as Student[],
    }));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const unassignedGroup: StudentClassGroup = {
      id: 'unassigned',
      name: 'Unassigned class',
      capacity: null,
      classTeacherName: null,
      students: [],
    };

    filteredStudents.forEach((student) => {
      if (student.classId && groupById.has(student.classId)) {
        groupById.get(student.classId)!.students.push(student);
      } else {
        unassignedGroup.students.push(student);
      }
    });

    if (selectedStudentClassId === 'unassigned') {
      return unassignedGroup.students.length > 0 ? [unassignedGroup] : [];
    }

    if (selectedStudentClassId !== 'all') {
      const selected = groupById.get(selectedStudentClassId);
      return selected && selected.students.length > 0 ? [selected] : [];
    }

    return [
      ...groups.filter((group) => group.students.length > 0),
      ...(unassignedGroup.students.length > 0 ? [unassignedGroup] : []),
    ];
  }, [classes, filteredStudents, selectedStudentClassId]);

  return (
    <div className="page-shell">
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">Department Management</h1>
              <p className="text-xs text-ink-muted">Manage teachers, classes and students</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-muted">{user?.fullName}</span>
            <Link to="/dashboard" className="text-sm text-ink-muted hover:text-indigo-400 transition-colors">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-ink mb-1">Department Management</h2>
          <p className="text-ink-muted">View and manage your department's teachers, classes and students.</p>
        </div>

        {assignSuccess && (
          <div className="mb-6 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm flex items-center justify-between">
            <span>{assignSuccess}</span>
            <button onClick={() => setAssignSuccess('')} className="ml-4 text-indigo-400 hover:text-ink">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['teachers', 'classes', 'students'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-white/5 text-ink-muted hover:bg-white/10 hover:text-ink border border-white/10'
              }`}
            >
              {tab} ({tab === 'teachers' ? teachers.length : tab === 'classes' ? classes.length : students.length})
            </button>
          ))}
        </div>

        {/* Search for students */}
        {activeTab === 'students' && (
          <div className="mb-6 rounded-2xl border border-line bg-surface-muted p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="relative">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, admission number, phone, or email..."
                  className="w-full pl-11 pr-4 py-3 bg-surface-elevated border border-line rounded-xl text-ink placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand transition-all"
                />
              </div>

              <select
                value={selectedStudentClassId}
                onChange={(e) => setSelectedStudentClassId(e.target.value)}
                className="input-field"
                aria-label="Filter students by class"
              >
                <option value="all">All classes</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
                {studentsWithoutClass > 0 && <option value="unassigned">Unassigned class</option>}
              </select>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Showing {filteredStudents.length} of {students.length} department student{students.length === 1 ? '' : 's'}.
              {selectedStudentClassId === 'all' ? ' Students are separated by class below.' : ' Use All classes to see the grouped department view.'}
            </p>
          </div>
        )}

        {/* Teachers Tab */}
        {activeTab === 'teachers' && (
          <div className="space-y-3">
            {teachersError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{teachersError}</div>}
            {loadingTeachers ? (
              <div className="text-center text-ink-muted py-8">Loading teachers...</div>
            ) : teachers.length === 0 ? (
              <div className="text-center text-ink-muted py-8">No teachers in this department yet.</div>
            ) : teachers.map((teacher) => (
              <div key={teacher.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center gap-3">
                <UserAvatar
                  avatarUrl={teacher.avatarUrl}
                  fullName={teacher.fullName}
                  className="h-10 w-10 rounded-full shrink-0"
                />
                <div>
                  <p className="text-sm font-semibold text-ink">{teacher.fullName}</p>
                  <p className="text-xs text-ink-muted">{teacher.email || teacher.phone || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Classes Tab */}
        {activeTab === 'classes' && (
          <div className="space-y-3">
            {classesError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{classesError}</div>}
            <form onSubmit={handleAddClass} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_8rem_auto] gap-3">
                <input
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="New class name"
                  className="input-field"
                  disabled={addingClass}
                />
                <input
                  type="number"
                  min={1}
                  value={newClassCapacity}
                  onChange={(e) => setNewClassCapacity(Math.max(1, Number(e.target.value) || 50))}
                  className="input-field"
                  disabled={addingClass}
                  aria-label="Class capacity"
                />
                <button
                  type="submit"
                  disabled={addingClass || !newClassName.trim()}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-indigo-700 disabled:opacity-50"
                >
                  {addingClass ? 'Adding...' : 'Add class'}
                </button>
              </div>
              {addClassError && <p className="mt-2 text-xs text-red-300">{addClassError}</p>}
            </form>
            {assignError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-center justify-between">
                <span>{assignError}</span>
                <button onClick={() => setAssignError('')} className="ml-4 text-red-400 hover:text-ink">✕</button>
              </div>
            )}
            {loadingClasses ? (
              <div className="text-center text-ink-muted py-8">Loading classes...</div>
            ) : classes.length === 0 ? (
              <div className="text-center text-ink-muted py-8">No classes in this department yet.</div>
            ) : classes.map((cls) => (
              <div key={cls.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{cls.name}</p>
                    <p className="text-xs text-ink-muted">Capacity: {cls.capacity}</p>
                    <p className="text-xs mt-1">
                      {cls.classTeacherName
                        ? <span className="text-indigo-300">Class Teacher: {cls.classTeacherName}</span>
                        : <span className="text-ink-subtle italic">No class teacher assigned</span>}
                    </p>
                  </div>
                  {selectedClassId !== cls.id && (
                    <button onClick={() => openAssignForm(cls.id)} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-700 transition-all">
                      Assign Teacher
                    </button>
                  )}
                </div>
                {selectedClassId === cls.id && (
                  <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
                    <select
                      value={selectedTeacherId}
                      onChange={(e) => setSelectedTeacherId(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl bg-surface-muted border border-line text-white text-sm focus:outline-none focus:border-brand/50 transition-colors"
                      disabled={assigning}
                    >
                      <option value="" className="bg-slate-800">— Choose a teacher —</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id} className="bg-slate-800">{t.fullName}</option>
                      ))}
                    </select>
                    <button onClick={() => handleAssign(cls.id)} disabled={assigning || !selectedTeacherId} className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-indigo-500 to-indigo-700 disabled:opacity-50 transition-all">
                      {assigning ? 'Assigning…' : 'Assign'}
                    </button>
                    <button onClick={cancelAssign} disabled={assigning} className="px-3 py-2 rounded-xl text-xs text-ink-muted hover:text-ink hover:bg-white/10 transition-colors">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Students Tab */}
        {activeTab === 'students' && (
          <div>
            {loadingStudents ? (
              <div className="text-center text-ink-muted py-8">Loading students...</div>
            ) : studentClassGroups.length === 0 ? (
              <div className="text-center text-ink-muted py-8">
                {searchQuery ? `No students found matching "${searchQuery}"` : 'No students in this department yet.'}
              </div>
            ) : (
              <>
                <div className="space-y-5">
                  {studentClassGroups.map((group) => (
                    <section key={group.id} className="overflow-hidden rounded-2xl border border-line bg-white/[0.04]">
                      <div className="flex flex-col gap-2 border-b border-line bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-ink">{group.name}</h3>
                          <p className="text-xs text-ink-muted">
                            {group.students.length} student{group.students.length === 1 ? '' : 's'}
                            {group.capacity !== null ? ` | Capacity ${group.capacity}` : ''}
                            {group.classTeacherName ? ` | Class teacher: ${group.classTeacherName}` : ''}
                          </p>
                        </div>
                        {group.capacity !== null && (
                          <span className="w-fit rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-200">
                            {group.students.length}/{group.capacity}
                          </span>
                        )}
                      </div>

                      <div className="divide-y divide-white/5">
                        {group.students.map((student) => (
                          <div key={student.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                            <UserAvatar
                              avatarUrl={student.avatarUrl}
                              fullName={student.fullName}
                              className="h-9 w-9 rounded-full shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-sm font-medium text-ink">{student.fullName}</p>
                              <p className="text-xs text-ink-muted">
                                {student.admissionNumber ? `ADM: ${student.admissionNumber}` : 'No admission number'}
                                {student.phone ? ` | ${student.phone}` : ''}
                                {student.email ? ` | ${student.email}` : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                <div className="hidden" aria-hidden="true">
                {filteredStudents.map((s) => (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/30 to-indigo-600/30 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-indigo-300">{s.fullName.charAt(0)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink">{s.fullName}</p>
                      <p className="text-xs text-ink-muted">
                        {s.admissionNumber ? `ADM: ${s.admissionNumber}` : '—'}
                        {s.classId && classes.find(c => c.id === s.classId) && (
                          <span className="ml-2 text-indigo-400">· {classes.find(c => c.id === s.classId)?.name}</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default DepartmentManagementPage;
