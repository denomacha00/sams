import React, { useState } from 'react';
import apiClient from '../services/apiClient';

const PLAN_TIERS = ['TRIAL', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE'] as const;

const LicenseGeneratorPage: React.FC = () => {
  const [schoolName, setSchoolName] = useState('');
  const [planTier, setPlanTier] = useState<string>('BASIC');
  const [expiresAt, setExpiresAt] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate license key');
    } finally {
      setLoading(false);
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
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white">Generate License Key</h1>

      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-6">
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

      {/* Generated Key Display */}
      {generatedKey && (
        <div className="bg-green-900/30 border border-green-600 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-green-400 font-semibold">License Key Generated</h3>
            <span className="text-yellow-400 text-xs">⚠ Store securely — shown only once</span>
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
    </div>
  );
};

export default LicenseGeneratorPage;
