import React, { useEffect, useState, useCallback, useRef } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface Metrics {
  avgResponseTime: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
}

interface EndpointStats {
  endpoint: string;
  callCount: number;
  avgLatency: number;
}

interface SlowRequest {
  id: string;
  endpoint: string;
  duration: number;
  method: string;
  timestamp: string;
  statusCode: number;
}

interface PerformanceData {
  metrics: Metrics;
  topEndpoints: EndpointStats[];
  slowRequests: SlowRequest[];
}

const PerformancePage: React.FC = () => {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get('/super/performance/metrics');
      setData(res.data);
      setApiError(null);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to load performance metrics.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 10000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchData]);

  const maxCallCount = Math.max(1, ...(data?.topEndpoints ?? []).map((e) => e.callCount));

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading performance metrics…
        </div>
      </div>
    );
  }

  const m = data?.metrics;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Performance</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Live API metrics, endpoint latency breakdowns, and slow request tracking.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              className="rounded-xl border border-gray-700/80 bg-gray-800/80 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
            >
              Refresh
            </button>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <span>Auto</span>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  autoRefresh ? 'bg-indigo-500' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    autoRefresh ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Avg Response Time</p>
          <p className="mt-2 text-2xl font-bold text-white">{m?.avgResponseTime.toFixed(1) ?? '—'} ms</p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Error Rate</p>
          <p className={`mt-2 text-2xl font-bold ${(m?.errorRate ?? 0) > 5 ? 'text-red-400' : 'text-emerald-400'}`}>
            {m?.errorRate.toFixed(2) ?? '—'}%
          </p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">p50 Latency</p>
          <p className="mt-2 text-2xl font-bold text-white">{m?.p50.toFixed(1) ?? '—'} ms</p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">p95 Latency</p>
          <p className="mt-2 text-2xl font-bold text-amber-400">{m?.p95.toFixed(1) ?? '—'} ms</p>
        </div>
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">p99 Latency</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{m?.p99.toFixed(1) ?? '—'} ms</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Top endpoints bar chart */}
        <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
          <div className="mb-4 border-b border-gray-700/80 pb-3">
            <h2 className="text-lg font-semibold text-white">Top Endpoints</h2>
            <p className="text-sm text-gray-400">By call count</p>
          </div>
          <div className="space-y-3">
            {(data?.topEndpoints ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-gray-500">No data yet</p>
            )}
            {(data?.topEndpoints ?? []).map((ep) => {
              const width = `${Math.max(4, Math.round((ep.callCount / maxCallCount) * 100))}%`;
              return (
                <div key={ep.endpoint} className="rounded-xl border border-gray-700 bg-gray-900/45 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-200 font-mono text-xs truncate max-w-[60%]">{ep.endpoint}</span>
                    <span className="text-gray-400 font-mono text-xs">{ep.callCount.toLocaleString()} calls</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-2 overflow-hidden rounded-full bg-gray-700/70">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width }} />
                    </div>
                    <span className="text-xs text-gray-500 font-mono">{ep.avgLatency.toFixed(0)}ms avg</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Slow requests table */}
        <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
          <div className="mb-4 border-b border-gray-700/80 pb-3">
            <h2 className="text-lg font-semibold text-white">Slow Requests</h2>
            <p className="text-sm text-gray-400">Duration > 1 second</p>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/80">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Method</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Endpoint</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Duration</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.slowRequests ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-500">No slow requests</td>
                  </tr>
                )}
                {(data?.slowRequests ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                    <td className="px-3 py-2 font-mono text-xs text-gray-300">{r.method}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-200 truncate max-w-[200px]">{r.endpoint}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-red-400">{r.duration.toFixed(0)}ms</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        r.statusCode >= 500 ? 'bg-red-900/50 text-red-300' :
                        r.statusCode >= 400 ? 'bg-amber-900/50 text-amber-300' :
                        'bg-gray-700 text-gray-300'
                      }`}>{r.statusCode}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PerformancePage;
