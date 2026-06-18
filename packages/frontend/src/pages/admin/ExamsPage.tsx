import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { UserRole, ExamType } from '@sams/shared';
import apiClient from '../../services/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AcademicTerm {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

interface Exam {
  id: string;
  subject: string;
  examType: string;
  maxScore: number;
  weight: number;
  date: string;
  term: { id: string; name: string };
  class: { id: string; name: string };
  creator: { id: string; fullName: string };
  _count: { results: number };
}

interface Student {
  id: string;
  fullName: string;
  admissionNumber: string | null;
}

interface ExamResult {
  id: string;
  student: { id: string; fullName: string; admissionNumber: string | null };
  score: number;
  comment?: string;
}

interface GradeBoundary {
  id: string;
  grade: string;
  minScore: number;
  maxScore: number;
  points: number;
}

// ─── Tab enum ────────────────────────────────────────────────────────────────

type Tab = 'terms' | 'exams' | 'marks' | 'boundaries';

// ─── Icons ───────────────────────────────────────────────────────────────────

const ICONS = {
  plus: 'M12 4v16m8-8H4',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  check: 'M5 13l4 4L19 7',
  close: 'M6 18L18 6M6 6l12 12',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXAM_TYPES = [
  { value: 'CAT1', label: 'CAT 1' },
  { value: 'CAT2', label: 'CAT 2' },
  { value: 'CAT3', label: 'CAT 3' },
  { value: 'PRACTICAL1', label: 'Practical 1' },
  { value: 'PRACTICAL2', label: 'Practical 2' },
  { value: 'PRACTICAL3', label: 'Practical 3' },
  { value: 'END_TERM', label: 'End Term' },
];

function examTypeLabel(value: string): string {
  return EXAM_TYPES.find((type) => type.value === value)?.label ?? value;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Sub-component: Terms Tab ────────────────────────────────────────────────

const TermsTab: React.FC<{
  terms: AcademicTerm[];
  loading: boolean;
  onRefresh: () => void;
}> = ({ terms, loading, onRefresh }) => {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiClient.post('/exams/terms', { name, startDate, endDate, isActive });
      setName('');
      setStartDate('');
      setEndDate('');
      setIsActive(false);
      setShowForm(false);
      onRefresh();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create term');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (term: AcademicTerm) => {
    try {
      await apiClient.patch(`/exams/terms/${term.id}`, { isActive: !term.isActive });
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this term? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/exams/terms/${id}`);
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-12 rounded-xl bg-surface-elevated" /><div className="h-12 rounded-xl bg-surface-elevated" /><div className="h-12 rounded-xl bg-surface-elevated" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-ink">Academic Terms</h3>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary px-4 py-2 text-sm">
          {showForm ? 'Cancel' : 'New Term'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="surface-panel p-5 mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Term Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="form-input w-full"
                placeholder="e.g. Term 1 2026"
                required
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-line text-brand focus:ring-brand"
              />
              <label htmlFor="isActive" className="text-sm text-ink">Set as active term</label>
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input w-full" required />
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input w-full" required />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2 text-sm">
            {saving ? 'Creating...' : 'Create Term'}
          </button>
        </form>
      )}

      {terms.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">No academic terms created yet. Use the academic year structure above.</p>
      ) : (
        <div className="space-y-3">
          {terms.map((term) => (
            <div key={term.id} className={`surface-muted-row border-l-4 ${term.isActive ? 'border-l-green-500' : 'border-l-line'}`}>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-ink">{term.name}</span>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs text-ink-muted">{formatDate(term.startDate)} - {formatDate(term.endDate)}</span>
                  {term.isActive && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-semibold">Active</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggleActive(term)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${term.isActive ? 'border-line text-ink-muted' : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}
                >
                  {term.isActive ? 'Deactivate' : 'Set Active'}
                </button>
                <button onClick={() => handleDelete(term.id)} className="text-red-400 hover:text-red-300 p-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.trash} /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Sub-component: Exams Tab ────────────────────────────────────────────────

const ExamsTab: React.FC<{
  exams: Exam[];
  terms: AcademicTerm[];
  classes: { id: string; name: string }[];
  loading: boolean;
  onRefresh: () => void;
  canPlan: boolean;
}> = ({ exams, terms, classes, loading, onRefresh, canPlan }) => {
  const [showForm, setShowForm] = useState(false);
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState('CAT1');
  const [maxScore, setMaxScore] = useState(100);
  const [weight, setWeight] = useState(1);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiClient.post('/exams', { termId, classId, subject, examType, maxScore, weight, date });
      setTermId('');
      setClassId('');
      setSubject('');
      setExamType('CAT1');
      setMaxScore(100);
      setWeight(1);
      setDate('');
      setShowForm(false);
      onRefresh();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create exam');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExam = async (id: string) => {
    if (!window.confirm('Delete this exam? All results will be removed.')) return;
    try {
      await apiClient.delete(`/exams/${id}`);
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-12 rounded-xl bg-surface-elevated" /><div className="h-12 rounded-xl bg-surface-elevated" /><div className="h-12 rounded-xl bg-surface-elevated" /></div>;

  const activeTerm = terms.find((t) => t.isActive);
  const filteredExams = termId ? exams.filter((e) => e.term.id === termId) : exams;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-ink">Exams</h3>
        {canPlan && (
          <button onClick={() => setShowForm(!showForm)} className="btn-primary px-4 py-2 text-sm">
            {showForm ? 'Cancel' : 'New Exam'}
          </button>
        )}
      </div>

      {canPlan && showForm && (
        <form onSubmit={handleCreate} className="surface-panel p-5 mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Term</label>
              <select value={termId} onChange={(e) => setTermId(e.target.value)} className="form-input w-full" required>
                <option value="">Select term</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isActive ? ' (Active)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="form-input w-full" required>
                <option value="">Select class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="form-input w-full" placeholder="e.g. Mathematics" required />
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Exam Type</label>
              <select value={examType} onChange={(e) => setExamType(e.target.value)} className="form-input w-full">
                {EXAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Max Score</label>
              <input type="number" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} className="form-input w-full" min={1} required />
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Weight</label>
              <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="form-input w-full" min={0.1} required />
            </div>
            <div>
              <label className="block text-sm text-ink-muted mb-1">Exam Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="form-input w-full" required />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2 text-sm">
            {saving ? 'Creating...' : 'Create Exam'}
          </button>
        </form>
      )}

      {/* Filter by term */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-ink-muted">Filter by term:</label>
        <select value={termId} onChange={(e) => setTermId(e.target.value)} className="form-input w-56 text-sm">
          <option value="">All terms</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {filteredExams.length === 0 ? (
        <p className="text-ink-muted text-sm py-8 text-center">No exams created. Create one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left py-3 px-3 text-ink-muted font-medium">Subject</th>
                <th className="text-left py-3 px-3 text-ink-muted font-medium">Type</th>
                <th className="text-left py-3 px-3 text-ink-muted font-medium">Class</th>
                <th className="text-left py-3 px-3 text-ink-muted font-medium">Term</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Max</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Results</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Date</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExams.map((exam) => (
                <tr key={exam.id} className="border-b border-line hover:bg-surface-muted/50">
                  <td className="py-3 px-3 text-ink font-medium">{exam.subject}</td>
                  <td className="py-3 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      exam.examType === 'END_TERM' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {examTypeLabel(exam.examType)}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-ink-muted">{exam.class.name}</td>
                  <td className="py-3 px-3 text-ink-muted">{exam.term.name}</td>
                  <td className="py-3 px-3 text-right text-ink">{exam.maxScore}</td>
                  <td className="py-3 px-3 text-right">
                    <Link to={`/exams/${exam.id}/marks`} className="text-brand hover:text-brand-hover font-medium">
                      {exam._count.results}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-right text-ink-muted">{formatDate(exam.date)}</td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/exams/${exam.id}/marks`} className="text-xs px-3 py-1.5 rounded-lg border border-line text-ink-muted hover:bg-surface-muted">
                        Marks
                      </Link>
                      {canPlan && (
                        <button onClick={() => handleDeleteExam(exam.id)} className="text-red-400 hover:text-red-300 p-1.5">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS.trash} /></svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Sub-component: Enter Marks Tab ──────────────────────────────────────────

const MarksTab: React.FC<{
  exams: Exam[];
  terms: AcademicTerm[];
  classes: { id: string; name: string }[];
  onRefresh: () => void;
}> = ({ exams, terms, classes, onRefresh }) => {
  const [selectedExamId, setSelectedExamId] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedExam = exams.find((e) => e.id === selectedExamId);

  const loadExamResults = useCallback(async (examId: string) => {
    setLoadingStudents(true);
    try {
      const exam = exams.find((e) => e.id === examId);
      if (!exam) return;

      const [studentsRes, resultsRes] = await Promise.all([
        apiClient.get('/users', { params: { role: 'STUDENT', classId: exam.class.id } }),
        apiClient.get(`/exams/${examId}/results`),
      ]);

      const studentList: Student[] = Array.isArray(studentsRes.data) ? studentsRes.data : [];
      const resultList: ExamResult[] = Array.isArray(resultsRes.data) ? resultsRes.data : [];

      setStudents(studentList);
      setResults(resultList);

      // Populate scores/comments from existing results
      const scoreMap: Record<string, string> = {};
      const commentMap: Record<string, string> = {};
      for (const r of resultList) {
        scoreMap[r.student.id] = String(r.score);
        if (r.comment) commentMap[r.student.id] = r.comment;
      }
      setScores(scoreMap);
      setComments(commentMap);
    } catch {
      setError('Failed to load student data');
    } finally {
      setLoadingStudents(false);
    }
  }, [exams]);

  useEffect(() => {
    if (selectedExamId) {
      void loadExamResults(selectedExamId);
    } else {
      setStudents([]);
      setResults([]);
      setScores({});
      setComments({});
    }
  }, [selectedExamId, loadExamResults]);

  const handleSave = async () => {
    if (!selectedExamId) return;
    setSaving(true);
    setError('');
    setSuccess('');

    const resultsPayload = students
      .filter((s) => scores[s.id] !== undefined && scores[s.id] !== '')
      .map((s) => ({
        studentId: s.id,
        score: Number(scores[s.id]),
        comment: comments[s.id] || undefined,
      }));

    if (resultsPayload.length === 0) {
      setError('Enter at least one score');
      setSaving(false);
      return;
    }

    try {
      await apiClient.post(`/exams/${selectedExamId}/results`, { results: resultsPayload });
      setSuccess(`Saved ${resultsPayload.length} result(s)`);
      onRefresh();
      void loadExamResults(selectedExamId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save results');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-bold text-ink mb-6">Enter Marks</h3>

      <div className="mb-6">
        <label className="block text-sm text-ink-muted mb-1">Select Exam</label>
        <select value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)} className="form-input w-full max-w-md">
          <option value="">Choose an exam...</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.subject} - {e.examType} - {e.class.name} ({formatDate(e.date)})
            </option>
          ))}
        </select>
      </div>

      {selectedExam && (
        <div className="surface-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="font-semibold text-ink">{selectedExam.subject}</h4>
              <p className="text-sm text-ink-muted">
                {selectedExam.examType} · {selectedExam.class.name} · Max: {selectedExam.maxScore} · Weight: {selectedExam.weight}
              </p>
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-primary px-6 py-2 text-sm">
              {saving ? 'Saving...' : `Save Marks (${Object.keys(scores).filter((k) => scores[k] !== '').length})`}
            </button>
          </div>

          {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
          {success && <p className="text-sm text-green-400 mb-3">{success}</p>}

          {loadingStudents ? (
            <div className="animate-pulse space-y-2"><div className="h-10 rounded-xl bg-surface-elevated" /><div className="h-10 rounded-xl bg-surface-elevated" /><div className="h-10 rounded-xl bg-surface-elevated" /></div>
          ) : students.length === 0 ? (
            <p className="text-ink-muted text-sm py-4 text-center">No students in this class.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-left py-2 px-2 text-ink-muted font-medium">#</th>
                    <th className="text-left py-2 px-2 text-ink-muted font-medium">Name</th>
                    <th className="text-left py-2 px-2 text-ink-muted font-medium">Adm No.</th>
                    <th className="text-center py-2 px-2 text-ink-muted font-medium">Score / {selectedExam.maxScore}</th>
                    <th className="text-left py-2 px-2 text-ink-muted font-medium">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, idx) => (
                    <tr key={student.id} className="border-b border-line/50 hover:bg-surface-muted/30">
                      <td className="py-2 px-2 text-ink-muted text-xs">{idx + 1}</td>
                      <td className="py-2 px-2 text-ink font-medium">{student.fullName}</td>
                      <td className="py-2 px-2 text-ink-muted text-xs">{student.admissionNumber || '—'}</td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min={0}
                          max={selectedExam.maxScore}
                          value={scores[student.id] ?? ''}
                          onChange={(e) => setScores({ ...scores, [student.id]: e.target.value })}
                          className="form-input w-24 text-center mx-auto block"
                          placeholder="—"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          value={comments[student.id] ?? ''}
                          onChange={(e) => setComments({ ...comments, [student.id]: e.target.value })}
                          className="form-input w-full"
                          placeholder="Optional"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button onClick={handleSave} disabled={saving} className="btn-primary px-6 py-2 text-sm">
              {saving ? 'Saving...' : `Save Marks`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-component: Grade Boundaries Tab ─────────────────────────────────────

const BoundariesTab: React.FC<{
  boundaries: GradeBoundary[];
  onRefresh: () => void;
}> = ({ boundaries, onRefresh }) => {
  const [grade, setGrade] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);
  const [points, setPoints] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiClient.post('/exams/grade-boundaries', { grade, minScore, maxScore, points });
      setGrade('');
      setMinScore(0);
      setMaxScore(100);
      setPoints(1);
      onRefresh();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-bold text-ink mb-6">Grade Boundaries</h3>

      <form onSubmit={handleSave} className="surface-panel p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-ink-muted mb-1">Grade</label>
            <input value={grade} onChange={(e) => setGrade(e.target.value.toUpperCase())} className="form-input w-full" placeholder="A" maxLength={5} required />
          </div>
          <div>
            <label className="block text-sm text-ink-muted mb-1">Min Score</label>
            <input type="number" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="form-input w-full" required />
          </div>
          <div>
            <label className="block text-sm text-ink-muted mb-1">Max Score</label>
            <input type="number" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} className="form-input w-full" required />
          </div>
          <div>
            <label className="block text-sm text-ink-muted mb-1">Points</label>
            <input type="number" step="0.5" value={points} onChange={(e) => setPoints(Number(e.target.value))} className="form-input w-full" required />
          </div>
        </div>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2 text-sm mt-4">
          {saving ? 'Saving...' : 'Add / Update Grade'}
        </button>
      </form>

      {boundaries.length === 0 ? (
        <p className="text-ink-muted text-sm py-4 text-center">No grade boundaries set. Add one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-left py-3 px-3 text-ink-muted font-medium">Grade</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Min</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Max</th>
                <th className="text-right py-3 px-3 text-ink-muted font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {boundaries.map((b) => (
                <tr key={b.id} className="border-b border-line/50">
                  <td className="py-3 px-3 text-ink font-bold">{b.grade}</td>
                  <td className="py-3 px-3 text-right text-ink">{b.minScore}</td>
                  <td className="py-3 px-3 text-right text-ink">{b.maxScore}</td>
                  <td className="py-3 px-3 text-right text-ink font-semibold">{b.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const ExamsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>('exams');
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [boundaries, setBoundaries] = useState<GradeBoundary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [termsRes, examsRes, classesRes, boundsRes] = await Promise.all([
        apiClient.get('/exams/terms'),
        apiClient.get('/exams'),
        apiClient.get('/classes'),
        apiClient.get('/exams/grade-boundaries'),
      ]);

      setTerms(Array.isArray(termsRes.data) ? termsRes.data : []);
      setExams(Array.isArray(examsRes.data) ? examsRes.data : []);
      setClasses(Array.isArray(classesRes.data) ? classesRes.data : []);
      setBoundaries(Array.isArray(boundsRes.data) ? boundsRes.data : []);
    } catch {
      // show error state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const canManageTerms = user?.role === UserRole.SCHOOL_ADMIN;
  const canPlanExams = user?.role === UserRole.HOD;
  const canViewExams = user?.role === UserRole.SCHOOL_ADMIN || user?.role === UserRole.HOD || user?.role === UserRole.TEACHER;
  const canEnterMarks = user?.role === UserRole.TEACHER || user?.role === UserRole.HOD;

  const tabs: { key: Tab; label: string; visible: boolean }[] = [
    { key: 'terms', label: 'Terms', visible: canManageTerms },
    { key: 'exams', label: 'Exams', visible: canViewExams },
    { key: 'marks', label: 'Enter Marks', visible: canEnterMarks },
    { key: 'boundaries', label: 'Grade Boundaries', visible: user?.role === UserRole.SCHOOL_ADMIN },
  ];

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
              <h1 className="text-lg font-bold text-ink tracking-tight">Exam & Grade Management</h1>
              <p className="text-xs text-ink-muted font-medium">CATs, optional practicals, end-term, report cards, and grade boundaries</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8 border-b border-line pb-4 overflow-x-auto">
          {tabs.filter((t) => t.visible).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'terms' && <TermsTab terms={terms} loading={loading} onRefresh={fetchData} />}
        {tab === 'exams' && <ExamsTab exams={exams} terms={terms} classes={classes} loading={loading} onRefresh={fetchData} canPlan={canPlanExams} />}
        {tab === 'marks' && <MarksTab exams={exams} terms={terms} classes={classes} onRefresh={fetchData} />}
        {tab === 'boundaries' && <BoundariesTab boundaries={boundaries} onRefresh={fetchData} />}
      </main>
    </div>
  );
};

export default ExamsPage;
