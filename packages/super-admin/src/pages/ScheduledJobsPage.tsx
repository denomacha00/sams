import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface ScheduledJob {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  handler: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunDurationMs: number | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ScheduledJobsPage: React.FC = () => {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/super/jobs');
      setJobs(Array.isArray(res.data) ? res.data : []);
      setApiError(null);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to load scheduled jobs.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, []);

  const handleToggle = async (job: ScheduledJob) => {
    setUpdating(job.id);
    setApiError(null);
    try {
      await apiClient.put(`/super/jobs/${job.id}`, { enabled: !job.enabled });
      await fetchJobs();
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to update job.'));
    } finally {
      setUpdating(null);
    }
  };

  const handleRunNow = async (jobId: string) => {
    setRunning(jobId);
    setApiError(null);
    try {
      await apiClient.post(`/super/jobs/${jobId}/run`);
      await fetchJobs();
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to run job.'));
    } finally {
      setRunning(null);
    }
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300">
          Loading scheduled jobs…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-gray-800 via-gray-800 to-cyan-950/25 p-7 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Job scheduling</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Scheduled Job Manager</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              View and manage cron jobs — expiry checks, report generation, SMS retry, data cleanup, and more.
            </p>
          </div>
          <button
            onClick={fetchJobs}
            className="rounded-xl border border-gray-700/80 bg-gray-800/80 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">{apiError}</div>
      )}

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">All Jobs</h2>
          <p className="text-sm text-gray-400">{jobs.length} job{jobs.length !== 1 ? 's' : ''} registered</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Job</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Schedule</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Last Run</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Duration</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">Enabled</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                    No scheduled jobs registered.
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                  <td className="px-3 py-3">
                    <p className="font-medium text-white">{job.name}</p>
                    {job.description && <p className="text-xs text-gray-500 mt-0.5">{job.description}</p>}
                    <p className="text-xs text-gray-600 font-mono mt-0.5">{job.handler}</p>
                  </td>
                  <td className="px-3 py-3">
                    <code className="rounded bg-gray-700/60 px-2 py-0.5 text-xs text-cyan-300 font-mono">
                      {job.cronExpression}
                    </code>
                  </td>
                  <td className="px-3 py-3">
                    {job.lastRunAt ? (
                      <div className="text-xs text-gray-400">
                        <p>{new Date(job.lastRunAt).toLocaleString()}</p>
                        <span className={`font-medium ${
                          job.lastRunStatus === 'COMPLETED' ? 'text-emerald-400' :
                          job.lastRunStatus === 'FAILED' ? 'text-red-400' :
                          job.lastRunStatus === 'RUNNING' ? 'text-blue-400' :
                          'text-gray-500'
                        }`}>
                          {job.lastRunStatus || '—'}
                        </span>
                        {job.lastRunError && <p className="text-red-400 mt-0.5 truncate max-w-[200px]" title={job.lastRunError}>{job.lastRunError}</p>}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Never run</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400 font-mono">
                    {formatDuration(job.lastRunDurationMs)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span
                      onClick={() => handleToggle(job)}
                      className={`inline-block h-6 w-11 rounded-full cursor-pointer transition-colors ${
                        job.enabled ? 'bg-emerald-500' : 'bg-gray-600'
                      } ${updating === job.id ? 'opacity-50' : ''}`}
                    >
                      <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transform transition-transform ${
                        job.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => handleRunNow(job.id)}
                      disabled={running === job.id}
                      className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-950/40 disabled:opacity-50 transition-colors"
                    >
                      {running === job.id ? 'Running…' : 'Run Now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ScheduledJobsPage;
