import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface School {
  id: string;
  name: string;
  planTier: string;
}

interface ConfirmDialogState {
  open: boolean;
  action: string;
  schoolIds: string[];
  payload: Record<string, unknown>;
}

const BatchOperationsPage: React.FC = () => {
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [changePlan, setChangePlan] = useState('BASIC');
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [confirm, setConfirm] = useState<ConfirmDialogState>({ open: false, action: '', schoolIds: [], payload: {} });
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const res = await apiClient.get('/super/schools');
        setSchools(Array.isArray(res.data) ? res.data : res.data.schools ?? []);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load schools.'));
      } finally {
        setLoading(false);
      }
    };
    fetchSchools();
  }, []);

  const toggleSchool = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    const filteredIds = new Set(filtered.map((s) => s.id));
    const allSelected = filteredIds.size > 0 && filteredIds.size === selectedIds.size && [...filteredIds].every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set([...selectedIds].filter((id) => !filteredIds.has(id))));
    } else {
      setSelectedIds(new Set([...selectedIds, ...filteredIds]));
    }
  };

  const openConfirm = (action: string, payload: Record<string, unknown> = {}) => {
    if (selectedIds.size === 0) return;
    setConfirm({ open: true, action, schoolIds: [...selectedIds], payload });
  };

  const executeBatch = async () => {
    setExecuting(true);
    setApiError(null);
    try {
      const actionMap: Record<string, string> = {
        extend_license: '/super/batch/extend-licenses',
        change_plan: '/super/batch/change-plan',
        suspend: '/super/batch/suspend',
        unsuspend: '/super/batch/unsuspend',
        send_notification: '/super/batch/send-notification',
      };
      const url = actionMap[confirm.action];
      if (!url) throw new Error(`Unknown batch action: ${confirm.action}`);
      await apiClient.post(url, {
        schoolIds: confirm.schoolIds,
        ...confirm.payload,
      });
      setSelectedIds(new Set());
      setConfirm({ open: false, action: '', schoolIds: [], payload: {} });
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Batch operation failed.'));
    } finally {
      setExecuting(false);
    }
  };

  const filtered = schools.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading schools…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <h1 className="text-3xl font-bold tracking-tight text-white">Batch Operations</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
          Select multiple schools and perform bulk actions — extend licenses, change plans, suspend, unsuspend, or send notifications.
        </p>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* School picker */}
        <div className="xl:col-span-2 rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between border-b border-gray-700/80 pb-3">
            <h2 className="text-lg font-semibold text-white">Select Schools</h2>
            <span className="text-sm text-gray-400">{selectedIds.size} selected</span>
          </div>
          <div className="mb-3 flex items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schools…"
              className="flex-1 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
            />
            <button
              onClick={selectAllFiltered}
              className="rounded-xl border border-gray-700/80 px-3 py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-700"
            >
              {filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id)) ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {filtered.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-gray-700/50 bg-gray-900/30 px-4 py-2.5 cursor-pointer hover:bg-gray-700/30 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(s.id)}
                  onChange={() => toggleSchool(s.id)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500/50"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-200">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.planTier}</p>
                </div>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-500">No schools match your search.</p>
            )}
          </div>
        </div>

        {/* Action cards */}
        <div className="space-y-4">
          {/* Extend License */}
          <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-white mb-3">Extend License</h3>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="number"
                value={extendDays}
                onChange={(e) => setExtendDays(Number(e.target.value))}
                min={1}
                className="w-20 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
              />
              <span className="text-sm text-gray-400">days</span>
            </div>
            <button
              onClick={() => openConfirm('extend_license', { days: extendDays })}
              disabled={selectedIds.size === 0}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              Extend
            </button>
          </div>

          {/* Change Plan */}
          <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-white mb-3">Change Plan</h3>
            <select
              value={changePlan}
              onChange={(e) => setChangePlan(e.target.value)}
              className="w-full mb-3 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500/50 focus:outline-none"
            >
              {['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              onClick={() => openConfirm('change_plan', { planTier: changePlan })}
              disabled={selectedIds.size === 0}
              className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              Change Plan
            </button>
          </div>

          {/* Suspend */}
          <button
            onClick={() => openConfirm('suspend')}
            disabled={selectedIds.size === 0}
            className="w-full rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-950/60 disabled:opacity-50"
          >
            Suspend Selected ({selectedIds.size})
          </button>

          {/* Unsuspend */}
          <button
            onClick={() => openConfirm('unsuspend')}
            disabled={selectedIds.size === 0}
            className="w-full rounded-xl border border-emerald-500/30 bg-emerald-900/30 px-4 py-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-900/50 disabled:opacity-50"
          >
            Unsuspend Selected ({selectedIds.size})
          </button>

          {/* Send Notification */}
          <div className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-white mb-3">Send Notification</h3>
            <input
              type="text"
              value={notificationTitle}
              onChange={(e) => setNotificationTitle(e.target.value)}
              placeholder="Title"
              className="w-full mb-2 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
            />
            <textarea
              value={notificationMessage}
              onChange={(e) => setNotificationMessage(e.target.value)}
              placeholder="Message"
              rows={2}
              className="w-full mb-3 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none resize-none"
            />
            <button
              onClick={() => openConfirm('send_notification', { title: notificationTitle, message: notificationMessage })}
              disabled={selectedIds.size === 0 || !notificationTitle || !notificationMessage}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirm.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-2xl border border-gray-700/80 bg-gray-800 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">Confirm {confirm.action.replace(/_/g, ' ')}</h3>
            <p className="text-sm text-gray-400 mb-4">
              This action will affect <strong className="text-gray-200">{confirm.schoolIds.length}</strong> school{confirm.schoolIds.length !== 1 ? 's' : ''}.
            </p>
            {confirm.action === 'extend_license' && (
              <p className="text-sm text-gray-400 mb-4">Extending license by <strong className="text-gray-200">{String(confirm.payload.days)}</strong> days.</p>
            )}
            {confirm.action === 'change_plan' && (
              <p className="text-sm text-gray-400 mb-4">Changing plan to <strong className="text-gray-200">{String(confirm.payload.planTier)}</strong>.</p>
            )}
            {confirm.action === 'send_notification' && (
              <div className="text-sm text-gray-400 mb-4">
                <p>Title: <strong className="text-gray-200">{String(confirm.payload.title)}</strong></p>
                <p>Message: <strong className="text-gray-200">{String(confirm.payload.message)}</strong></p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirm({ open: false, action: '', schoolIds: [], payload: {} })}
                disabled={executing}
                className="rounded-xl border border-gray-700/80 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={executeBatch}
                disabled={executing}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {executing ? 'Executing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchOperationsPage;
