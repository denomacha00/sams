import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuardianLink {
  id: string;
  guardian: { id: string; fullName: string; email: string | null; phone: string | null };
  relation: string | null;
  createdAt: string;
}

interface StudentSummary {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  class: { id: string; name: string } | null;
  guardians: GuardianLink[];
}

interface UserBrief {
  id: string;
  fullName: string;
  username: string | null;
  admissionNumber: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  class?: { id: string; name: string } | null;
}

interface Department {
  id: string;
  name: string;
  classes?: { id: string; name: string }[];
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const GuardianManagementPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.SCHOOL_ADMIN;

  const [guardians, setGuardians] = useState<UserBrief[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'guardians' | 'students'>('guardians');

  // Link modal
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedGuardian, setSelectedGuardian] = useState<UserBrief | null>(null);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [relation, setRelation] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);

  // Unlink
  const [unlinking, setUnlinking] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Get all users — guardian and student
      const [guardiansRes, studentsRes, deptsRes] = await Promise.all([
        apiClient.get('/users', { params: { role: 'GUARDIAN' } }),
        apiClient.get('/users', { params: { role: 'STUDENT' } }),
        apiClient.get('/departments'),
      ]);

      const guardianList: UserBrief[] = Array.isArray(guardiansRes.data) ? guardiansRes.data : [];
      const studentList: UserBrief[] = Array.isArray(studentsRes.data) ? studentsRes.data : [];
      const deptList: Department[] = Array.isArray(deptsRes.data) ? deptsRes.data : [];

      // Enrich students with their guardians
      const studentsWithGuardians: StudentSummary[] = await Promise.all(
        studentList.map(async (s) => {
          try {
            const linksRes = await apiClient.get(`/guardians/student/${s.id}`);
            const links: GuardianLink[] = Array.isArray(linksRes.data) ? linksRes.data : [];
            return {
              id: s.id,
              fullName: s.fullName,
              admissionNumber: s.admissionNumber,
              class: s.class ?? null,
              guardians: links,
            };
          } catch {
            return {
              id: s.id,
              fullName: s.fullName,
              admissionNumber: s.admissionNumber,
              class: s.class ?? null,
              guardians: [],
            };
          }
        }),
      );

      setGuardians(guardianList);
      setStudents(studentsWithGuardians);
      setDepartments(deptList);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openLinkModal = (guardian: UserBrief) => {
    setSelectedGuardian(guardian);
    setSelectedStudent('');
    setRelation('');
    setLinkError('');
    setShowLinkModal(true);
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGuardian || !selectedStudent) return;
    setLinking(true);
    setLinkError('');
    try {
      await apiClient.post('/guardians/link', {
        guardianId: selectedGuardian.id,
        studentId: selectedStudent,
        relation: relation || undefined,
      });
      setShowLinkModal(false);
      setSelectedGuardian(null);
      void fetchData();
    } catch (err: any) {
      setLinkError(err.response?.data?.error || 'Failed to link');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (linkId: string) => {
    if (!window.confirm('Remove this guardian link?')) return;
    setUnlinking(true);
    try {
      await apiClient.delete(`/guardians/${linkId}`);
      void fetchData();
    } catch {
      alert('Failed to remove link');
    } finally {
      setUnlinking(false);
    }
  };

  const filteredGuardians = guardians.filter((g) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      g.fullName.toLowerCase().includes(q) ||
      (g.username?.toLowerCase().includes(q)) ||
      (g.email?.toLowerCase().includes(q)) ||
      (g.phone?.includes(q))
    );
  });

  const filteredStudents = students.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.fullName.toLowerCase().includes(q) ||
      (s.admissionNumber?.toLowerCase().includes(q))
    );
  });

  if (!isAdmin) {
    return (
      <div className="page-shell">
        <main className="max-w-7xl mx-auto px-6 py-20 text-center">
          <h2 className="text-xl font-bold text-ink mb-2">Access Denied</h2>
          <p className="text-ink-muted">Only school admins can manage guardian links.</p>
          <Link to="/dashboard" className="text-brand hover:text-brand-hover mt-4 inline-block">Back to Dashboard</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>

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
              <h1 className="text-lg font-bold text-ink tracking-tight">Guardian Management</h1>
              <p className="text-xs text-ink-muted font-medium">Link parents/guardians to students</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Info box */}
        <div className="surface-panel p-5 mb-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/8">
          <h3 className="text-sm font-semibold text-ink mb-2">How Guardian linking works</h3>
          <ol className="text-sm text-ink-muted space-y-1 list-decimal list-inside">
            <li>Create parent accounts first via <Link to="/admin/users" className="text-brand hover:text-brand-hover">User Management</Link> with role <strong>GUARDIAN</strong></li>
            <li>In the <strong>Guardians</strong> tab below, click "Link to Student" next to a guardian</li>
            <li>Select the student and optionally specify the relation (e.g. "Father", "Mother", "Guardian")</li>
            <li>A parent can be linked to <strong>multiple students</strong> — each link is independent</li>
            <li>Parents log in at <code>/login</code> and visit <code>/parent</code> to see all linked children</li>
          </ol>
        </div>

        {/* Search + Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setTab('guardians')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === 'guardians'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-muted border border-line'
              }`}
            >
              Guardians ({guardians.length})
            </button>
            <button
              onClick={() => setTab('students')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === 'students'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-muted border border-line'
              }`}
            >
              Students ({students.length})
            </button>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tab === 'guardians' ? 'Search guardians...' : 'Search students...'}
            className="form-input w-full sm:w-72"
          />
        </div>

        {/* Guardians Tab */}
        {tab === 'guardians' && (
          <>
            {loading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-surface-elevated" />)}
              </div>
            ) : filteredGuardians.length === 0 ? (
              <div className="surface-panel rounded-2xl p-10 text-center">
                <p className="text-ink-muted">
                  {searchQuery ? 'No guardians match your search.' : 'No guardian accounts yet. Create one in User Management first.'}
                </p>
                {!searchQuery && (
                  <Link to="/admin/users" className="text-brand hover:text-brand-hover text-sm mt-2 inline-block">
                    → Go to User Management
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredGuardians.map((g) => {
                  // Count how many students this guardian is linked to
                  const linkedCount = students.filter((s) =>
                    s.guardians.some((l) => l.guardian.id === g.id),
                  ).length;

                  return (
                    <div key={g.id} className="surface-panel rounded-2xl p-5 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-ink">{g.fullName}</h3>
                          <span className="text-xs bg-brand/20 text-brand px-2 py-0.5 rounded-full font-semibold">GUARDIAN</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-ink-muted">
                          {g.username && <span>@{g.username}</span>}
                          {g.email && <span>{g.email}</span>}
                          {g.phone && <span>{g.phone}</span>}
                          <span className="text-brand font-medium">{linkedCount} student{linkedCount !== 1 ? 's' : ''} linked</span>
                        </div>
                      </div>
                      <button
                        onClick={() => openLinkModal(g)}
                        className="btn-primary px-4 py-2 text-sm shrink-0"
                        disabled={unlinking}
                      >
                        Link to Student
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Students Tab */}
        {tab === 'students' && (
          <>
            {loading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-surface-elevated" />)}
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="surface-panel rounded-2xl p-10 text-center">
                <p className="text-ink-muted">No students found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredStudents.map((s) => (
                  <div key={s.id} className="surface-panel rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-ink">{s.fullName}</h3>
                          <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                            {s.admissionNumber || '—'}
                          </span>
                        </div>
                        {s.class && <p className="text-sm text-ink-muted mt-0.5">{s.class.name}</p>}
                      </div>
                    </div>

                    {/* Linked guardians */}
                    {s.guardians.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                          Linked Guardians ({s.guardians.length})
                        </p>
                        {s.guardians.map((link) => (
                          <div key={link.id} className="flex items-center justify-between gap-3 bg-surface-muted rounded-xl px-4 py-2.5">
                            <div className="min-w-0 flex-1">
                              <span className="text-sm text-ink font-medium">{link.guardian.fullName}</span>
                              {link.relation && (
                                <span className="text-xs text-ink-muted ml-2">({link.relation})</span>
                              )}
                              <div className="text-xs text-ink-subtle">
                                {link.guardian.email && <span>{link.guardian.email} · </span>}
                                {link.guardian.phone && <span>{link.guardian.phone}</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => handleUnlink(link.id)}
                              className="text-red-400 hover:text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 transition-colors shrink-0"
                              disabled={unlinking}
                            >
                              Unlink
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-ink-subtle">
                        No guardians linked. Ask a school admin to link this student.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Link Modal */}
      {showLinkModal && selectedGuardian && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl surface-card border border-line rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-ink mb-2">Link Guardian to Student</h3>
            <p className="text-sm text-ink-muted mb-6">
              Linking: <strong className="text-ink">{selectedGuardian.fullName}</strong>
            </p>

            {linkError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{linkError}</div>
            )}

            <form onSubmit={handleLink} className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Select Student *</label>
                <select
                  value={selectedStudent}
                  onChange={(e) => setSelectedStudent(e.target.value)}
                  className="form-input w-full"
                  required
                  size={5}
                  style={{ minHeight: '120px' }}
                >
                  {students
                    .filter((s) => !s.guardians.some((l) => l.guardian.id === selectedGuardian.id))
                    .map((s) => (
                      <option key={s.id} value={s.id} className="py-1">
                        {s.fullName} ({s.admissionNumber || '—'}){s.class ? ` - ${s.class.name}` : ''}
                      </option>
                    ))}
                  {students.filter((s) => !s.guardians.some((l) => l.guardian.id === selectedGuardian.id)).length === 0 && (
                    <option value="" disabled>All students already linked to this guardian</option>
                  )}
                </select>
                <p className="text-xs text-ink-subtle mt-1">
                  Showing students not already linked to this guardian. One guardian can be linked to <strong>multiple</strong> students.
                </p>
              </div>

              <div>
                <label className="block text-sm text-ink-muted mb-1">Relation (optional)</label>
                <input
                  type="text"
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  className="form-input w-full"
                  placeholder="e.g. Father, Mother, Uncle, Guardian"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-surface-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={linking || !selectedStudent}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-brand text-white font-semibold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {linking ? 'Linking...' : 'Link Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-line mt-16 py-8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs text-ink-subtle">&copy; 2025 SAMS — Guardian Management</p>
        </div>
      </footer>
    </div>
  );
};

export default GuardianManagementPage;
