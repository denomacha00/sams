import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

interface AuditLog {
  id: string;
  sequenceNum: string;
  schoolId: string | null;
  actorId: string | null;
  actorRole: string | null;
  eventType: string;
  resourceSnapshot: Record<string, unknown>;
  createdAt: string;
}

const EVENT_TYPES = [
  'USER_LOGIN',
  'USER_LOGOUT',
  'LICENSE_ACTIVATION',
  'ATTENDANCE_CREATED',
  'ATTENDANCE_UPDATED',
  'PAYMENT_INITIATED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'SCHOOL_SUSPENDED',
  'ROLE_CHANGED',
  'CONFLICT_RESOLVED',
  'SMS_RETRY',
];

const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    schoolId: '',
    eventType: '',
    dateFrom: '',
    dateTo: '',
  });

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.schoolId) params.set('schoolId', filters.schoolId);
      if (filters.eventType) params.set('eventType', filters.eventType);
      if (filters.dateFrom) params.set('dateFrom', new Date(filters.dateFrom).toISOString());
      if (filters.dateTo) params.set('dateTo', new Date(filters.dateTo).toISOString());
      params.set('limit', '100');

      const { data } = await apiClient.get(`/super/audit-logs?${params.toString()}`);
      setLogs(data.logs);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleClearFilters = () => {
    setFilters({ schoolId: '', eventType: '', dateFrom: '', dateTo: '' });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Audit Logs</h1>

      {/* Filters */}
      <form onSubmit={handleFilter} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">School ID</label>
            <input
              type="text"
              value={filters.schoolId}
              onChange={(e) => setFilters((f) => ({ ...f, schoolId: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Filter by school ID"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Event Type</label>
            <select
              value={filters.eventType}
              onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Events</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">From Date</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">To Date</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
          >
            Apply Filters
          </button>
          <button
            type="button"
            onClick={handleClearFilters}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
          >
            Clear
          </button>
        </div>
      </form>

      {/* Logs Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-gray-400">Loading logs...</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="px-4 py-3 text-sm font-medium text-gray-400">#</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Event</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Actor</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">School</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Timestamp</th>
                <th className="px-4 py-3 text-sm font-medium text-gray-400">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                    {log.sequenceNum}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300">
                      {log.eventType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-sm">
                    {log.actorRole ? (
                      <span className="text-xs text-gray-500">{log.actorRole}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-sm font-mono">
                    {log.schoolId ? log.schoolId.slice(0, 8) + '...' : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                    {JSON.stringify(log.resourceSnapshot).slice(0, 80)}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className="text-center text-gray-400 py-12">No audit logs found.</div>
      )}
    </div>
  );
};

export default AuditLogPage;
