import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

const FEATURES = ['OTP_LOGIN', 'BIOMETRIC', 'CUSTOM_BRANDING', 'API_ACCESS', 'QR_ONLY', 'GUARDIAN_PORTAL', 'EXAM_MODULE'] as const;

interface SchoolFeature {
  schoolId: string;
  schoolName: string;
  features: Record<string, boolean>;
}

interface FeatureFlagsPageProps {}

const FeatureFlagsPage: React.FC<FeatureFlagsPageProps> = () => {
  const [schools, setSchools] = useState<SchoolFeature[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiClient.get('/super/features/flags');
        setSchools(res.data);
        setApiError(null);
      } catch (err: unknown) {
        setApiError(getSuperAdminApiError(err, 'Failed to load feature flags.'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleToggle = async (schoolId: string, feature: string, current: boolean) => {
    setToggling(`${schoolId}-${feature}`);
    try {
      await apiClient.put(`/super/features/flags/${schoolId}`, { featureKey: feature, enabled: !current });
      setSchools((prev) =>
        prev.map((s) =>
          s.schoolId === schoolId ? { ...s, features: { ...s.features, [feature]: !current } } : s,
        ),
      );
      setApiError(null);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to toggle feature.'));
    } finally {
      setToggling(null);
    }
  };

  const filtered = schools.filter((s) =>
    s.schoolName.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300 shadow-lg">
          Loading feature flags…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-gray-700/80 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/40 p-7 shadow-xl shadow-black/20">
        <h1 className="text-3xl font-bold tracking-tight text-white">Feature Flags</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
          Toggle feature availability per school to control access to OTP login, biometrics, custom branding, API access, and more.
        </p>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {apiError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search schools…"
          className="w-full max-w-xs rounded-xl border border-gray-700/80 bg-gray-800/80 px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
        />
        <span className="text-sm text-gray-500">{filtered.length} school{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-700/80 bg-gray-800/80 shadow-lg shadow-black/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700/80">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">School</th>
              {FEATURES.map((f) => (
                <th key={f} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {f.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((school) => (
              <tr key={school.schoolId} className="border-b border-gray-700/50 last:border-0 hover:bg-gray-700/30">
                <td className="px-4 py-3 font-medium text-white">{school.schoolName}</td>
                {FEATURES.map((feature) => {
                  const enabled = school.features[feature] ?? false;
                  const isToggling = toggling === `${school.schoolId}-${feature}`;
                  return (
                    <td key={feature} className="px-3 py-3 text-center">
                      <button
                        onClick={() => handleToggle(school.schoolId, feature, enabled)}
                        disabled={isToggling}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          enabled ? 'bg-emerald-500' : 'bg-gray-600'
                        } ${isToggling ? 'opacity-50' : 'cursor-pointer'} focus:outline-none`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-6' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span
                        className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          enabled
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                      >
                        {enabled ? 'ON' : 'OFF'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={FEATURES.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">
                  No schools match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FeatureFlagsPage;
