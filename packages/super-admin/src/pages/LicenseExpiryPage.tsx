import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface ExpiringSchool {
  id: string;
  name: string;
  schoolCode: string;
  planTier: string;
  licenseExpiresAt: string;
  isSuspended: boolean;
  isReadOnly: boolean;
  daysUntilExpiry: number;
}

const LicenseExpiryPage: React.FC = () => {
  const [schools, setSchools] = useState<ExpiringSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lookaheadDays, setLookaheadDays] = useState(30);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/super/license-expiry/summary?days=${lookaheadDays}`);
      setSchools(Array.isArray(res.data) ? res.data : []);
      setApiError(null);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to load license expiry data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [lookaheadDays]);

  const expired = schools.filter((s) => s.daysUntilExpiry <= 0);
  const warning = schools.filter((s) => s.daysUntilExpiry > 0 && s.daysUntilExpiry <= 7);
  const upcoming = schools.filter((s) => s.daysUntilExpiry > 7);

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300">
          Loading license expiry data…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-red-500/25 bg-gradient-to-br from-gray-800 via-gray-800 to-red-950/25 p-7 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">License monitoring</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">License Expiry Engine</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Auto-detect expiring licenses, view expiry risk, and take action before schools expire.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Look ahead:</label>
            <select
              value={lookaheadDays}
              onChange={(e) => setLookaheadDays(Number(e.target.value))}
              className="rounded-xl border border-gray-700/80 bg-gray-800/80 px-3 py-2 text-sm text-gray-200 focus:border-red-500/50 focus:outline-none"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
            <button
              onClick={fetchData}
              className="rounded-xl border border-gray-700/80 bg-gray-800/80 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-300">Expired</p>
          <p className="mt-2 text-3xl font-bold text-red-400">{expired.length}</p>
          <p className="mt-1 text-xs text-red-300/70">schools past their license expiry</p>
        </div>
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/40 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Expiring within 7 days</p>
          <p className="mt-2 text-3xl font-bold text-amber-400">{warning.length}</p>
          <p className="mt-1 text-xs text-amber-300/70">schools at immediate risk</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Upcoming expiries</p>
          <p className="mt-2 text-3xl font-bold text-emerald-400">{upcoming.length}</p>
          <p className="mt-1 text-xs text-emerald-300/70">schools expiring within {lookaheadDays} days</p>
        </div>
      </div>

      {/* Schools table */}
      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">Schools by Expiry</h2>
          <p className="text-sm text-gray-400">Sorted by closest expiry first</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">School</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Plan</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Expires</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Days Left</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {schools.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">
                    No schools expiring within {lookaheadDays} days.
                  </td>
                </tr>
              )}
              {schools.map((s) => {
                const urgency = s.daysUntilExpiry <= 0 ? 'expired' : s.daysUntilExpiry <= 7 ? 'warning' : 'ok';
                return (
                  <tr key={s.id} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                    <td className="px-3 py-3">
                      <div>
                        <p className="font-medium text-white">{s.name}</p>
                        <p className="text-xs text-gray-500 font-mono">{s.schoolCode}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded bg-blue-900/50 px-2 py-0.5 text-xs font-medium text-blue-300">
                        {s.planTier}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-300">
                      {new Date(s.licenseExpiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={`text-lg font-bold tabular-nums ${
                        urgency === 'expired' ? 'text-red-400' :
                        urgency === 'warning' ? 'text-amber-400' :
                        'text-emerald-400'
                      }`}>
                        {s.daysUntilExpiry <= 0 ? 'EXPIRED' : `${s.daysUntilExpiry}d`}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {s.isSuspended ? (
                        <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-300">Suspended</span>
                      ) : s.isReadOnly ? (
                        <span className="rounded bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300">Read-only</span>
                      ) : urgency === 'expired' ? (
                        <span className="rounded bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-300">Expired</span>
                      ) : (
                        <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default LicenseExpiryPage;
