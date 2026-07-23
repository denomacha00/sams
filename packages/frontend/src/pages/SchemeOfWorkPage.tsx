import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';

interface Scheme {
  id: string;
  subject: string;
  title: string;
  description: string | null;
  status: string;
  class: { id: string; name: string };
  term: { id: string; name: string };
  creator: { id: string; fullName: string };
  weeks: Array<{
    id: string;
    weekNumber: number;
    topic: string;
    objectives: string | null;
    lessonPlans: Array<{
      id: string;
      dayOfWeek: number;
      topic: string;
      status: string;
    }>;
  }>;
}

interface SchemeDetail extends Scheme {
  approver: { id: string; fullName: string } | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  weeks: Array<{
    id: string;
    weekNumber: number;
    topic: string;
    objectives: string | null;
    teachingMethods: string | null;
    resources: string | null;
    assessment: string | null;
    lessonPlans: Array<{
      id: string;
      dayOfWeek: number;
      topic: string;
      objectives: string | null;
      introduction: string | null;
      mainActivity: string | null;
      conclusion: string | null;
      materials: string | null;
      homework: string | null;
      status: string;
    }>;
  }>;
}

interface GeneratorInfo {
  classes: Array<{ id: string; name: string }>;
  terms: Array<{ id: string; name: string; isActive: boolean }>;
  subjects: string[];
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const STATUS_BADGES: Record<string, string> = {
  DRAFT: 'bg-slate-600 text-slate-200',
  PENDING_APPROVAL: 'bg-amber-600 text-amber-100',
  APPROVED: 'bg-emerald-600 text-emerald-100',
  REJECTED: 'bg-red-600 text-red-100',
};

const SchemeOfWorkPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isHOD = user?.role === UserRole.HOD;
  const isTeacher = user?.role === UserRole.TEACHER;
  const canManage = isHOD || isTeacher;

  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScheme, setSelectedScheme] = useState<SchemeDetail | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGenWeeksModal, setShowGenWeeksModal] = useState(false);
  const [genSchemeId, setGenSchemeId] = useState<string | null>(null);
  const [generatorInfo, setGeneratorInfo] = useState<GeneratorInfo | null>(null);
  const [form, setForm] = useState({ subject: '', classId: '', termId: '', title: '', description: '' });
  const [editLessonPlan, setEditLessonPlan] = useState<{ id: string; schemeWeekId: string } | null>(null);
  const [lessonForm, setLessonForm] = useState({ topic: '', objectives: '', introduction: '', mainActivity: '', conclusion: '', materials: '', homework: '' });
  const [submitting, setSubmitting] = useState(false);

  const fetchSchemes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/schemes');
      setSchemes(Array.isArray(data) ? data : []);
    } catch { setSchemes([]); } finally { setLoading(false); }
  }, []);

  const fetchGeneratorInfo = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/schemes/generate-info');
      setGeneratorInfo(data);
      if (data.subjects?.[0]) setForm((f) => ({ ...f, subject: data.subjects[0] }));
      if (data.terms?.[0]) setForm((f) => ({ ...f, termId: data.terms[0].id }));
    } catch {}
  }, []);

  useEffect(() => { void fetchSchemes(); }, [fetchSchemes]);

  const openScheme = async (id: string) => {
    try {
      const { data } = await apiClient.get(`/schemes/${id}`);
      setSelectedScheme(data);
    } catch {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiClient.post('/schemes', form);
      setShowCreateModal(false);
      setForm({ subject: '', classId: '', termId: '', title: '', description: '' });
      await fetchSchemes();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Create failed');
    } finally { setSubmitting(false); }
  };

  const handleSubmitForApproval = async (id: string) => {
    if (!confirm('Submit this scheme for HOD approval?')) return;
    try {
      await apiClient.post(`/schemes/${id}/submit`);
      await fetchSchemes();
      if (selectedScheme?.id === id) await openScheme(id);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Approve this scheme?')) return;
    try {
      await apiClient.post(`/schemes/${id}/approve`);
      await fetchSchemes();
      if (selectedScheme?.id === id) await openScheme(id);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;
    try {
      await apiClient.post(`/schemes/${id}/reject`, { reason });
      await fetchSchemes();
      if (selectedScheme?.id === id) await openScheme(id);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const openGenWeeks = async (id: string) => {
    setGenSchemeId(id);
    setShowGenWeeksModal(true);
    await fetchGeneratorInfo();
  };

  const handleGenerateWeeks = async () => {
    if (!genSchemeId) return;
    const weeksInput = prompt('Enter weeks as JSON array:\n[{"weekNumber":1,"topic":"..."},...]');
    if (!weeksInput) return;
    try {
      const weeks = JSON.parse(weeksInput);
      setSubmitting(true);
      await apiClient.post(`/schemes/${genSchemeId}/generate-weeks`, { weeks });
      setShowGenWeeksModal(false);
      setGenSchemeId(null);
      await fetchSchemes();
    } catch (err: any) { alert(err.response?.data?.error || 'Invalid JSON'); }
    finally { setSubmitting(false); }
  };

  const openEditLesson = (plan: { id: string; schemeWeekId: string }, detail?: any) => {
    setEditLessonPlan(plan);
    setLessonForm({
      topic: detail?.topic || '',
      objectives: detail?.objectives || '',
      introduction: detail?.introduction || '',
      mainActivity: detail?.mainActivity || '',
      conclusion: detail?.conclusion || '',
      materials: detail?.materials || '',
      homework: detail?.homework || '',
    });
  };

  const handleSaveLesson = async () => {
    if (!editLessonPlan) return;
    setSubmitting(true);
    try {
      await apiClient.patch(`/schemes/lesson-plans/${editLessonPlan.id}`, lessonForm);
      setEditLessonPlan(null);
      if (selectedScheme) await openScheme(selectedScheme.id);
    } catch (err: any) { alert(err.response?.data?.error || 'Save failed'); }
    finally { setSubmitting(false); }
  };

  const planForEdit = (plan: any) => ({ id: plan.id, schemeWeekId: plan.schemeWeekId || plan.id });

  return (
    <div className="page-shell">
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-ink-muted hover:text-brand transition-colors">← Dashboard</Link>
            <h1 className="text-lg font-bold text-ink">Scheme of Work</h1>
          </div>
          <div className="flex gap-2">
            {canManage && (
              <button onClick={() => { setShowCreateModal(true); void fetchGeneratorInfo(); }} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors">
                + New Scheme
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center text-ink-muted py-12">Loading schemes...</div>
        ) : schemes.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl input-field mb-4">
              <svg className="w-8 h-8 text-ink-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-ink-muted">No schemes of work yet</p>
            {canManage && <p className="text-ink-subtle text-sm mt-1">Create your first scheme to get started.</p>}
          </div>
        ) : selectedScheme ? (
          /* ─── Scheme Detail View ─── */
          <div>
            <button onClick={() => setSelectedScheme(null)} className="text-sm text-ink-muted hover:text-brand mb-4 flex items-center gap-1">
              ← Back to list
            </button>
            <div className="surface-card rounded-2xl p-6 mb-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-ink">{selectedScheme.title}</h2>
                  <p className="text-sm text-ink-muted mt-1">
                    {selectedScheme.subject} · {selectedScheme.class.name} · {selectedScheme.term.name}
                  </p>
                  <p className="text-xs text-ink-subtle mt-0.5">
                    Created by {selectedScheme.creator.fullName}
                    {selectedScheme.status === 'APPROVED' && selectedScheme.approver && ` · Approved by ${selectedScheme.approver.fullName}`}
                    {selectedScheme.status === 'REJECTED' && selectedScheme.rejectionReason && ` · Reason: ${selectedScheme.rejectionReason}`}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_BADGES[selectedScheme.status] || 'bg-slate-600'}`}>
                  {selectedScheme.status.replace(/_/g, ' ')}
                </span>
              </div>

              {selectedScheme.description && (
                <p className="text-sm text-ink-muted mb-4">{selectedScheme.description}</p>
              )}

              <div className="flex gap-2 mb-4">
                {canManage && selectedScheme.status === 'DRAFT' && (
                  <>
                    <button onClick={() => void openGenWeeks(selectedScheme.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-500">Generate Weeks</button>
                    <button onClick={() => handleSubmitForApproval(selectedScheme.id)} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs hover:bg-amber-500">Submit for Approval</button>
                  </>
                )}
                {isHOD && selectedScheme.status === 'PENDING_APPROVAL' && (
                  <>
                    <button onClick={() => handleApprove(selectedScheme.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-500">Approve ✓</button>
                    <button onClick={() => handleReject(selectedScheme.id)} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs hover:bg-red-500">Reject ✕</button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {selectedScheme.weeks.length === 0 ? (
                <div className="text-center py-8 text-ink-muted text-sm">
                  <p>No weeks generated yet. Click <strong>Generate Weeks</strong> above to auto-create lesson plans.</p>
                </div>
              ) : (
                selectedScheme.weeks.map((week) => (
                  <details key={week.id} className="surface-card rounded-xl overflow-hidden">
                    <summary className="px-5 py-3 cursor-pointer hover:bg-surface-muted transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-ink">Week {week.weekNumber}</span>
                          <span className="ml-3 text-ink-muted">{week.topic}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {week.lessonPlans.filter((lp) => lp.status === 'COMPLETED').length}/{week.lessonPlans.length} done
                        </div>
                      </div>
                    </summary>
                    <div className="px-5 py-3 border-t border-line space-y-3">
                      {week.objectives && <p className="text-xs text-ink-subtle"><strong>Objectives:</strong> {week.objectives}</p>}
                      <div className="grid gap-3">
                        {week.lessonPlans.map((plan) => (
                          <div key={plan.id} className="rounded-lg bg-surface-muted p-3 border border-line">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-ink">{DAYS[plan.dayOfWeek]} — {plan.topic}</p>
                                <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full ${plan.status === 'COMPLETED' ? 'bg-emerald-600/20 text-emerald-300' : plan.status === 'SKIPPED' ? 'bg-red-600/20 text-red-300' : 'bg-slate-600/20 text-slate-300'}`}>
                                  {plan.status}
                                </span>
                              </div>
                              {canManage && (
                                <button onClick={() => openEditLesson(planForEdit(plan), plan)} className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0">
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                ))
              )}
            </div>
          </div>
        ) : (
          /* ─── Scheme List ─── */
          <div className="grid gap-4">
            {schemes.map((scheme) => (
              <div
                key={scheme.id}
                onClick={() => void openScheme(scheme.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') void openScheme(scheme.id); }}
                className="surface-card rounded-xl p-5 cursor-pointer hover:bg-surface-muted transition-colors border border-line"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-ink">{scheme.title}</h3>
                    <p className="text-sm text-ink-muted mt-0.5">{scheme.subject} · {scheme.class.name} · {scheme.term.name}</p>
                    <p className="text-xs text-ink-subtle mt-1">{scheme.creator.fullName} · {scheme.weeks.length} week(s)</p>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGES[scheme.status] || 'bg-slate-600 text-slate-200'}`}>
                    {scheme.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="input-field rounded-2xl p-8 w-full max-w-lg mx-4">
            <h3 className="text-xl font-bold text-ink mb-6">New Scheme of Work</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Title *</label>
                <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" placeholder="e.g. Form 2 Mathematics Term 1" />
              </div>
              {generatorInfo && (
                <>
                  <div>
                    <label className="block text-sm text-ink-muted mb-1">Unit *</label>
                    <select required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm">
                      <option value="">-- Select --</option>
                      {generatorInfo.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-ink-muted mb-1">Class *</label>
                    <select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm">
                      <option value="">-- Select --</option>
                      {generatorInfo.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-ink-muted mb-1">Term *</label>
                    <select required value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm">
                      {generatorInfo.terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? ' (Active)' : ''}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm text-ink-muted mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" rows={3} placeholder="Optional description" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 rounded-xl input-field text-ink-muted hover:bg-surface-elevated">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50">
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGenWeeksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="input-field rounded-2xl p-8 w-full max-w-lg mx-4">
            <h3 className="text-xl font-bold text-ink mb-4">Generate Weeks</h3>
            <p className="text-sm text-ink-muted mb-4">Paste a JSON array of weeks. Each week auto-creates 5 lesson plans (Mon–Fri).</p>
            <pre className="bg-surface-muted p-3 rounded-lg text-xs text-ink-muted mb-4 overflow-x-auto">[{'"weekNumber":1,"topic":"Introduction to Algebra","objectives":"...","teachingMethods":"...","resources":"...","assessment":"..."'}]</pre>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowGenWeeksModal(false); setGenSchemeId(null); }} className="flex-1 px-4 py-2.5 rounded-xl input-field text-ink-muted">Cancel</button>
              <button onClick={() => void handleGenerateWeeks()} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-50">
                {submitting ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editLessonPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="input-field rounded-2xl p-8 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-ink mb-6">Edit Lesson Plan</h3>
            <div className="space-y-3">
              <div><label className="block text-sm text-ink-muted mb-1">Topic</label><input type="text" value={lessonForm.topic} onChange={(e) => setLessonForm({ ...lessonForm, topic: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" /></div>
              <div><label className="block text-sm text-ink-muted mb-1">Objectives</label><textarea value={lessonForm.objectives} onChange={(e) => setLessonForm({ ...lessonForm, objectives: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" rows={3} /></div>
              <div><label className="block text-sm text-ink-muted mb-1">Introduction</label><textarea value={lessonForm.introduction} onChange={(e) => setLessonForm({ ...lessonForm, introduction: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" rows={2} /></div>
              <div><label className="block text-sm text-ink-muted mb-1">Main Activity</label><textarea value={lessonForm.mainActivity} onChange={(e) => setLessonForm({ ...lessonForm, mainActivity: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" rows={3} /></div>
              <div><label className="block text-sm text-ink-muted mb-1">Conclusion</label><textarea value={lessonForm.conclusion} onChange={(e) => setLessonForm({ ...lessonForm, conclusion: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" rows={2} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm text-ink-muted mb-1">Materials</label><input type="text" value={lessonForm.materials} onChange={(e) => setLessonForm({ ...lessonForm, materials: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" /></div>
                <div><label className="block text-sm text-ink-muted mb-1">Homework</label><input type="text" value={lessonForm.homework} onChange={(e) => setLessonForm({ ...lessonForm, homework: e.target.value })} className="w-full px-4 py-2.5 rounded-xl input-field text-sm" /></div>
              </div>
            </div>
            <div className="flex gap-3 pt-4 mt-4 border-t border-line">
              <button onClick={() => setEditLessonPlan(null)} className="flex-1 px-4 py-2.5 rounded-xl input-field text-ink-muted hover:bg-surface-elevated">Cancel</button>
              <button onClick={handleSaveLesson} disabled={submitting} className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-50">
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Scheme of Work & Lesson Planning</p>
        </div>
      </footer>
    </div>
  );
};

export default SchemeOfWorkPage;
