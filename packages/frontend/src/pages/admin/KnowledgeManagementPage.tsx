import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  scopeLevel: 'school' | 'department' | 'class';
  creatorName: string;
  creatorRole: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse {
  entries: KnowledgeEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface KnowledgeFormData {
  title: string;
  content: string;
  category: string;
}

// ─── API Functions (Task 8.4) ────────────────────────────────────────────────

async function getKnowledgeEntries(page: number, pageSize: number): Promise<PaginatedResponse> {
  const { data } = await apiClient.get('/knowledge', { params: { page, pageSize } });
  return data;
}

async function createKnowledgeEntry(input: KnowledgeFormData): Promise<KnowledgeEntry> {
  const { data } = await apiClient.post('/knowledge', input);
  return data;
}

async function updateKnowledgeEntry(id: string, input: Partial<KnowledgeFormData>): Promise<KnowledgeEntry> {
  const { data } = await apiClient.put(`/knowledge/${id}`, input);
  return data;
}

async function deleteKnowledgeEntry(id: string): Promise<void> {
  await apiClient.delete(`/knowledge/${id}`);
}

async function exportKnowledgeEntries(): Promise<Blob> {
  const { data } = await apiClient.get('/knowledge/export', { responseType: 'blob' });
  return data;
}

// ─── Scope Badge Component ───────────────────────────────────────────────────

const ScopeBadge: React.FC<{ scope: 'school' | 'department' | 'class' }> = ({ scope }) => {
  const config = {
    school: { label: 'School', classes: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
    department: { label: 'Department', classes: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
    class: { label: 'Class', classes: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  };
  const { label, classes } = config[scope];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${classes}`}>
      {label}
    </span>
  );
};

// ─── Category Badge ──────────────────────────────────────────────────────────

const CategoryBadge: React.FC<{ category: string }> = ({ category }) => (
  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/10 text-ink-muted border border-white/10">
    {category}
  </span>
);

// ─── Knowledge Form Modal (Task 8.2) ────────────────────────────────────────

interface KnowledgeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: KnowledgeFormData) => Promise<void>;
  initialData?: KnowledgeFormData;
  mode: 'create' | 'edit';
}

const KnowledgeFormModal: React.FC<KnowledgeFormModalProps> = ({ isOpen, onClose, onSubmit, initialData, mode }) => {
  const [title, setTitle] = useState(initialData?.title || '');
  const [content, setContent] = useState(initialData?.content || '');
  const [category, setCategory] = useState(initialData?.category || 'general');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || '');
      setContent(initialData?.content || '');
      setCategory(initialData?.category || 'general');
      setError('');
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!title.trim() || title.length > 200) {
      setError('Title must be 1-200 characters');
      return;
    }
    if (!content.trim()) {
      setError('Content is required');
      return;
    }
    if (category.length > 50) {
      setError('Category must be at most 50 characters');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), content: content.trim(), category: category.trim() || 'general' });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to save entry');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-800 shadow-2xl">
        <div className="p-6">
          <h3 className="text-xl font-bold text-ink mb-6">
            {mode === 'create' ? 'Add Knowledge Entry' : 'Edit Knowledge Entry'}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/40/50 transition-colors"
                placeholder="Enter title..."
                autoFocus
              />
              <p className="text-xs text-ink-subtle mt-1">{title.length}/200</p>
            </div>

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Content</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/40/50 transition-colors resize-none"
                placeholder="Enter knowledge content..."
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={50}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/40/50 transition-colors"
                placeholder="e.g. general, policy, curriculum..."
              />
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-ink-muted hover:text-ink hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl text-sm font-medium text-ink bg-gradient-to-r from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {submitting ? 'Saving...' : mode === 'create' ? 'Create Entry' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// ─── Delete Confirmation Dialog (Task 8.3) ───────────────────────────────────

interface DeleteDialogProps {
  isOpen: boolean;
  entryTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

const DeleteConfirmDialog: React.FC<DeleteDialogProps> = ({ isOpen, entryTitle, onConfirm, onCancel, deleting }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-slate-800 shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-ink">Delete Entry</h3>
        </div>
        <p className="text-sm text-ink-muted mb-6">
          Are you sure you want to delete <span className="font-semibold text-ink">"{entryTitle}"</span>? This action cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-ink-muted hover:text-ink hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-5 py-2 rounded-xl text-sm font-medium text-ink bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page Component (Task 8.1) ─────────────────────────────────────────

const KnowledgeManagementPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const pageSize = 20;

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<KnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState('');

  const scopeSubtitle = (() => {
    switch (user?.role) {
      case UserRole.SCHOOL_ADMIN: return 'School-wide entries';
      case UserRole.HOD: return 'Department entries';
      case UserRole.TEACHER: return 'Class entries';
      default: return 'Knowledge entries';
    }
  })();

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getKnowledgeEntries(page, pageSize);
      setEntries(data.entries);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load knowledge entries');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Can the current user edit/delete this entry?
  const canModify = (entry: KnowledgeEntry): boolean => {
    if (user?.role === UserRole.SCHOOL_ADMIN) return true;
    return entry.createdById === user?.id;
  };

  // Handlers
  const handleCreate = () => {
    setEditingEntry(null);
    setFormMode('create');
    setFormOpen(true);
  };

  const handleEdit = (entry: KnowledgeEntry) => {
    setEditingEntry(entry);
    setFormMode('edit');
    setFormOpen(true);
  };

  const handleDeleteClick = (entry: KnowledgeEntry) => {
    setDeletingEntry(entry);
    setDeleteDialogOpen(true);
  };

  const handleFormSubmit = async (data: KnowledgeFormData) => {
    if (formMode === 'create') {
      await createKnowledgeEntry(data);
    } else if (editingEntry) {
      await updateKnowledgeEntry(editingEntry.id, data);
    }
    await fetchEntries();
  };

  const handleDeleteConfirm = async () => {
    if (!deletingEntry) return;
    setDeleting(true);
    try {
      await deleteKnowledgeEntry(deletingEntry.id);
      setDeleteDialogOpen(false);
      setDeletingEntry(null);
      await fetchEntries();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to delete entry');
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const blob = await exportKnowledgeEntries();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sams-knowledge-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to export knowledge entries');
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">Knowledge Base</h1>
              <p className="text-xs text-ink-muted">{scopeSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-muted">{user?.fullName}</span>
            <Link to="/dashboard" className="text-sm text-ink-muted hover:text-indigo-400 transition-colors">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Title + Add Button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-ink mb-1">Knowledge Base</h2>
            <p className="text-ink-muted">{total} {total === 1 ? 'entry' : 'entries'} available</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-ink-muted border border-line hover:bg-white/10 hover:text-ink disabled:opacity-50 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M8 12l4 4m0 0l4-4m-4 4V4" />
              </svg>
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-ink bg-gradient-to-r from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/20 transition-all hover:scale-[1.02]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Entry
            </button>
          </div>
        </div>

        {/* Role scope guide */}
        <div className="mb-6 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-indigo-100/90 space-y-2">
          <p className="font-medium text-white">How knowledge reaches each role</p>
          <ul className="list-disc list-inside text-indigo-100/80 space-y-1">
            <li><strong>School Admin</strong> — school-wide entries; all staff and students see them via the AI assistant.</li>
            <li><strong>HOD</strong> — department entries plus school-wide; teachers and students in that department receive them in AI chat.</li>
            <li><strong>Teacher</strong> — class entries plus department and school-wide; only that class (and shared scopes) in AI chat.</li>
            <li><strong>Student</strong> — cannot edit here; they receive school, department, and class entries automatically in the AI assistant.</li>
          </ul>
          <p className="text-xs text-indigo-200/70 pt-1">Scope for new entries: {scopeSubtitle}</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-5 w-40 bg-white/10 rounded" />
                  <div className="h-5 w-16 bg-white/10 rounded-full" />
                  <div className="h-5 w-20 bg-white/10 rounded-full" />
                </div>
                <div className="h-4 w-full bg-white/10 rounded mb-2" />
                <div className="h-4 w-2/3 bg-white/10 rounded" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-surface-muted border border-line flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-ink-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-ink mb-2">No knowledge entries yet</h3>
            <p className="text-ink-muted text-sm mb-6">Create your first knowledge entry to get started.</p>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-ink bg-gradient-to-r from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/20 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Entry
            </button>
          </div>
        ) : (
          <>
            {/* Entry List */}
            <div className="space-y-4">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="group rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-ink truncate">{entry.title}</h3>
                        <ScopeBadge scope={entry.scopeLevel} />
                        <CategoryBadge category={entry.category} />
                      </div>

                      {/* Content preview */}
                      <p className="text-sm text-ink-muted line-clamp-2 mb-3">
                        {entry.content}
                      </p>

                      {/* Meta */}
                      <div className="flex items-center gap-4 text-xs text-ink-subtle">
                        <span>By {entry.creatorName}</span>
                        <span>•</span>
                        <span>{formatDate(entry.createdAt)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    {canModify(entry) && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleEdit(entry)}
                          className="p-2 rounded-lg hover:bg-white/10 text-ink-muted hover:text-brand transition-colors"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteClick(entry)}
                          className="p-2 rounded-lg hover:bg-red-500/10 text-ink-muted hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 rounded-xl text-sm text-ink-muted hover:text-ink hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (page <= 4) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = page - 3 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                          page === pageNum
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'text-ink-muted hover:text-ink hover:bg-white/10'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 rounded-xl text-sm text-ink-muted hover:text-ink hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>

      {/* Form Modal */}
      <KnowledgeFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
        initialData={editingEntry ? { title: editingEntry.title, content: editingEntry.content, category: editingEntry.category } : undefined}
        mode={formMode}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={deleteDialogOpen}
        entryTitle={deletingEntry?.title || ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeleteDialogOpen(false); setDeletingEntry(null); }}
        deleting={deleting}
      />
    </div>
  );
};

export default KnowledgeManagementPage;
