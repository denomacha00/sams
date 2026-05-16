import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

interface ReportData {
  totalExpected: number;
  totalPresent: number;
  totalLate: number;
  totalExcused: number;
  totalAbsent: number;
  attendancePercentage: number;
  students?: Array<{
    studentId: string;
    fullName: string;
    attendancePercentage: number;
  }>;
}

const ReportsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
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

  const getReportEndpoint = (): string | null => {
    switch (user?.role) {
      case UserRole.STUDENT:
        return user.id ? `/reports/student/${user.id}` : null;
      case UserRole.TEACHER:
        return user.classId ? `/reports/class/${user.classId}` : '/reports/school';
      case UserRole.HOD:
        return user.departmentId ? `/reports/department/${user.departmentId}` : '/reports/school';
      case UserRole.SCHOOL_ADMIN:
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
        return user.classId ? `class:${user.classId}` : 'school';
      case UserRole.HOD:
        return user.departmentId ? `department:${user.departmentId}` : 'school';
      case UserRole.SCHOOL_ADMIN:
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
        return 'Class Report';
      case UserRole.HOD:
        return 'Department Report';
      case UserRole.SCHOOL_ADMIN:
        return 'School Report';
      default:
        return 'Report';
    }
  };

  const fetchReport = async () => {
    const endpoint = getReportEndpoint();
    if (!endpoint) {
      setError('Unable to determine report scope. Please ensure your account is properly configured.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(
        `${endpoint}?from=${dateFrom}T00:00:00.000Z&to=${dateTo}T23:59:59.999Z`
      );
      setReport(data);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Failed to load report';
      setError(msg);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const handleExport = async (format: 'pdf' | 'excel') => {
    setExporting(true);
    try {
      const reportId = getExportReportId();
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Attendance Reports</h1>
          <p className="text-gray-400 text-sm mt-1">{getRoleLabel()}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl backdrop-blur-sm">
            <p className="text-sm text-red-200 text-center">{error}</p>
          </div>
        )}

        {/* Date range picker */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="dateFrom" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                From
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 [color-scheme:dark]"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="dateTo" className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                To
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 [color-scheme:dark]"
              />
            </div>
            <button
              onClick={fetchReport}
              disabled={loading}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
            >
              {loading ? 'Loading...' : 'Generate'}
            </button>
          </div>
        </div>

        {/* Stats cards */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-8 w-8 text-teal-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
          </div>
        )}

        {!loading && !report && !error && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
            <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 className="text-lg font-semibold text-white mb-2">No Report Data</h3>
            <p className="text-gray-400 text-sm">No attendance records found for the selected date range. Try adjusting the dates or take attendance first.</p>
          </div>
        )}

        {report && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-emerald-400">
                  {report.attendancePercentage.toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Avg Attendance</p>
              </div>
              <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-blue-400">{report.totalPresent + report.totalLate + report.totalAbsent + report.totalExcused}</p>
                <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Total Sessions</p>
              </div>
              <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-purple-400">{report.totalPresent}</p>
                <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Present</p>
              </div>
              <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
                <p className="text-3xl font-bold text-red-400">{atRiskCount}</p>
                <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">At-Risk</p>
              </div>
            </div>

            {/* Student breakdown table */}
            {report.students && report.students.length > 0 && (
              <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-white mb-4">Student Breakdown</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider py-3 px-2">Student</th>
                        <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wider py-3 px-2">Attendance</th>
                        <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wider py-3 px-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {report.students.map((s) => (
                        <tr key={s.studentId} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
                                {s.fullName.charAt(0)}
                              </div>
                              <span className="font-medium text-white text-sm">{s.fullName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className={`font-semibold text-sm ${
                              s.attendancePercentage >= 80 ? 'text-emerald-400' :
                              s.attendancePercentage >= 60 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {s.attendancePercentage.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              s.attendancePercentage >= 80 ? 'bg-emerald-500/20 text-emerald-300' :
                              s.attendancePercentage >= 60 ? 'bg-yellow-500/20 text-yellow-300' :
                              'bg-red-500/20 text-red-300'
                            }`}>
                              {s.attendancePercentage >= 80 ? 'Good' : s.attendancePercentage >= 60 ? 'Warning' : 'At Risk'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Export buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting}
                className="flex items-center gap-2 bg-white/10 border border-red-500/30 text-red-300 py-2.5 px-5 rounded-xl hover:bg-red-500/20 disabled:opacity-50 transition-all duration-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export PDF
              </button>
              <button
                onClick={() => handleExport('excel')}
                disabled={exporting}
                className="flex items-center gap-2 bg-white/10 border border-emerald-500/30 text-emerald-300 py-2.5 px-5 rounded-xl hover:bg-emerald-500/20 disabled:opacity-50 transition-all duration-200"
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
        <p className="text-center text-xs text-gray-500 mt-8">
          © 2025 SAMS · Developed by Denis Macharia
        </p>
      </div>
    </div>
  );
};

export default ReportsPage;
