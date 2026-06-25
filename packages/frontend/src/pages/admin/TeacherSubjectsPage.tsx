import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TeacherMapping {
  id: string;
  fullName: string;
  departmentId: string | null;
  subjects: string[];
}

interface ApiResponse {
  mappings: TeacherMapping[];
  allSubjects: string[];
}

// ─── Default subjects (same as backend) ──────────────────────────────────────

const DEFAULT_SUBJECTS = [
  'Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry',
  'Physics', 'History', 'Geography', 'CRE', 'Business Studies',
];

// ─── Main Page ───────────────────────────────────────────────────────────────

const TeacherSubjectsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isAdminOrHOD = user?.role === UserRole.SCHOOL_ADMIN || user?.role === UserRole.HOD;

  const [mappings, setMappings] = useState<TeacherMapping[]>([]);
  const [allSubjects, setAllSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherMapping | null>(null);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get<ApiResponse>('/teacher-subjects');
      setMappings(data.mappings ?? []);
      setAllSubjects(data.allSubjects ?? DEFAULT_SUBJECTS);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openEditModal = (teacher: TeacherMapping) => {
    setEditingTeacher(teacher);
    setSelectedSubjects([...teacher.subjects]);
    setNewSubject('');
    setError('');
    setShowModal(true);
  };

  const toggleSubject = (subject: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject],
    );
  };

  const addNewSubject = () => {
    const trimmed = newSubject.trim();
    if (!trimmed) return;
    if (!selectedSubjects.includes(trimmed)) {
      setSelectedSubjects([...selectedSubjects, trimmed]);
    }
    setNewSubject('');
  };

  const handleSave = async () => {
    if (!editingTeacher) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.put(`/teacher-subjects/${editingTeacher.id}`, {
        subjects: selectedSubjects,
      });
      setShowModal(false);
      setEditingTeacher(null);
      void fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const filteredTeachers = mappings.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.fullName.toLowerCase().includes(q) ||
      t.subjects.some((s) => s.toLowerCase().includes(q))
    );
  });

  return (
    <div className="page-shell">
      {/* Header */}
      <header className="app-header">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm hover:opacity-90">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-lg font-bold text-ink tracking-tight">Teacher Subjects</h1>
              <p className="text-xs text-ink-muted font-medium">Assign which subjects each teacher can teach</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Info box */}
        <div className="surface-panel p-5 mb-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/8">
          <h3 className="text-sm font-semibold text-ink mb-2">How it works</h3>
          <ol className="text-sm text-ink-muted space-y-1 list-decimal list-inside">
            <li>Select a teacher and choose which subjects they teach</li>
            <li>When the <strong>Auto Generate</strong> timetable runs, each teacher will only be assigned their selected subjects</li>
            <li>Teachers with <strong>no explicit subjects</strong> use previous timetable hints when available; otherwise they can teach any subject</li>
            <li>You can type custom subjects that don't appear in the list</li>
          </ol>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search teacher or subject..."
            className="form-input w-full max-w-md"
          />
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-surface-elevated" />
            ))}
          </div>
        ) : filteredTeachers.length === 0 ? (
          <div className="surface-panel rounded-2xl p-10 text-center">
            <p className="text-ink-muted">
              {searchQuery
                ? 'No teachers match your search.'
                : 'No teachers found. Create teachers in User Management first.'}
            </p>
            {!searchQuery && (
              <Link to="/admin/users" className="text-brand hover:text-brand-hover text-sm mt-2 inline-block">
                Go to User Management
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTeachers.map((teacher) => (
              <div
                key={teacher.id}
                className="surface-panel rounded-2xl p-5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-ink">{teacher.fullName}</h3>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {teacher.subjects.length === 0 ? (
                      <span className="text-xs text-ink-subtle italic">
                        No explicit subjects yet
                      </span>
                    ) : (
                      teacher.subjects.map((subject) => (
                        <span
                          key={subject}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand/20 text-brand"
                        >
                          {subject}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                {isAdminOrHOD && (
                  <button
                    onClick={() => openEditModal(teacher)}
                    className="btn-primary px-4 py-2 text-sm shrink-0"
                  >
                    Edit Subjects
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Edit Subjects Modal */}
      {showModal && editingTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl surface-card border border-line rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-ink mb-1">
              {editingTeacher.fullName}
            </h3>
            <p className="text-sm text-ink-muted mb-6">
              Select the subjects this teacher can teach
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Known subjects checklist */}
            <div className="mb-4">
              <p className="text-sm font-semibold text-ink-muted mb-2 uppercase tracking-wider text-xs">
                Known Subjects ({selectedSubjects.length} selected)
              </p>
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {allSubjects.map((subject) => (
                  <label
                    key={subject}
                    className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded px-2 py-1.5 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={selectedSubjects.includes(subject)}
                      onChange={() => toggleSubject(subject)}
                    />
                    <span className="text-sm text-ink">{subject}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Add custom subject */}
            <div className="mb-4">
              <p className="text-sm font-semibold text-ink-muted mb-2 uppercase tracking-wider text-xs">
                Add Custom Subject
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addNewSubject();
                    }
                  }}
                  className="form-input flex-1"
                  placeholder="Type a subject and press Enter or Add"
                />
                <button
                  type="button"
                  onClick={addNewSubject}
                  className="px-3 py-2 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-surface-elevated transition-colors text-sm"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-4 border-t border-line">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand text-white font-semibold hover:opacity-90 transition-all disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Subjects'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-line mt-16 py-8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs text-ink-subtle">&copy; 2026 SAMS - Teacher Subjects</p>
        </div>
      </footer>
    </div>
  );
};

export default TeacherSubjectsPage;
