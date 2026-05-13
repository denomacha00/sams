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

  const getReportEndpoint = (): string => {
    switch (user?.role) {
      case UserRole.STUDENT:
        return `/reports/student/${user.id}`;
      case UserRole.TEACHER:
        return `/reports/class/${user.classId}`;
      case UserRole.HOD:
        return `/reports/department/${user.departmentId}`;
      case UserRole.SCHOOL_ADMIN:
        return '/reports/school';
      default:
        return `/reports/student/${user?.id}`;
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
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(
        `${getReportEndpoint()}?from=${dateFrom}&to=${dateTo}`
      );
      setReport(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load report');
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
      const response = await apiClient.get(
        `${getReportEndpoint()}/export?format=${format}&from=${dateFrom}&to=${dateTo}`,
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Attendance Reports</h1>
        <p className="text-gray-600 mb-6">{getRoleLabel()}</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Date range picker */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label htmlFor="dateFrom" className="block text-sm font-medium text-gray-700">
                From
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="dateTo" className="block text-sm font-medium text-gray-700">
                To
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              onClick={fetchReport}
              disabled={loading}
              className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Generate'}
            </button>
          </div>
        </div>

        {/* Report summary */}
        {report && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow-md p-4 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {report.attendancePercentage.toFixed(1)}%
                </p>
                <p className="text-sm text-gray-600">Attendance</p>
              </div>
              <div className="bg-white rounded-lg shadow-md p-4 text-center">
                <p className="text-2xl font-bold text-blue-600">{report.totalPresent}</p>
                <p className="text-sm text-gray-600">Present</p>
              </div>
              <div className="bg-white rounded-lg shadow-md p-4 text-center">
                <p className="text-2xl font-bold text-yellow-600">{report.totalLate}</p>
                <p className="text-sm text-gray-600">Late</p>
              </div>
              <div className="bg-white rounded-lg shadow-md p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{report.totalAbsent}</p>
                <p className="text-sm text-gray-600">Absent</p>
              </div>
            </div>

            {/* Student breakdown (for Teacher/HOD/Admin) */}
            {report.students && report.students.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Student Breakdown</h2>
                <div className="space-y-2">
                  {report.students.map((s) => (
                    <div key={s.studentId} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <span className="font-medium text-gray-900">{s.fullName}</span>
                      <span
                        className={`font-semibold ${
                          s.attendancePercentage >= 80
                            ? 'text-green-600'
                            : s.attendancePercentage >= 60
                            ? 'text-yellow-600'
                            : 'text-red-600'
                        }`}
                      >
                        {s.attendancePercentage.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => handleExport('pdf')}
                disabled={exporting}
                className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                Export PDF
              </button>
              <button
                onClick={() => handleExport('excel')}
                disabled={exporting}
                className="bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                Export Excel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportsPage;
