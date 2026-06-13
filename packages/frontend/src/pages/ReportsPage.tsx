import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

interface AttendanceRecordDetail {
  sessionId: string;
  recordId?: string | null;
  studentName?: string;
  date: string;
  subject: string;
  className?: string | null;
  teacherName?: string | null;
  status: 'PRESENT' | 'LATE' | 'EXCUSED' | 'ABSENT';
  method?: string | null;
  scannedAt?: string | null;
  sessionStartedAt: string;
  sessionEndedAt?: string | null;
  note?: string | null;
}

interface StudentEntry {
  studentId: string;
  studentName: string;
  fullName?: string;
  className?: string | null;
  departmentName?: string | null;
  attendancePercentage: number;
  totalExpected: number;
  totalPresent: number;
  totalLate: number;
  totalExcused: number;
  totalAbsent: number;
  records?: AttendanceRecordDetail[];
}

interface ReportClassOption {
  id: string;
  name: string;
  departmentId?: string | null;
  departmentName?: string | null;
}

interface ReportDepartmentOption {
  id: string;
  name: string;
  classes?: ReportClassOption[];
}

type ReportScope = 'student' | 'class' | 'department' | 'school';

interface ReportData {
  // Student report fields
  totalExpected?: number;
  totalPresent?: number;
  totalLate?: number;
  totalExcused?: number;
  totalAbsent?: number;
  attendancePercentage?: number;
  // Class / dept / school report fields
  averageAttendancePercentage?: number;
  totalSessions?: number;
  students?: StudentEntry[];
  records?: AttendanceRecordDetail[];
  // Computed display fields (normalised below)
  _displayPercentage?: number;
  _displayPresent?: number;
  _displayLate?: number;
  _displayExcused?: number;
  _displayAbsent?: number;
  _displaySessions?: number;
}

const ReportsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const initialScope: ReportScope =
    user?.role === UserRole.STUDENT ? 'student' :
    user?.role === UserRole.TEACHER ? 'class' :
    user?.role === UserRole.HOD ? 'department' :
    user?.role === UserRole.SCHOOL_ADMIN ? 'school' :
    'student';
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentEntry | null>(null);
  const [studentDetail, setStudentDetail] = useState<ReportData | null>(null);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);
  const [studentDetailError, setStudentDetailError] = useState<string | null>(null);
  const [reportScope, setReportScope] = useState<ReportScope>(initialScope);
  const [reportDepartments, setReportDepartments] = useState<ReportDepartmentOption[]>([]);
  const [reportClasses, setReportClasses] = useState<ReportClassOption[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [scopeLoading, setScopeLoading] = useState(true);

  const selectedDepartment = reportDepartments.find((dept) => dept.id === selectedDepartmentId);
  const selectableClasses = useMemo(() => {
    if (user?.role === UserRole.SCHOOL_ADMIN) {
      if (selectedDepartmentId) {
        return selectedDepartment?.classes ?? [];
      }
      return [];
    }
    return reportClasses;
  }, [reportClasses, reportDepartments, selectedDepartment, selectedDepartmentId, user?.role]);

  const getReportEndpoint = (): string | null => {
    switch (user?.role) {
      case UserRole.STUDENT:
        return user.id ? `/reports/student/${user.id}` : null;
      case UserRole.TEACHER:
        return selectedClassId ? `/reports/class/${selectedClassId}` : null;
      case UserRole.HOD:
        if (reportScope === 'class') return selectedClassId ? `/reports/class/${selectedClassId}` : null;
        return user.departmentId ? `/reports/department/${user.departmentId}` : null;
      case UserRole.SCHOOL_ADMIN:
        if (reportScope === 'class') return selectedClassId ? `/reports/class/${selectedClassId}` : null;
        if (reportScope === 'department') return selectedDepartmentId ? `/reports/department/${selectedDepartmentId}` : null;
        return '/reports/school';
      default:
        return user?.id ? `/reports/student/${user.id}` : null;
    }
  };

  const getExportReportId = (): string => {
    switch (user?.role) {
      case UserRole.STUDENT:
        return `student:${user.id}`;
      case UserRole.TEACHER:
        return selectedClassId ? `class:${selectedClassId}` : '';
      case UserRole.HOD:
        if (reportScope === 'class') return selectedClassId ? `class:${selectedClassId}` : '';
        return user.departmentId ? `department:${user.departmentId}` : '';
      case UserRole.SCHOOL_ADMIN:
        if (reportScope === 'class') return selectedClassId ? `class:${selectedClassId}` : '';
        if (reportScope === 'department') return selectedDepartmentId ? `department:${selectedDepartmentId}` : '';
        return 'school';
      default:
        return `student:${user?.id}`;
    }
  };

  const getRoleLabel = (): string => {
    switch (user?.role) {
      case UserRole.STUDENT:
        return 'Personal Report';
      case UserRole.TEACHER:
        return selectedClassId ? 'Class Session Report' : 'Teaching class required';
      case UserRole.HOD:
        return reportScope === 'class' ? 'Department Class Report' : 'Department Report';
      case UserRole.SCHOOL_ADMIN:
        return reportScope === 'class' ? 'Class Report' : reportScope === 'department' ? 'Department Report' : 'School Report';
      default:
        return 'Report';
    }
  };

  const normalizeRecords = (records: any[] | undefined): AttendanceRecordDetail[] =>
    (records ?? []).map((row) => ({
      sessionId: row.sessionId,
      recordId: row.recordId ?? null,
      studentName: row.studentName,
      date: row.date,
      subject: row.subject,
      className: row.className ?? null,
      teacherName: row.teacherName ?? null,
      status: row.status,
      method: row.method ?? null,
      scannedAt: row.scannedAt ?? null,
      sessionStartedAt: row.sessionStartedAt,
      sessionEndedAt: row.sessionEndedAt ?? null,
      note: row.note ?? null,
    }));

  const normalizeClassOption = (row: any, departmentName?: string | null): ReportClassOption => ({
    id: row.id,
    name: row.name,
    departmentId: row.departmentId ?? null,
    departmentName: row.departmentName ?? row.department?.name ?? departmentName ?? null,
  });

  const loadReportScopeOptions = async () => {
    if (!user) {
      setScopeLoading(false);
      return;
    }

    setScopeLoading(true);
    try {
      if (user.role === UserRole.STUDENT) {
        setReportScope('student');
        return;
      }

      if (user.role === UserRole.TEACHER) {
        const { data } = await apiClient.get('/users/teaching-classes');
        const classes = (Array.isArray(data) ? data : []).map((row: any) => normalizeClassOption(row));
        setReportScope('class');
        setReportClasses(classes);
        setSelectedClassId((current) =>
          current && classes.some((cls) => cls.id === current)
            ? current
            : classes[0]?.id ?? user.classId ?? '',
        );
        return;
      }

      if (user.role === UserRole.HOD) {
        setReportScope((current) => (current === 'class' ? 'class' : 'department'));
        setSelectedDepartmentId(user.departmentId ?? '');
        if (user.departmentId) {
          // Show only classes the HOD personally teaches (like a teacher)
          const { data } = await apiClient.get('/users/teaching-classes');
          const classes = (Array.isArray(data) ? data : []).map((row: any) =>
            normalizeClassOption(row, row.departmentName ?? null),
          );
          setReportClasses(classes);
          setSelectedClassId((current) =>
            current && classes.some((cls) => cls.id === current) ? current : classes[0]?.id ?? '',
          );
        }
        return;
      }

      if (user.role === UserRole.SCHOOL_ADMIN) {
        setReportScope((current) => (['school', 'department', 'class'].includes(current) ? current : 'school'));
        const { data } = await apiClient.get('/departments');
        const departments: ReportDepartmentOption[] = (Array.isArray(data) ? data : []).map((dept: any) => ({
          id: dept.id,
          name: dept.name,
          classes: (dept.classes ?? []).map((cls: any) => normalizeClassOption(cls, dept.name)),
        }));
        setReportDepartments(departments);
        setSelectedDepartmentId((current) =>
          current && departments.some((dept) => dept.id === current) ? current : departments[0]?.id ?? '',
        );
        const firstClass = departments.flatMap((dept) => dept.classes ?? [])[0];
        setSelectedClassId((current) =>
          current && departments.some((dept) => (dept.classes ?? []).some((cls) => cls.id === current))
            ? current
            : firstClass?.id ?? '',
        );
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to load report filters');
    } finally {
      setScopeLoading(false);
    }
  };

  /** Normalise the various backend response shapes into a single display shape */
  const normaliseReport = (data: any): ReportData => {
    // Student report: { studentId, studentName, totalExpected, totalPresent, totalLate, totalExcused, totalAbsent, attendancePercentage }
    if ('studentName' in data) {
      return {
        ...data,
        _displayPercentage: data.attendancePercentage ?? 0,
        _displayPresent: data.totalPresent ?? 0,
        _displayLate: data.totalLate ?? 0,
        _displayExcused: data.totalExcused ?? 0,
        _displayAbsent: data.totalAbsent ?? 0,
        _displaySessions: data.totalExpected ?? 0,
        records: normalizeRecords(data.records),
        students: undefined,
      };
    }
    // Class report: { classId, className, totalSessions, students: StudentReportData[], averageAttendancePercentage }
    if ('className' in data) {
      const students: StudentEntry[] = (data.students ?? []).map((s: any) => ({
        studentId: s.studentId,
        studentName: s.studentName,
        fullName: s.studentName,
        className: data.className,
        attendancePercentage: s.attendancePercentage ?? 0,
        totalExpected: s.totalExpected ?? 0,
        totalPresent: s.totalPresent ?? 0,
        totalLate: s.totalLate ?? 0,
        totalExcused: s.totalExcused ?? 0,
        totalAbsent: s.totalAbsent ?? 0,
        records: normalizeRecords(s.records),
      }));
      const totals = students.reduce(
        (acc, s) => ({
          present: acc.present + s.totalPresent,
          late: acc.late + s.totalLate,
          excused: acc.excused + s.totalExcused,
          absent: acc.absent + s.totalAbsent,
          sessions: acc.sessions + s.totalExpected,
        }),
        { present: 0, late: 0, excused: 0, absent: 0, sessions: 0 },
      );
      return {
        ...data,
        attendancePercentage: data.averageAttendancePercentage ?? 0,
        totalPresent: totals.present,
        totalLate: totals.late,
        totalExcused: totals.excused,
        totalAbsent: totals.absent,
        totalExpected: totals.sessions,
        _displayPercentage: data.averageAttendancePercentage ?? 0,
        _displayPresent: totals.present,
        _displayLate: totals.late,
        _displayExcused: totals.excused,
        _displayAbsent: totals.absent,
        _displaySessions: data.totalSessions ?? totals.sessions,
        students,
      };
    }
    // Department report: { departmentId, departmentName, classes: ClassReportData[], averageAttendancePercentage }
    if ('departmentName' in data) {
      const allStudents: StudentEntry[] = (data.classes ?? []).flatMap((cls: any) =>
        (cls.students ?? []).map((s: any) => ({
          studentId: s.studentId,
          studentName: s.studentName,
          fullName: s.studentName,
          className: cls.className,
          departmentName: data.departmentName,
          attendancePercentage: s.attendancePercentage ?? 0,
          totalExpected: s.totalExpected ?? 0,
          totalPresent: s.totalPresent ?? 0,
          totalLate: s.totalLate ?? 0,
          totalExcused: s.totalExcused ?? 0,
          totalAbsent: s.totalAbsent ?? 0,
          records: normalizeRecords(s.records),
        })),
      );
      const totals = allStudents.reduce(
        (acc, s) => ({
          present: acc.present + s.totalPresent,
          late: acc.late + s.totalLate,
          excused: acc.excused + s.totalExcused,
          absent: acc.absent + s.totalAbsent,
          sessions: acc.sessions + s.totalExpected,
        }),
        { present: 0, late: 0, excused: 0, absent: 0, sessions: 0 },
      );
      return {
        ...data,
        attendancePercentage: data.averageAttendancePercentage ?? 0,
        totalPresent: totals.present,
        totalLate: totals.late,
        totalExcused: totals.excused,
        totalAbsent: totals.absent,
        totalExpected: totals.sessions,
        _displayPercentage: data.averageAttendancePercentage ?? 0,
        _displayPresent: totals.present,
        _displayLate: totals.late,
        _displayExcused: totals.excused,
        _displayAbsent: totals.absent,
        _displaySessions: data.totalSessions ?? (data.classes ?? []).reduce(
          (sum: number, cls: any) => sum + (cls.totalSessions ?? 0),
          0,
        ),
        students: allStudents,
      };
    }
    // School report: { schoolId, schoolName, departments: DepartmentReportData[], averageAttendancePercentage }
    if ('schoolName' in data) {
      const allStudents: StudentEntry[] = (data.departments ?? []).flatMap((dept: any) =>
        (dept.classes ?? []).flatMap((cls: any) =>
          (cls.students ?? []).map((s: any) => ({
            studentId: s.studentId,
            studentName: s.studentName,
            fullName: s.studentName,
            className: cls.className,
            departmentName: dept.departmentName,
            attendancePercentage: s.attendancePercentage ?? 0,
            totalExpected: s.totalExpected ?? 0,
            totalPresent: s.totalPresent ?? 0,
            totalLate: s.totalLate ?? 0,
            totalExcused: s.totalExcused ?? 0,
            totalAbsent: s.totalAbsent ?? 0,
            records: normalizeRecords(s.records),
          })),
        ),
      );
      const totals = allStudents.reduce(
        (acc, s) => ({
          present: acc.present + s.totalPresent,
          late: acc.late + s.totalLate,
          excused: acc.excused + s.totalExcused,
          absent: acc.absent + s.totalAbsent,
          sessions: acc.sessions + s.totalExpected,
        }),
        { present: 0, late: 0, excused: 0, absent: 0, sessions: 0 },
      );
      return {
        ...data,
        attendancePercentage: data.averageAttendancePercentage ?? 0,
        totalPresent: totals.present,
        totalLate: totals.late,
        totalExcused: totals.excused,
        totalAbsent: totals.absent,
        totalExpected: totals.sessions,
        _displayPercentage: data.averageAttendancePercentage ?? 0,
        _displayPresent: totals.present,
        _displayLate: totals.late,
        _displayExcused: totals.excused,
        _displayAbsent: totals.absent,
        _displaySessions: data.totalSessions ?? (data.departments ?? []).reduce(
          (sum: number, dept: any) => sum + (dept.totalSessions ?? 0),
          0,
        ),
        students: allStudents,
      };
    }
    return data;
  };

  const fetchReport = async () => {
    const endpoint = getReportEndpoint();
    if (!endpoint) {
      setError('Unable to determine report scope. Please ensure your account is properly configured.');
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedStudent(null);
    setStudentDetail(null);
    setStudentDetailError(null);
    try {
      const { data } = await apiClient.get(
        `${endpoint}?from=${dateFrom}T00:00:00.000Z&to=${dateTo}T23:59:59.999Z`
      );
      setReport(normaliseReport(data));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Failed to load report';
      setError(msg);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReportScopeOptions();
  }, [user?.id, user?.role, user?.classId, user?.departmentId]);

  useEffect(() => {
    if (!scopeLoading) void fetchReport();
  }, [scopeLoading]);

  const handleExport = async (format: 'pdf' | 'excel') => {
    const reportId = getExportReportId();
    if (!reportId) {
      setError('Unable to determine report scope. Please ensure your account is properly configured.');
      return;
    }
    setExporting(true);
    try {
      const response = await apiClient.get(
        `/reports/${reportId}/export?format=${format}&from=${dateFrom}T00:00:00.000Z&to=${dateTo}T23:59:59.999Z`,
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-report.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const atRiskCount = report?.students?.filter((s) => s.attendancePercentage < 60).length || 0;

  const displayPercentage = report?._displayPercentage ?? report?.attendancePercentage ?? 0;
  const displayPresent = report?._displayPresent ?? report?.totalPresent ?? 0;
  const displayLate = report?._displayLate ?? report?.totalLate ?? 0;
  const displayExcused = report?._displayExcused ?? report?.totalExcused ?? 0;
  const displaySessions = report?._displaySessions ?? report?.totalExpected ?? 0;
  const displayAbsent = report?._displayAbsent ?? report?.totalAbsent ?? 0;
  const classSessionEvidence: AttendanceRecordDetail[] =
    !selectedStudent && report?.students
      ? report.students.flatMap((student) =>
          (student.records ?? []).map((row) => ({
            ...row,
            studentName: student.studentName || student.fullName,
            className: row.className ?? student.className ?? null,
          })),
        )
      : [];
  const dailyEvidence = studentDetail?.records ?? report?.records ?? classSessionEvidence;
  const showStudentEvidenceColumn = !selectedStudent && dailyEvidence.some((row) => !!row.studentName);
  const canGenerateReport = !scopeLoading && !!getReportEndpoint();
  const selectedClassName = selectableClasses.find((cls) => cls.id === selectedClassId)?.name;
  const showClassBreakdownColumn = report?.students?.some((student) => student.className || student.departmentName) ?? false;

  const formatDateTime = (value?: string | null): string => {
    if (!value) return 'Not marked';
    return new Date(value).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const getStatusClass = (status: AttendanceRecordDetail['status']): string => {
    switch (status) {
      case 'PRESENT':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25';
      case 'LATE':
        return 'bg-amber-500/15 text-amber-300 border-amber-400/25';
      case 'EXCUSED':
        return 'bg-sky-500/15 text-sky-300 border-sky-400/25';
      case 'ABSENT':
      default:
        return 'bg-red-500/15 text-red-300 border-red-400/25';
    }
  };

  const handleStudentDetails = async (student: StudentEntry) => {
    setSelectedStudent(student);
    setStudentDetail(null);
    setStudentDetailError(null);
    setStudentDetailLoading(true);
    try {
      const { data } = await apiClient.get(
        `/reports/student/${student.studentId}?from=${dateFrom}T00:00:00.000Z&to=${dateTo}T23:59:59.999Z`,
      );
      setStudentDetail(normaliseReport(data));
    } catch (err: any) {
      setStudentDetailError(
        err.response?.data?.error || err.response?.data?.message || 'Failed to load student evidence',
      );
    } finally {
      setStudentDetailLoading(false);
    }
  };

  return (
    <div className="page-shell p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">Attendance Reports</h1>
          <p className="text-ink-muted text-sm mt-1">{getRoleLabel()}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 alert-error">
            <p className="text-sm text-red-300 text-center">{error}</p>
          </div>
        )}

        {/* Date range picker */}
        <div className="surface-card rounded-2xl p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="dateFrom" className="form-label">
                From
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 "
              />
            </div>
            <div className="flex-1">
              <label htmlFor="dateTo" className="form-label">
                To
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 "
              />
            </div>
            {user?.role === UserRole.SCHOOL_ADMIN && (
              <div className="flex-1">
                <label htmlFor="reportScope" className="form-label">
                  Report Level
                </label>
                <select
                  id="reportScope"
                  value={reportScope}
                  onChange={(e) => {
                    const next = e.target.value as ReportScope;
                    setReportScope(next);
                    setReport(null);
                    setSelectedStudent(null);
                    if (next === 'school') {
                      setSelectedClassId('');
                    }
                  }}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200"
                >
                  <option value="school" className="bg-slate-800">Whole school</option>
                  <option value="department" className="bg-slate-800">Department</option>
                  <option value="class" className="bg-slate-800">Specific class/session</option>
                </select>
              </div>
            )}
            {user?.role === UserRole.HOD && (
              <div className="flex-1">
                <label htmlFor="hodReportScope" className="form-label">
                  Report Level
                </label>
                <select
                  id="hodReportScope"
                  value={reportScope === 'class' ? 'class' : 'department'}
                  onChange={(e) => {
                    setReportScope(e.target.value as ReportScope);
                    setReport(null);
                    setSelectedStudent(null);
                  }}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200"
                >
                  <option value="department" className="bg-slate-800">My department</option>
                  <option value="class" className="bg-slate-800">Specific class/session</option>
                </select>
              </div>
            )}
            {user?.role === UserRole.SCHOOL_ADMIN && reportScope !== 'school' && (
              <div className="flex-1">
                <label htmlFor="reportDepartment" className="form-label">
                  Department
                </label>
                <select
                  id="reportDepartment"
                  value={selectedDepartmentId}
                  onChange={(e) => {
                    const nextDepartmentId = e.target.value;
                    const nextDepartment = reportDepartments.find((dept) => dept.id === nextDepartmentId);
                    setSelectedDepartmentId(nextDepartmentId);
                    setSelectedClassId(nextDepartment?.classes?.[0]?.id ?? '');
                    setReport(null);
                    setSelectedStudent(null);
                  }}
                  disabled={scopeLoading}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 disabled:opacity-60"
                >
                  <option value="" className="bg-slate-800">Select department</option>
                  {reportDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id} className="bg-slate-800">{dept.name}</option>
                  ))}
                </select>
              </div>
            )}
            {((user?.role === UserRole.TEACHER) ||
              (user?.role === UserRole.HOD && reportScope === 'class') ||
              (user?.role === UserRole.SCHOOL_ADMIN && reportScope === 'class')) && (
              <div className="flex-1">
                <label htmlFor="reportClass" className="form-label">
                  Class / Session
                </label>
                <select
                  id="reportClass"
                  value={selectedClassId}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value);
                    setReport(null);
                    setSelectedStudent(null);
                  }}
                  disabled={scopeLoading || (user?.role === UserRole.SCHOOL_ADMIN && !selectedDepartmentId)}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all duration-200 disabled:opacity-60"
                >
                  <option value="" className="bg-slate-800">Select class</option>
                  {selectableClasses.map((cls) => (
                    <option key={cls.id} value={cls.id} className="bg-slate-800">
                      {cls.name}{cls.departmentName ? ` - ${cls.departmentName}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={fetchReport}
              disabled={loading || !canGenerateReport}
              className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-indigo-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
            >
              {loading || scopeLoading ? 'Loading...' : 'Generate'}
            </button>
          </div>
          {!scopeLoading && !canGenerateReport && (
            <p className="mt-3 text-sm text-amber-300">
              Select a valid {reportScope === 'class' ? 'class' : 'department'} before generating this report.
            </p>
          )}
          {reportScope === 'class' && selectedClassName && (
            <p className="mt-3 text-sm text-ink-subtle">
              Showing class/session evidence for {selectedClassName}. Pick one day above to see that day&apos;s lesson rows.
            </p>
          )}
        </div>

        {/* Stats cards */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-8 w-8 text-indigo-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
          </div>
        )}

        {!loading && !report && !error && (
          <div className="surface-card rounded-2xl p-12 text-center">
            <svg className="w-16 h-16 text-ink-muted mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 className="text-lg font-semibold text-ink mb-2">No Report Data</h3>
            <p className="text-ink-muted text-sm">No attendance records found for the selected date range. Try adjusting the dates or take attendance first.</p>
          </div>
        )}

        {report && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <div className="surface-card rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-accent-orange">
                  {displayPercentage.toFixed(1)}%
                </p>
                <p className="text-xs text-ink-muted mt-1 uppercase tracking-wider">Avg Attendance</p>
              </div>
              <div className="surface-card rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-indigo-400">{displaySessions}</p>
                <p className="text-xs text-ink-muted mt-1 uppercase tracking-wider">Total Sessions</p>
              </div>
              <div className="surface-card rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-indigo-400">{displayPresent}</p>
                <p className="text-xs text-ink-muted mt-1 uppercase tracking-wider">Present</p>
              </div>
              <div className="surface-card rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-amber-300">{displayLate}</p>
                <p className="text-xs text-ink-muted mt-1 uppercase tracking-wider">Late</p>
              </div>
              <div className="surface-card rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-sky-300">{displayExcused}</p>
                <p className="text-xs text-ink-muted mt-1 uppercase tracking-wider">Excused</p>
              </div>
              <div className="surface-card rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-red-400">{atRiskCount > 0 ? atRiskCount : displayAbsent}</p>
                <p className="text-xs text-ink-muted mt-1 uppercase tracking-wider">{atRiskCount > 0 ? 'At-Risk' : 'Absent'}</p>
              </div>
            </div>

            {/* Student breakdown table */}
            {report.students && report.students.length > 0 && (
              <div className="surface-card rounded-2xl p-6 mb-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-ink">Student Breakdown</h2>
                  <p className="text-sm text-ink-muted">Counts are shown here. Open View days for lesson-by-lesson proof.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Student</th>
                        {showClassBreakdownColumn && (
                          <th className="text-left text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Class</th>
                        )}
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Expected</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Present</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Late</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Excused</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Absent</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Attendance</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Status</th>
                        <th className="text-right text-xs font-semibold text-ink-muted uppercase tracking-wider py-3 px-2">Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {report.students.map((s) => (
                        <tr key={s.studentId} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-xs font-bold text-ink">
                                {(s.studentName || s.fullName || '?').charAt(0)}
                              </div>
                              <span className="font-medium text-ink text-sm">{s.studentName || s.fullName}</span>
                            </div>
                          </td>
                          {showClassBreakdownColumn && (
                            <td className="py-3 px-2">
                              <p className="text-sm font-medium text-ink-muted">{s.className ?? '-'}</p>
                              {s.departmentName && (
                                <p className="text-xs text-ink-subtle">{s.departmentName}</p>
                              )}
                            </td>
                          )}
                          <td className="py-3 px-2 text-right text-sm text-ink-muted">{s.totalExpected}</td>
                          <td className="py-3 px-2 text-right text-sm text-emerald-300">{s.totalPresent}</td>
                          <td className="py-3 px-2 text-right text-sm text-amber-300">{s.totalLate}</td>
                          <td className="py-3 px-2 text-right text-sm text-sky-300">{s.totalExcused}</td>
                          <td className="py-3 px-2 text-right text-sm text-red-300">{s.totalAbsent}</td>
                          <td className="py-3 px-2 text-right">
                            <span className={`font-semibold text-sm ${
                              s.attendancePercentage >= 80 ? 'text-indigo-300' :
                              s.attendancePercentage >= 60 ? 'text-ink-muted' :
                              'text-red-400'
                            }`}>
                              {s.attendancePercentage.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              s.attendancePercentage >= 80 ? 'bg-indigo-500/20 text-indigo-300' :
                              s.attendancePercentage >= 60 ? 'bg-slate-700/50 text-ink-muted' :
                              'bg-red-500/20 text-red-300'
                            }`}>
                              {s.attendancePercentage >= 80 ? 'Good' : s.attendancePercentage >= 60 ? 'Warning' : 'At Risk'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <button
                              type="button"
                              onClick={() => void handleStudentDetails(s)}
                              className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
                            >
                              View days
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(dailyEvidence.length > 0 || selectedStudent || studentDetailLoading || studentDetailError) && (
              <div className="surface-card rounded-2xl p-6 mb-6">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">
                      {selectedStudent ? `${selectedStudent.studentName || selectedStudent.fullName} - Daily Evidence` : 'Daily Evidence'}
                    </h2>
                    <p className="text-sm text-ink-muted">
                      Lesson-by-lesson status for the selected date range.
                    </p>
                  </div>
                  {selectedStudent && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudent(null);
                        setStudentDetail(null);
                        setStudentDetailError(null);
                      }}
                      className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink"
                    >
                      Clear selection
                    </button>
                  )}
                </div>

                {studentDetailLoading && (
                  <p className="py-6 text-center text-sm text-ink-muted">Loading daily evidence...</p>
                )}

                {studentDetailError && (
                  <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/15 p-3 text-sm text-red-300">
                    {studentDetailError}
                  </div>
                )}

                {!studentDetailLoading && !studentDetailError && dailyEvidence.length === 0 && (
                  <p className="py-6 text-center text-sm text-ink-muted">No lesson evidence found for this date range.</p>
                )}

                {!studentDetailLoading && dailyEvidence.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/10">
                          {showStudentEvidenceColumn && (
                            <th className="py-3 px-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Student</th>
                          )}
                          <th className="py-3 px-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Date</th>
                          <th className="py-3 px-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Session</th>
                          <th className="py-3 px-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Lesson</th>
                          <th className="py-3 px-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Teacher</th>
                          <th className="py-3 px-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">Status</th>
                          <th className="py-3 px-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">Method</th>
                          <th className="py-3 px-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">Marked At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {dailyEvidence.map((row) => (
                          <tr key={`${row.sessionId}-${row.studentName ?? selectedStudent?.studentId ?? 'student'}-${row.recordId ?? 'absent'}`} className="hover:bg-white/5">
                            {showStudentEvidenceColumn && (
                              <td className="py-3 px-2 text-sm font-medium text-ink">{row.studentName ?? '-'}</td>
                            )}
                            <td className="py-3 px-2 text-sm text-ink-muted">{row.date}</td>
                            <td className="py-3 px-2 text-sm text-ink-muted">{formatDateTime(row.sessionStartedAt)}</td>
                            <td className="py-3 px-2">
                              <p className="text-sm font-medium text-ink">{row.subject}</p>
                              <p className="text-xs text-ink-subtle">{row.className ?? 'Class not set'}</p>
                            </td>
                            <td className="py-3 px-2 text-sm text-ink-muted">{row.teacherName ?? 'Not set'}</td>
                            <td className="py-3 px-2 text-right">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getStatusClass(row.status)}`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-right text-sm text-ink-muted">{row.method ?? '-'}</td>
                            <td className="py-3 px-2 text-right text-sm text-ink-muted">{formatDateTime(row.scannedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Export buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting || !report}
                className="flex items-center gap-2 bg-white/10 border border-red-500/30 text-red-300 py-2.5 px-5 rounded-xl hover:bg-red-500/20 disabled:opacity-50 transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export PDF
              </button>
              <button
                onClick={() => handleExport('excel')}
                disabled={exporting || !report}
                className="flex items-center gap-2 bg-white/10 border border-indigo-500/30 text-indigo-300 py-2.5 px-5 rounded-xl hover:bg-indigo-500/20 disabled:opacity-50 transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export Excel
              </button>
            </div>
          </>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-ink-subtle mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ReportsPage;
