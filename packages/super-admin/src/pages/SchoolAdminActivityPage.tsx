import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface SchoolAdminAction {
  id: string;
  eventType: string;
  schoolId: string | null;
  school: { name: string } | null;
  actor: { fullName: string; email: string } | null;
  actorRole: string | null;
  resourceSnapshot: Record<string, unknown> | null;
  createdAt: string;
}

const SchoolAdminActivityPage: React.FC = () => {
  const [actions, setActions] = useState<SchoolAdminAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiClient.get('/super/activity/school-admins');
        setActions(Array.isArray(res.data) ? res.data : []);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load admin activity.'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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
                    <td className="px-3 py-2 text-gray-200">{a.actor?.fullName ?? 'Unknown'}</td>
                    <td className="px-3 py-2 text-gray-400">{a.school?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-gray-700/50 px-2 py-0.5 text-xs font-medium text-gray-300">
                        {a.eventType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-400">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-gray-500">
                      {expandedId === a.id ? '▲' : '▼'}
                    </td>
                  </tr>
                  {expandedId === a.id && a.resourceSnapshot && (
                    <tr className="border-b border-gray-700/30 bg-gray-900/50">
                      <td colSpan={5} className="px-4 py-3">
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                          {JSON.stringify(a.resourceSnapshot, null, 2)}
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
