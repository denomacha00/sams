import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../services/apiClient';

interface RegistrationLink {
  id: string;
  token: string;
  targetRole: string;
  classId?: string;
  useCount: number;
  maxUses: number;
  expiresAt: string;
  createdAt: string;
}

interface LinkFormData {
  classId: string;
  expiryDays: number;
  maxUses: number;
  targetRole: string;
}

const RegistrationLinksPage: React.FC = () => {
  const [links, setLinks] = useState<RegistrationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<LinkFormData>({
    classId: '',
    expiryDays: 7,
    maxUses: 50,
    targetRole: 'STUDENT',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchLinks();
  }, []);

  const fetchLinks = async () => {
    try {
      const { data } = await apiClient.get('/registration-links');
      setLinks(data.links || data || []);
    } catch (err) {
      console.error('Failed to fetch links:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await apiClient.post('/registration-links', {
        classId: formData.classId || undefined,
        expiryDays: formData.expiryDays,
        maxUses: formData.maxUses,
        targetRole: formData.targetRole,
      });
      setShowModal(false);
      fetchLinks();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to generate link');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = (token: string, id: string) => {
    const url = `${window.location.origin}/register/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this registration link?')) return;
    try {
      await apiClient.delete(`/registration-links/${id}`);
      fetchLinks();
    } catch (err) {
      alert('Failed to delete link');
    }
  };

  const getLinkStatus = (link: RegistrationLink) => {
    const now = new Date();
    const expires = new Date(link.expiresAt);
    if (link.useCount >= link.maxUses) return { label: 'Exhausted', color: 'bg-orange-500/20 text-orange-300' };
    if (expires < now) return { label: 'Expired', color: 'bg-red-500/20 text-red-300' };
    return { label: 'Active', color: 'bg-green-500/20 text-green-300' };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-gray-400 hover:text-cyan-400 transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-white">Registration Links</h1>
          </div>
          <button
            onClick={() => { setError(''); setShowModal(true); }}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            + Generate Link
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Token</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Target Role</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Uses</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Expires</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Status</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">Loading...</td>
                  </tr>
                ) : links.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No registration links yet</td>
                  </tr>
                ) : (
                  links.map((link) => {
                    const status = getLinkStatus(link);
                    return (
                      <tr key={link.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 text-sm text-gray-300 font-mono">
                          {link.token.substring(0, 12)}...
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300">
                            {link.targetRole}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-300">
                          {link.useCount} / {link.maxUses}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-400">
                          {new Date(link.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => copyLink(link.token, link.id)}
                            className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors mr-3"
                          >
                            {copiedId === link.id ? '✓ Copied' : 'Copy Link'}
                          </button>
                          <button
                            onClick={() => handleDelete(link.id)}
                            className="text-red-400 hover:text-red-300 text-sm transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Generate Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl bg-slate-800/90 border border-white/10 rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">Generate Registration Link</h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Target Role *</label>
                <select
                  value={formData.targetRole}
                  onChange={(e) => setFormData({ ...formData, targetRole: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                >
                  <option value="STUDENT" className="bg-slate-800">Student</option>
                  <option value="TEACHER" className="bg-slate-800">Teacher</option>
                  <option value="HOD" className="bg-slate-800">HOD</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Class ID (optional)</label>
                <input
                  type="text"
                  value={formData.classId}
                  onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="Class ID for students"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Expiry (days) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={formData.expiryDays}
                    onChange={(e) => setFormData({ ...formData, expiryDays: parseInt(e.target.value) || 7 })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Max Uses *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={formData.maxUses}
                    onChange={(e) => setFormData({ ...formData, maxUses: parseInt(e.target.value) || 50 })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Generating...' : 'Generate Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-500">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default RegistrationLinksPage;
