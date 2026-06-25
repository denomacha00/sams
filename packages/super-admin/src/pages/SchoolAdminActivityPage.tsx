import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface SchoolAdminAction {
  id: string;
  adminName: string;
  schoolName: string;
  schoolId: string;
  actionType: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

const ACTION_TYPES = ['LOGIN', 'LOGOUT', 'CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'CREATE_CLASS', 'UPDATE_CLASS', 'DELETE_CLASS', 'OTHER'];

const SchoolAdminActivityPage: React.FC = () => {
  const [actions, setActions] = useState<SchoolAdminAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [schoolFilter, setSchoolFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const params: Record<string, string> = {};
        if (schoolFilter) params.school = schoolFilter;
        if (actionFilter) params.actionType = actionFilter;
        if (dateFrom) params.from = dateFrom;
        if (dateTo) params.to = dateTo;
        const res = await apiClient.get('/super/activity/school-admins', { params });
        setActions(Array.isArray(res.data) ? res.data : res.data.actions ?? []);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load admin activity.'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [schoolFilter, actionFilter, dateFrom, dateTo]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading admin activity…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <h1 className="text-3xl font-bold tracking-tight text-white">School Admin Activity</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
          Monitor actions performed by school administrators across all schools.
        </p>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-gray-700/80 pb-3">
          <input
            type="text"
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            placeholder="Filter by school name…"
            className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
          >
            <option value="">All Actions</option>
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">From:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-2 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">To:</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-2 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Activity table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Admin</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">School</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Action</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Timestamp</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">Details</th>
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">No activity found.</td>
                </tr>
              )}
              {actions.map((a) => (
                <React.Fragment key={a.id}>
                  <tr
                    className="border-b border-gray-700/30 hover:bg-gray-700/30 cursor-pointer"
                    onClick={() => toggleExpand(a.id)}
                  >
                    <td className="px-3 py-2 text-gray-200">{a.adminName}</td>
                    <td className="px-3 py-2 text-gray-400">{a.schoolName}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-gray-700/50 px-2 py-0.5 text-xs font-medium text-gray-300">
                        {a.actionType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-400">
                      {new Date(a.timestamp).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-gray-500">
                      {expandedId === a.id ? '▲' : '▼'}
                    </td>
                  </tr>
                  {expandedId === a.id && a.details && (
                    <tr className="border-b border-gray-700/30 bg-gray-900/50">
                      <td colSpan={5} className="px-4 py-3">
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                          {JSON.stringify(a.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default SchoolAdminActivityPage;
