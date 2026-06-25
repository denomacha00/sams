import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface BrandTemplate {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface School {
  id: string;
  name: string;
}

const DEFAULT_COLORS = ['#4F46E5', '#6366F1', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#EA580C'];

const BrandTemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BrandTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [applying, setApplying] = useState<{ templateId: string; schoolId: string } | null>(null);
  const [form, setForm] = useState({ name: '', primaryColor: '#4F46E5', secondaryColor: '#6366F1', logoUrl: '', faviconUrl: '' });
  const [applyModal, setApplyModal] = useState<BrandTemplate | null>(null);
  const [applySchoolId, setApplySchoolId] = useState('');

  const fetchData = async () => {
    try {
      const [templatesRes, schoolsRes] = await Promise.all([
        apiClient.get('/super/brand-templates'),
        apiClient.get('/super/schools'),
      ]);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
      setSchools(Array.isArray(schoolsRes.data.schools) ? schoolsRes.data.schools : []);
      setApiError(null);
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to load data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setApiError(null);
    try {
      const payload = {
        name: form.name,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        logoUrl: form.logoUrl || undefined,
        faviconUrl: form.faviconUrl || undefined,
      };
      if (editing) {
        await apiClient.put(`/super/brand-templates/${editing.id}`, payload);
      } else {
        await apiClient.post('/super/brand-templates', payload);
      }
      setShowForm(false);
      setEditing(null);
      setForm({ name: '', primaryColor: '#4F46E5', secondaryColor: '#6366F1', logoUrl: '', faviconUrl: '' });
      await fetchData();
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to save template.'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (t: BrandTemplate) => {
    setEditing(t);
    setForm({
      name: t.name,
      primaryColor: t.primaryColor || '#4F46E5',
      secondaryColor: t.secondaryColor || '#6366F1',
      logoUrl: t.logoUrl || '',
      faviconUrl: t.faviconUrl || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setApiError(null);
    try {
      await apiClient.delete(`/super/brand-templates/${id}`);
      await fetchData();
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to delete template.'));
    } finally {
      setDeleting(null);
    }
  };

  const handleApply = async () => {
    if (!applyModal || !applySchoolId) return;
    setApplying({ templateId: applyModal.id, schoolId: applySchoolId });
    setApiError(null);
    try {
      await apiClient.post(`/super/brand-templates/${applyModal.id}/apply`, { schoolId: applySchoolId });
      setApplyModal(null);
      setApplySchoolId('');
    } catch (err: unknown) {
      setApiError(getSuperAdminApiError(err, 'Failed to apply template.'));
    } finally {
      setApplying(null);
    }
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm({ name: '', primaryColor: '#4F46E5', secondaryColor: '#6366F1', logoUrl: '', faviconUrl: '' });
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300">Loading brand templates…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-indigo-500/25 bg-gradient-to-br from-gray-800 via-gray-800 to-indigo-950/25 p-7 shadow-xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">Branding</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Global Branding Templates</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Set default logo, color, and favicon for new schools. Apply templates to existing schools.
            </p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              + Create Template
            </button>
          )}
        </div>
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">{apiError}</div>
      )}

      {showForm && (
        <section className="rounded-2xl border border-indigo-500/30 bg-gray-800/80 p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-white mb-4">{editing ? 'Edit Template' : 'Create Template'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full rounded-xl border border-gray-700/80 bg-gray-700/50 px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Primary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="h-10 w-10 rounded-lg border border-gray-700 cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    className="flex-1 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 font-mono focus:border-indigo-500/50 focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, primaryColor: c })}
                      className="h-6 w-6 rounded-full border border-gray-600 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Secondary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.secondaryColor}
                    onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                    className="h-10 w-10 rounded-lg border border-gray-700 cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={form.secondaryColor}
                    onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                    className="flex-1 rounded-xl border border-gray-700/80 bg-gray-700/50 px-3 py-2 text-sm text-gray-200 font-mono focus:border-indigo-500/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Logo URL</label>
              <input
                type="url"
                value={form.logoUrl}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                placeholder="https://example.com/logo.png"
                className="w-full rounded-xl border border-gray-700/80 bg-gray-700/50 px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Favicon URL</label>
              <input
                type="url"
                value={form.faviconUrl}
                onChange={(e) => setForm({ ...form, faviconUrl: e.target.value })}
                placeholder="https://example.com/favicon.ico"
                className="w-full rounded-xl border border-gray-700/80 bg-gray-700/50 px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500/50 focus:outline-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving || !form.name}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Update Template' : 'Create Template'}
              </button>
              <button type="button" onClick={cancelForm} className="rounded-xl border border-gray-700/80 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">Cancel</button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg">
        <div className="mb-4 border-b border-gray-700/80 pb-3">
          <h2 className="text-lg font-semibold text-white">Templates</h2>
          <p className="text-sm text-gray-400">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="space-y-4">
          {templates.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">No brand templates yet.</p>
          )}
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-gray-700 bg-gray-900/45 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className="h-12 w-12 rounded-xl border border-gray-600 flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: t.primaryColor || '#4F46E5' }}
                  >
                    {t.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{t.name}</h3>
                      {t.isActive && <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300">Active</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-full border border-gray-600" style={{ backgroundColor: t.primaryColor || '#4F46E5' }} />
                        {t.primaryColor || '—'}
                      </span>
                      <span>Sec: {t.secondaryColor || '—'}</span>
                      {t.logoUrl && <span>Logo ✓</span>}
                      {t.faviconUrl && <span>Favicon ✓</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => { setApplyModal(t); setApplySchoolId(''); }} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Apply</button>
                  <button onClick={() => handleEdit(t)} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Edit</button>
                  <button
                    onClick={() => { if (confirm('Delete this template?')) handleDelete(t.id); }}
                    disabled={deleting === t.id}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                  >
                    {deleting === t.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {applyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setApplyModal(null)}>
          <div className="relative w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-2">Apply Template</h3>
            <p className="text-sm text-gray-400 mb-4">Apply "{applyModal.name}" branding to a school.</p>
            <select
              value={applySchoolId}
              onChange={(e) => setApplySchoolId(e.target.value)}
              className="w-full rounded-xl border border-gray-700/80 bg-gray-700/50 px-4 py-2 text-sm text-gray-200 mb-4 focus:border-indigo-500/50 focus:outline-none"
            >
              <option value="">Select school…</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="flex justify-end gap-3">
              <button onClick={() => setApplyModal(null)} className="rounded-xl border border-gray-700/80 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">Cancel</button>
              <button
                onClick={handleApply}
                disabled={!applySchoolId || applying !== null}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandTemplatesPage;
