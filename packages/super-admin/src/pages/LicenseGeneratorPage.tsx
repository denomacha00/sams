import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

const PLAN_TIERS = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as const;

interface LicenseKey {
  id: string;
  planTier: string;
  schoolName: string;
  expiresAt: string;
  usedAt: string | null;
  usedBySchoolId: string | null;
  createdAt: string;
}

const LicenseGeneratorPage: React.FC = () => {
  const [schoolName, setSchoolName] = useState('');
  const [planTier, setPlanTier] = useState<string>('BASIC');
  const [expiresAt, setExpiresAt] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [licenses, setLicenses] = useState<LicenseKey[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unused' | 'used' | 'expired'>('all');

  const fetchLicenses = async () => {
    try {
      const params = new URLSearchParams();
      if (filter === 'unused') params.set('used', 'false');
      if (filter === 'used') params.set('used', 'true');
      if (filter === 'expired') params.set('expired', 'true');
      const { data } = await apiClient.get(`/super/licenses?${params.toString()}`);
      setLicenses(data.licenses);
    } catch (err) {
      console.error('Failed to fetch licenses:', err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    setListLoading(true);
    void fetchLicenses();
  }, [filter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setGeneratedKey(null);
    setLoading(true);

    try {
      const { data } = await apiClient.post('/super/licenses', {
        schoolName,
        planTier,
        expiresAt: new Date(expiresAt).toISOString(),
      });
      setGeneratedKey(data.licenseKey);
      setSchoolName('');
      setExpiresAt('');
      await fetchLicenses();
    } catch (err: unknown) {
      setError(getSuperAdminApiError(err, 'Failed to generate license key'));
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (license: LicenseKey) => {
    if (!confirm(`Revoke unused license for "${license.schoolName}"? This cannot be undone.`)) return;
    setRevokingId(license.id);
    try {
      await apiClient.post(`/super/licenses/${license.id}/revoke`);
      await fetchLicenses();
    } catch (err) {
      console.error('Failed to revoke license:', err);
      alert(getSuperAdminApiError(err, 'Failed to revoke license'));
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopy = async () => {
    if (generatedKey) {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white">License Management</h1>

      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-6">
        <h2 className="text-lg font-semibold text-white">Generate New Key</h2>
        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="schoolName" className="block text-sm font-medium text-gray-300 mb-1">
            School Name
          </label>
          <input
            id="schoolName"
            type="text"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Kenya High School"
            required
            minLength={2}
            maxLength={100}
          />
        </div>

        <div>
          <label htmlFor="planTier" className="block text-sm font-medium text-gray-300 mb-1">
            Plan Tier
          </label>
          <select
            id="planTier"
            value={planTier}
            onChange={(e) => setPlanTier(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PLAN_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="expiresAt" className="block text-sm font-medium text-gray-300 mb-1">
            Expiry Date
          </label>
          <input
            id="expiresAt"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            min={new Date().toISOString().split('T')[0]}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Generating...' : 'Generate License Key'}
        </button>
      </form>

      {generatedKey && (
        <div className="bg-green-900/30 border border-green-600 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-green-400 font-semibold">License Key Generated</h3>
            <span className="text-indigo-300 text-xs">Store securely — shown only once</span>
          </div>
          <div className="bg-gray-900 rounded p-4 font-mono text-sm text-green-300 break-all">
            {generatedKey}
          </div>
          <button
            onClick={handleCopy}
            className="mt-3 px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded transition-colors"
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      )}

      {/* License List */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Issued Licenses</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          >
            <option value="all">All</option>
            <option value="unused">Unused</option>
            <option value="used">Used</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {listLoading ? (
          <p className="text-gray-400 text-sm">Loading licenses...</p>
        ) : licenses.length === 0 ? (
          <p className="text-gray-500 text-center py-6">No licenses match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-3 py-2 text-xs font-medium text-gray-400">School</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-400">Plan</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-400">Expires</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-400">Status</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((lic) => {
                  const isExpired = new Date(lic.expiresAt) < new Date();
                  return (
                    <tr key={lic.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="px-3 py-3 text-white text-sm">{lic.schoolName}</td>
                      <td className="px-3 py-3">
                        <span className="px-2 py-0.5 text-xs rounded bg-blue-900/50 text-blue-300">
                          {lic.planTier}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-300 text-sm">
                        {new Date(lic.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-3">
                        {lic.usedAt ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-green-900/50 text-green-300">
                            Used
                          </span>
                        ) : isExpired ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300">
                            Expired
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">
                            Unused
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {!lic.usedAt && (
                          <button
                            onClick={() => handleRevoke(lic)}
                            disabled={revokingId === lic.id}
                            className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 disabled:opacity-50 text-red-200 rounded transition-colors"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default LicenseGeneratorPage;
