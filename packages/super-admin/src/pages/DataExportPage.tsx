import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

type ExportType = 'users' | 'schools' | 'sessions' | 'payments' | 'attendance';
type ExportFormat = 'csv' | 'xlsx';
type ExportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface ExportRecord {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  requestedBy: string;
  createdAt: string;
  completedAt?: string;
  fileUrl?: string;
}

interface BackupRecord {
  id: string;
  size: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

const STATUS_STYLES: Record<ExportStatus, string> = {
  PENDING: 'bg-gray-600/30 text-gray-300',
  PROCESSING: 'bg-blue-500/20 text-blue-300',
  COMPLETED: 'bg-emerald-500/20 text-emerald-300',
  FAILED: 'bg-red-500/20 text-red-300',
};

const EXPORT_TYPES: ExportType[] = ['users', 'schools', 'sessions', 'payments', 'attendance'];
const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx'];

const DataExportPage: React.FC = () => {
  const [exportType, setExportType] = useState<ExportType>('users');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const fetchData = async () => {
    try {
      const [exportsRes, backupsRes] = await Promise.all([
        apiClient.get('/super/export/list'),
        apiClient.get('/super/backup/list'),
      ]);
      setExports(exportsRes.data);
      setBackups(backupsRes.data);
      setApiError(null);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to load exports data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    setApiError(null);
    try {
      const res = await apiClient.post('/super/export/trigger', { type: exportType, format: exportFormat });
      setExports((prev) => [res.data, ...prev]);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to start export.'));
    } finally {
      setExporting(false);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    setApiError(null);
    try {
      const res = await apiClient.post('/super/backup/trigger');
      setBackups((prev) => [res.data, ...prev]);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to trigger backup.'));
    } finally {
      setBackingUp(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading data export…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <h1 className="text-3xl font-bold tracking-tight text-white">Data Export & Backup</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
          Export platform data in CSV or Excel format, and manage database backups.
        </p>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      {/* Export form */}
      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">Create Export</h2>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">Data Type</label>
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value as ExportType)}
              className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
            >
              {EXPORT_TYPES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">Format</label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className="rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Start Export'}
          </button>
        </div>
      </section>

      {/* Recent exports table */}
      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">Recent Exports</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Format</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Requested By</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Date</th>
              </tr>
            </thead>
            <tbody>
              {exports.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">No exports yet</td>
                </tr>
              )}
              {exports.map((e) => (
                <tr key={e.id} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                  <td className="px-3 py-2 text-gray-200">{e.type}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{e.format.toUpperCase()}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{e.requestedBy}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400">{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Backup section */}
      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between border-b border-gray-700/80 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Backups</h2>
            <p className="text-sm text-gray-400">Database backup history</p>
          </div>
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {backingUp ? 'Triggering…' : 'Trigger Backup'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/80">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Size</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Created</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Completed</th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-500">No backups yet</td>
                </tr>
              )}
              {backups.map((b) => (
                <tr key={b.id} className="border-b border-gray-700/30 last:border-0 hover:bg-gray-700/30">
                  <td className="px-3 py-2 text-xs text-gray-200">{b.size || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      b.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' :
                      b.status === 'FAILED' ? 'bg-red-500/20 text-red-300' :
                      'bg-gray-600/30 text-gray-300'
                    }`}>{b.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400">{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-400">
                    {b.completedAt ? new Date(b.completedAt).toLocaleString() : '—'}
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

export default DataExportPage;
