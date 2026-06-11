import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRole } from '@sams/shared';
import { useAuthStore } from '../store/authStore';
import apiClient from '../services/apiClient';
import { UserAvatar } from '../components/UserAvatar';

interface StudentToday {
  present: number;
  late: number;
  excused: number;
  absent: number;
  notMarked: number;
  lastStatus: string | null;
  lastMethod: string | null;
  lastNote: string | null;
  lastSubject: string | null;
  lastMarkedAt: string | null;
}

interface Student {
  id: string;
  fullName: string;
  username: string | null;
  admissionNumber: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isClassRep: boolean;
  isLocked: boolean;
  attendanceGpsExempt: boolean;
  today: StudentToday;
}

interface TodayLesson {
  id: string;
  subject: string;
  startTime: string;
  endTime: string;
  room: string | null;
  teacherName: string;
  isCurrent: boolean;
  isPast: boolean;
  activeSessionId: string | null;
  activeRecordCount: number;
}

interface ClassGroup {
  id: string;
  name: string;
  capacity: number;
  departmentName: string;
  classTeacher?: { fullName: string; email: string | null; phone: string | null } | null;
  canManageClass: boolean;
  studentCount: number;
  activeSessionCount: number;
  todayLessons: TodayLesson[];
  students: Student[];
}

interface DepartmentGroup {
  id: string;
  name: string;
  classes: ClassGroup[];
}

interface WorkbenchData {
  today: { dayLabel: string; currentMinutes: number };
  totals: {
    departments: number;
    classes: number;
    students: number;
    lessonsToday: number;
    activeSessions: number;
    presentToday: number;
    absentToday: number;
    notMarkedToday: number;
  };
  departments: DepartmentGroup[];
}

function roleTitle(role?: UserRole): string {
  if (role === UserRole.SCHOOL_ADMIN) return 'School Student Workbench';
  if (role === UserRole.HOD) return 'Department Student Workbench';
  return 'My Student Workbench';
}

function roleHint(role?: UserRole): string {
  if (role === UserRole.SCHOOL_ADMIN) return 'All students organized by department and class, with today attendance follow-up.';
  if (role === UserRole.HOD) return 'Department students, class groups, lessons today, and attendance gaps.';
  return 'Students you teach, separated by class, with today lessons and attendance status.';
}

function statusClass(status: string | null, notMarked: number): string {
  if (notMarked > 0 && !status) return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  switch (status) {
    case 'PRESENT':
      return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30';
    case 'LATE':
      return 'bg-indigo-500/15 text-indigo-200 border-indigo-500/30';
    case 'EXCUSED':
      return 'bg-sky-500/15 text-sky-200 border-sky-500/30';
    case 'ABSENT':
      return 'bg-red-500/15 text-red-200 border-red-500/30';
    default:
      return 'bg-white/10 text-ink-subtle border-white/10';
  }
}

function statusLabel(student: Student): string {
  if (student.today.lastStatus) return student.today.lastStatus;
  if (student.today.notMarked > 0) return 'NOT MARKED';
  return 'NO LESSON';
}

const ClassStudentsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient.get('/users/student-workbench')
      .then(({ data: response }) => {
        if (!cancelled) {
          setData(response);
          setError('');
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.response?.data?.error || 'Failed to load student workbench');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const departments = data?.departments ?? [];
  const classes = useMemo(
    () => departments.flatMap((department) => department.classes.map((cls) => ({ ...cls, departmentId: department.id }))),
    [departments],
  );

  const visibleDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return departments
      .filter((department) => departmentFilter === 'all' || department.id === departmentFilter)
      .map((department) => ({
        ...department,
        classes: department.classes
          .filter((cls) => classFilter === 'all' || cls.id === classFilter)
          .map((cls) => ({
            ...cls,
            students: cls.students.filter((student) => {
              if (!q) return true;
              return [
                student.fullName,
                student.username,
                student.admissionNumber,
                student.email,
                student.phone,
                cls.name,
                department.name,
              ].some((value) => value?.toLowerCase().includes(q));
            }),
          }))
          .filter((cls) => cls.students.length > 0 || !q),
      }))
      .filter((department) => department.classes.length > 0);
  }, [classFilter, departmentFilter, departments, searchQuery]);

  const filteredStudentCount = visibleDepartments.reduce(
    (sum, department) => sum + department.classes.reduce((classSum, cls) => classSum + cls.students.length, 0),
    0,
  );

  return (
    <div className="page-shell">
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Students and attendance</p>
            <h1 className="text-xl font-bold text-ink">{roleTitle(user?.role)}</h1>
            <p className="text-xs text-ink-muted mt-1">{roleHint(user?.role)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/links" className="btn-secondary px-4 py-2 text-sm">
              Registration Links
            </Link>
            <Link to="/dashboard" className="btn-secondary px-4 py-2 text-sm">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Students', data?.totals.students ?? 0],
            ['Classes', data?.totals.classes ?? 0],
            ['Present today', data?.totals.presentToday ?? 0],
            ['Need follow-up', data ? data.totals.absentToday + data.totals.notMarkedToday : 0],
          ].map(([label, value]) => (
            <div key={label} className="surface-card rounded-xl border border-line p-4">
              <p className="text-xs text-ink-muted">{label}</p>
              <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-5 surface-panel rounded-2xl p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search student, ADM, phone, class, department..."
              className="input-field"
            />
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="input-field">
              <option value="all">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="input-field">
              <option value="all">All classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.departmentName} - {cls.name}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-3 text-xs text-ink-subtle">
            Showing {filteredStudentCount} student{filteredStudentCount === 1 ? '' : 's'}. Today: {data?.today.dayLabel ?? 'school day'}.
          </p>
        </section>

        {loading ? (
          <div className="py-16 text-center text-ink-muted">Loading student workbench...</div>
        ) : visibleDepartments.length === 0 ? (
          <div className="py-16 text-center text-ink-muted">
            No students found for this scope. Check timetable assignments, class placement, or registration links.
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {visibleDepartments.map((department) => (
              <section key={department.id}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-ink">{department.name}</h2>
                  <span className="text-xs text-ink-subtle">{department.classes.length} class{department.classes.length === 1 ? '' : 'es'}</span>
                </div>

                <div className="space-y-4">
                  {department.classes.map((cls) => (
                    <div key={cls.id} className="surface-card rounded-2xl border border-line p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-ink">{cls.name}</h3>
                            {cls.activeSessionCount > 0 && (
                              <span className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-red-200">
                                Live session
                              </span>
                            )}
                            {cls.canManageClass && (
                              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">
                                Class teacher
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-ink-muted">
                            {cls.studentCount} students | Capacity {cls.capacity}
                            {cls.classTeacher?.fullName ? ` | Class teacher: ${cls.classTeacher.fullName}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link to="/sessions" className="btn-primary px-3 py-2 text-xs">Sessions</Link>
                          <Link to="/attendance" className="btn-attendance px-3 py-2 text-xs">Manual</Link>
                          <Link to="/reports" className="btn-secondary px-3 py-2 text-xs">Reports</Link>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="rounded-xl border border-line bg-surface-muted p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">Today lessons</p>
                          <div className="mt-3 space-y-2">
                            {cls.todayLessons.length === 0 ? (
                              <p className="text-sm text-ink-muted">No lesson scheduled today.</p>
                            ) : (
                              cls.todayLessons.map((lesson) => (
                                <div key={lesson.id} className="rounded-lg bg-surface-elevated p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-semibold text-ink">{lesson.subject}</p>
                                      <p className="text-xs text-ink-muted">{lesson.startTime}-{lesson.endTime}{lesson.room ? ` | ${lesson.room}` : ''}</p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
                                      lesson.isCurrent
                                        ? 'bg-emerald-500/15 text-emerald-200'
                                        : lesson.isPast
                                          ? 'bg-white/10 text-ink-subtle'
                                          : 'bg-indigo-500/15 text-indigo-200'
                                    }`}>
                                      {lesson.isCurrent ? 'Now' : lesson.isPast ? 'Past' : 'Upcoming'}
                                    </span>
                                  </div>
                                  {lesson.activeSessionId && (
                                    <p className="mt-2 text-xs text-emerald-200">{lesson.activeRecordCount} marked in live session</p>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[760px]">
                            <thead>
                              <tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-ink-subtle">
                                <th className="px-3 py-2">Student</th>
                                <th className="px-3 py-2">ADM / Contact</th>
                                <th className="px-3 py-2">Today</th>
                                <th className="px-3 py-2">Reason / note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cls.students.map((student) => (
                                <tr key={student.id} className="border-b border-white/5">
                                  <td className="px-3 py-3">
                                    <div className="flex items-center gap-3">
                                      <UserAvatar avatarUrl={student.avatarUrl} fullName={student.fullName} className="h-9 w-9 rounded-full" />
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-ink">{student.fullName}</p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          {student.isClassRep && <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-200">Class rep</span>}
                                          {student.isLocked && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">Unlocks on login</span>}
                                          {student.attendanceGpsExempt && <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200">GPS exempt</span>}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-sm text-ink-muted">
                                    <div>{student.admissionNumber || student.username || 'No ADM'}</div>
                                    <div className="text-xs text-ink-subtle">{student.phone || student.email || 'No contact'}</div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(student.today.lastStatus, student.today.notMarked)}`}>
                                      {statusLabel(student)}
                                    </span>
                                    <p className="mt-1 text-[11px] text-ink-subtle">
                                      P {student.today.present + student.today.late} | A {student.today.absent} | E {student.today.excused} | Missing {student.today.notMarked}
                                    </p>
                                  </td>
                                  <td className="px-3 py-3 text-sm text-ink-muted">
                                    {student.today.lastNote ? (
                                      <span>{student.today.lastNote}</span>
                                    ) : student.today.absent > 0 ? (
                                      <span className="text-amber-200">No reason recorded</span>
                                    ) : (
                                      <span className="text-ink-subtle">{student.today.lastSubject || 'No note'}</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default ClassStudentsPage;
