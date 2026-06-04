import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface School {
  id: string;
  name: string;
  schoolCode: string;
  planTier: string;
  licenseExpiresAt: string;
  isSuspended: boolean;
  isReadOnly: boolean;
  createdAt: string;
  stats: {
    totalUsers: number;
    totalSessions: number;
  };
}

interface SchoolDetail extends School {
  logoUrl: string | null;
  primaryColor: string | null;
  updatedAt: string;
  stats: {
    totalUsers: number;
    totalSessions: number;
    totalPayments: number;
  };
  recentPayments: Array<{
    id: string;
    amount: number;
    planTier: string;
    status: string;
    completedAt: string | null;
    mpesaReceiptNumber: string | null;
  }>;
}

const SchoolsListPage: React.FC = () => {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [extendModal, setExtendModal] = useState<{ schoolId: string; schoolName: string } | null>(null);
  const [newExpiry, setNewExpiry] = useState('');
  const [detailModal, setDetailModal] = useState<SchoolDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchSchools = async () => {
    try {
      const { data } = await apiClient.get('/super/schools');
      setSchools(data.schools);
      setApiError(null);
    } catch (err) {
      setApiError(getSuperAdminApiError(err, 'Failed to load schools.'));
      console.error('Failed to fetch schools:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchools();
  }, []);

  const handleSuspend = async (schoolId: string) => {
    setActionLoading(schoolId);
    try {
      await apiClient.post(`/super/schools/${schoolId}/suspend`);
      await fetchSchools();
    } catch (err) {
      console.error('Failed to suspend school:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnsuspend = async (schoolId: string) => {
    setActionLoading(schoolId);
    try {
      await apiClient.post(`/super/schools/${schoolId}/unsuspend`);
      await fetchSchools();
    } catch (err) {
      console.error('Failed to unsuspend school:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (schoolId: string, schoolName: string) => {
    if (!confirm(`Are you sure you want to DELETE "${schoolName}"? This will permanently remove ALL data for this school including users, attendance records, and payments. This cannot be undone.`)) return;
    if (!confirm(`FINAL WARNING: Type the school name to confirm deletion. This is "${schoolName}". Proceed?`)) return;
    setActionLoading(schoolId);
    try {
      await apiClient.delete(`/super/schools/${schoolId}`);
      await fetchSchools();
    } catch (err) {
      console.error('Failed to delete school:', err);
      alert('Failed to delete school. Check console for details.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewDetail = async (schoolId: string) => {
    setDetailLoading(schoolId);
    try {
      const { data } = await apiClient.get(`/super/schools/${schoolId}`);
      setDetailModal(data);
    } catch (err) {
      console.error('Failed to load school details:', err);
      alert(getSuperAdminApiError(err, 'Failed to load school details.'));
    } finally {
      setDetailLoading(null);
    }
  };

  const handleExtend = async () => {
    if (!extendModal || !newExpiry) return;
    setActionLoading(extendModal.schoolId);
    try {
      await apiClient.post(`/super/schools/${extendModal.schoolId}/extend`, {
        newExpiry: new Date(newExpiry).toISOString(),
      });
      setExtendModal(null);
      setNewExpiry('');
      await fetchSchools();
    } catch (err) {
      console.error('Failed to extend license:', err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg">Loading schools...</div>
      </div>
    );
  }

  const filteredSchools = schools.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.schoolCode.toLowerCase().includes(q) ||
      s.planTier.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Schools</h1>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, code, or plan…"
          className="w-full sm:w-72 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {apiError && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
          {apiError}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-3 text-sm font-medium text-gray-400">School</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Code</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Plan</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Expires</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Users</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Status</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSchools.map((school) => (
              <tr key={school.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                <td className="px-4 py-3 text-white font-medium">
                  <button
                    type="button"
                    onClick={() => void handleViewDetail(school.id)}
                    disabled={detailLoading === school.id}
                    className="text-left hover:text-blue-300 transition-colors disabled:opacity-50"
                  >
                    {school.name}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-300 font-mono text-sm">{school.schoolCode}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 text-xs rounded bg-blue-900/50 text-blue-300">
                    {school.planTier}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300 text-sm">
                  {new Date(school.licenseExpiresAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-gray-300">{school.stats.totalUsers}</td>
                <td className="px-4 py-3">
                  {school.isSuspended ? (
                    <span className="px-2 py-1 text-xs rounded bg-red-900/50 text-red-300">
                      Suspended
                    </span>
                  ) : school.isReadOnly ? (
                    <span className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300">
                      Read-Only
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs rounded bg-green-900/50 text-green-300">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void handleViewDetail(school.id)}
                      disabled={detailLoading === school.id}
                      className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors"
                    >
                      View
                    </button>
                    {school.isSuspended ? (
                      <button
                        onClick={() => handleUnsuspend(school.id)}
                        disabled={actionLoading === school.id}
                        className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded transition-colors"
                      >
                        Unsuspend
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSuspend(school.id)}
                        disabled={actionLoading === school.id}
                        className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
                      >
                        Suspend
                      </button>
                    )}
                    <button
                      onClick={() => setExtendModal({ schoolId: school.id, schoolName: school.name })}
                      disabled={actionLoading === school.id}
                      className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded transition-colors"
                    >
                      Extend
                    </button>
                    <button
                      onClick={() => handleDelete(school.id, school.name)}
                      disabled={actionLoading === school.id}
                      className="px-3 py-1 text-xs bg-red-900 hover:bg-red-800 disabled:opacity-50 text-red-200 rounded transition-colors border border-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {schools.length === 0 && (
        <div className="text-center text-gray-400 py-12">No schools registered yet.</div>
      )}
      {schools.length > 0 && filteredSchools.length === 0 && (
        <div className="text-center text-gray-400 py-12">No schools match your search.</div>
      )}

      {/* School Detail Modal */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg w-full max-w-lg border border-gray-700 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-700 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{detailModal.name}</h3>
                <p className="text-sm text-gray-400 font-mono mt-1">{detailModal.schoolCode}</p>
              </div>
              <button
                onClick={() => setDetailModal(null)}
                className="text-gray-400 hover:text-white text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-gray-500">Plan</p>
                  <p className="text-white">{detailModal.planTier}</p>
                </div>
                <div>
                  <p className="text-gray-500">License expires</p>
                  <p className="text-white">
                    {new Date(detailModal.licenseExpiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Users</p>
                  <p className="text-white">{detailModal.stats.totalUsers}</p>
                </div>
                <div>
                  <p className="text-gray-500">Sessions</p>
                  <p className="text-white">{detailModal.stats.totalSessions}</p>
                </div>
                <div>
                  <p className="text-gray-500">Payments</p>
                  <p className="text-white">{detailModal.stats.totalPayments}</p>
                </div>
                <div>
                  <p className="text-gray-500">Status</p>
                  <p className="text-white">
                    {detailModal.isSuspended
                      ? 'Suspended'
                      : detailModal.isReadOnly
                        ? 'Read-only'
                        : 'Active'}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-gray-500 mb-2">Recent successful payments</p>
                {detailModal.recentPayments.length === 0 ? (
                  <p className="text-gray-400">None recorded</p>
                ) : (
                  <ul className="space-y-2">
                    {detailModal.recentPayments.map((p) => (
                      <li
                        key={p.id}
                        className="flex justify-between gap-2 bg-gray-900/50 rounded px-3 py-2"
                      >
                        <span className="text-gray-300">
                          KES {p.amount.toLocaleString()} · {p.planTier}
                        </span>
                        <span className="text-gray-500 text-xs">
                          {p.completedAt
                            ? new Date(p.completedAt).toLocaleDateString()
                            : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Created {new Date(detailModal.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Extend License Modal */}
      {extendModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">
              Extend License — {extendModal.schoolName}
            </h3>
            <div className="mb-4">
              <label htmlFor="newExpiry" className="block text-sm font-medium text-gray-300 mb-1">
                New Expiry Date
              </label>
              <input
                id="newExpiry"
                type="date"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setExtendModal(null); setNewExpiry(''); }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExtend}
                disabled={!newExpiry || actionLoading === extendModal.schoolId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                Extend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchoolsListPage;
