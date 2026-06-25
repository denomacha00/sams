import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface SecuritySummary {
  failedLogins24h: number;
  failedLogins7d: number;
  suspendedAccounts: number;
  uniqueIPs: number;
  suspiciousEvents: number;
}

interface SecurityEvent {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  message: string;
  ipAddress: string;
  userId?: string;
  timestamp: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/30',
  HIGH: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  INFO: 'bg-gray-600/30 text-gray-300 border-gray-600/30',
};

const SecurityDashboardPage: React.FC = () => {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [summaryRes, eventsRes] = await Promise.all([
          apiClient.get('/super/security/summary'),
          apiClient.get('/super/security/events'),
        ]);
        setSummary(summaryRes.data);
        setEvents(Array.isArray(eventsRes.data.events) ? eventsRes.data.events : []);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load security data.'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filteredEvents = events.filter((e) => {
    if (severityFilter && e.severity !== severityFilter) return false;
    if (typeFilter && e.type !== typeFilter) return false;
    return true;
  });

  const eventTypes = [...new Set(events.map((e) => e.type))];

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading security dashboard…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <h1 className="text-3xl font-bold tracking-tight text-white">Security Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
          Monitor failed logins, suspicious activity, and platform-wide security events.
        </p>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Failed logins (24h)</p>
          <p className={`mt-2 text-2xl font-bold ${(summary?.failedLogins24h ?? 0) > 10 ? 'text-red-400' : 'text-gray-200'}`}>
            {summary?.failedLogins24h.toLocaleString() ?? '—'}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Failed logins (7d)</p>
          <p className="mt-2 text-2xl font-bold text-gray-200">{summary?.failedLogins7d.toLocaleString() ?? '—'}</p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Suspended accounts</p>
          <p className="mt-2 text-2xl font-bold text-amber-400">{summary?.suspendedAccounts.toLocaleString() ?? '—'}</p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Unique IPs</p>
          <p className="mt-2 text-2xl font-bold text-blue-400">{summary?.uniqueIPs.toLocaleString() ?? '—'}</p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Suspicious events</p>
          <p className={`mt-2 text-2xl font-bold ${(summary?.suspiciousEvents ?? 0) > 0 ? 'text-red-400' : 'text-gray-200'}`}>
            {summary?.suspiciousEvents.toLocaleString() ?? '—'}
          </p>
        </div>
      </div>

      {/* Filters + events table */}
      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">Security Events</h2>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="INFO">INFO</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
          >
            <option value="">All Types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">{filteredEvents.length} events</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Severity</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Message</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">IP</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">No security events match your filters.</td>
                </tr>
              )}
              {filteredEvents.map((e) => (
                <tr key={e.id} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[e.severity]}`}>
                      {e.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-300">{e.type}</td>
                  <td className="px-3 py-2 text-xs text-gray-200 max-w-[300px] truncate">{e.message}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400">{e.ipAddress}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400">{new Date(e.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default SecurityDashboardPage;
