import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

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

const SchoolsListPage: React.FC = () => {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [extendModal, setExtendModal] = useState<{ schoolId: string; schoolName: string } | null>(null);
  const [newExpiry, setNewExpiry] = useState('');

  const fetchSchools = async () => {
    try {
      const { data } = await apiClient.get('/super/schools');
      setSchools(data.schools);
    } catch (err) {
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Schools</h1>

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
            {schools.map((school) => (
              <tr key={school.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                <td className="px-4 py-3 text-white font-medium">{school.name}</td>
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
                    <span className="px-2 py-1 text-xs rounded bg-yellow-900/50 text-yellow-300">
                      Read-Only
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs rounded bg-green-900/50 text-green-300">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
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
