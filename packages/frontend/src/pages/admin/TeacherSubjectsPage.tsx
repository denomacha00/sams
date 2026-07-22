import React, { useEffect, useState } from 'react';
import { UserRole } from '@sams/shared';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../store/authStore';

interface TeacherMapping {
  id: string;
  fullName: string;
  departmentId: string | null;
  subjects: string[];
}

const TeacherSubjectsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [mappings, setMappings] = useState<TeacherMapping[]>([]);
  const [allSubjects, setAllSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTeacher, setEditTeacher] = useState<TeacherMapping | null>(null);
  const [editSubjects, setEditSubjects] = useState<string[]>([]);
  const [newSubjectInput, setNewSubjectInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = async () => {
    try {
      const { data } = await apiClient.get('/teacher-subjects');
      setMappings(Array.isArray(data.mappings) ? data.mappings : []);
      setAllSubjects(Array.isArray(data.allSubjects) ? data.allSubjects : []);
    } catch (err) {
      console.error('Failed to load teacher subjects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openEdit = (teacher: TeacherMapping) => {
    setEditTeacher(teacher);
    setEditSubjects([...teacher.subjects]);
    setNewSubjectInput('');
  };

  const addSubject = () => {
    // Split on commas / newlines so "Math, English, Physics" becomes three
    // separate subjects instead of one literal string. Dedupe case-insensitively
    // against what's already added.
    const parts = newSubjectInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;

    setEditSubjects((prev) => {
      const seen = new Set(prev.map((s) => s.toLowerCase()));
      const next = [...prev];
      for (const part of parts) {
        const key = part.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(part);
      }
      return next;
    });
    setNewSubjectInput('');
  };

  const removeSubject = (subj: string) => {
    setEditSubjects(editSubjects.filter((s) => s !== subj));
  };

  const saveSubjects = async () => {
    if (!editTeacher) return;
    setSaving(true);
    try {
      await apiClient.put(`/teacher-subjects/${editTeacher.id}`, {
        subjects: editSubjects,
      });
      setEditTeacher(null);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const filtered = mappings.filter((m) =>
    m.fullName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const isAdminOrHod = user?.role === UserRole.SCHOOL_ADMIN || user?.role === UserRole.HOD;

  return (
    <div className="page-shell px-4 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-ink">Teacher Subjects / Skilled Units</h1>
          <p className="text-sm text-ink-muted mt-1">
            View and edit which subjects/units each teacher can teach. This is used by the timetable generator.
            Teachers fill this during registration — admins and HODs can adjust here.
          </p>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search teachers..."
            className="w-full max-w-md px-4 py-2.5 rounded-xl input-field placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-ink-muted">Loading teacher subjects...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-ink-muted">
            {mappings.length === 0
              ? 'No teacher subject data found. Teachers will add subjects during registration.'
              : 'No teachers match your search.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((teacher) => (
              <div
                key={teacher.id}
                className="rounded-xl border border-line bg-surface-muted p-4 hover:bg-surface-elevated transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{teacher.fullName}</h3>
                    <p className="text-xs text-ink-muted">
                      {teacher.subjects.length} subject{teacher.subjects.length === 1 ? '' : 's'}
                      {teacher.subjects.length === 0 && ' (none set yet)'}
                    </p>
                  </div>
                  {isAdminOrHod && (
                    <button
                      onClick={() => openEdit(teacher)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors"
                    >
                      Edit Subjects
                    </button>
                  )}
                </div>
                {teacher.subjects.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {teacher.subjects.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-light text-brand"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Edit Modal */}
        {editTeacher && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="input-field rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
              <h3 className="text-lg font-bold text-ink mb-1">Edit Subjects</h3>
              <p className="text-sm text-ink-muted mb-4">{editTeacher.fullName}</p>

              {/* Current subjects */}
              {editSubjects.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {editSubjects.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-light text-brand"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSubject(s)}
                        className="text-brand/70 hover:text-brand ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {editSubjects.length === 0 && (
                <p className="text-xs text-ink-muted mb-4">No subjects added yet.</p>
              )}

              {/* Add new subject */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newSubjectInput}
                  onChange={(e) => setNewSubjectInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSubject();
                    }
                  }}
                  className="flex-1 px-4 py-2 rounded-xl input-field placeholder-ink-subtle text-sm"
                  placeholder="Type subjects, comma-separated (e.g. Math, English), then Enter or Add"
                />
                <button
                  type="button"
                  onClick={addSubject}
                  className="px-4 py-2 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-surface-elevated text-sm"
                >
                  Add
                </button>
              </div>

              {/* Quick-pick from known subjects */}
              {allSubjects.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-ink-subtle mb-1">Quick add from known subjects:</p>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {allSubjects
                      .filter((s) => !editSubjects.includes(s))
                      .slice(0, 20)
                      .map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            if (!editSubjects.includes(s)) {
                              setEditSubjects([...editSubjects, s]);
                            }
                          }}
                          className="px-2 py-0.5 rounded-full text-xs border border-line text-ink-muted hover:bg-surface-elevated hover:text-ink transition-colors"
                        >
                          +{s}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTeacher(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl input-field text-ink-muted hover:bg-surface-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSubjects}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Subjects'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherSubjectsPage;
