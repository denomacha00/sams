import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '@sams/shared';

interface TimetableEntry {
  id: string;
  classId: string;
  teacherId: string;
  subject: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string;
  class?: { name: string };
  teacher?: { fullName: string };
  activeSessionId?: string | null;
  activeRecordCount?: number;
  studentCount?: number;
}

interface SchoolClass {
  id: string;
  name: string;
  departmentId?: string;
}

interface GeneratorInfo {
  classes: SchoolClass[];
  teachers: { id: string; fullName: string; departmentId: string | null }[];
  subjects: string[];
  existingEntryCount: number;
}

interface EntryFormData {
  departmentId: string;
  classId: string;
  teacherId: string;
  subject: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
}

interface PreviewSlot {
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  room?: string;
}

interface PreviewResult {
  slots: PreviewSlot[];
  stats: Record<string, number>;
  teacherAssignments: Record<string, number>;
  classNames: string[];
  teacherNames: string[];
  roomsUsed: string[];
  doubleLessons: number;
  skippedSlots: number;
}

interface GenerateResult {
  entriesCreated: number;
  classesProcessed: number;
  teachersUsed: number;
  skippedSlots: number;
  remake: boolean;
  elapsed: number;
  stats: Record<string, number>;
  teacherAssignments: Record<string, number>;
  classNames: string[];
  teacherNames: string[];
  roomsUsed: string[];
  doubleLessons: number;
  warning?: string;
}

const emptyForm: EntryFormData = {
  departmentId: '',
  classId: '',
  teacherId: '',
  subject: '',
  dayOfWeek: 0,
  startTime: '08:00',
  endTime: '09:00',
  room: '',
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function minutesFromTime(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

type EntryTimeStatus = 'now' | 'later' | 'past' | null;

function normalizeUsersList(data: unknown): { id: string; fullName: string }[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { users?: unknown }).users)) {
    return (data as { users: { id: string; fullName: string }[] }).users;
  }
  return [];
}

function sortTeachersForSelect(
  teachers: { id: string; fullName: string }[],
  currentUserId?: string,
): { id: string; fullName: string }[] {
  return [...teachers].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.fullName.localeCompare(b.fullName);
  });
}

function teacherSelectLabel(teacher: { id: string; fullName: string }, currentUserId?: string): string {
  return teacher.id === currentUserId ? `Me (${teacher.fullName})` : teacher.fullName;
}

const TimetablePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const canManage = user?.role === UserRole.HOD;
  const isHOD = user?.role === UserRole.HOD;
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimetableEntry | null>(null);
  const [formData, setFormData] = useState<EntryFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [departments, setDepartments] = useState<{id: string; name: string; classes?: {id: string; name: string; departmentId?: string}[]}[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [teachers, setTeachers] = useState<{id: string; fullName: string}[]>([]);
  const [currentMinutes, setCurrentMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  // Auto-generator state
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [generatorInfo, setGeneratorInfo] = useState<GeneratorInfo | null>(null);
  const [loadingGeneratorInfo, setLoadingGeneratorInfo] = useState(false);
  const [genClassIds, setGenClassIds] = useState<string[]>([]);
  const [genRemake, setGenRemake] = useState(false);
  const [genDurationUnit, setGenDurationUnit] = useState<'min' | 'hr'>('min');
  const [genPeriodDuration, setGenPeriodDuration] = useState(40);
  const [genPeriodHours, setGenPeriodHours] = useState(1);
  const [genStartHour, setGenStartHour] = useState(8);
  const [genRooms, setGenRooms] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genPreview, setGenPreview] = useState<PreviewResult | null>(null);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);
  const [genError, setGenError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setCurrentMinutes(now.getHours() * 60 + now.getMinutes());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (user?.role === UserRole.SCHOOL_ADMIN) {
      navigate('/timetable', { replace: true });
      return;
    }
    fetchEntries();
    fetchDepartments();
    fetchTeachers();
  }, [user?.role, user?.id, user?.departmentId, navigate]);

  const fetchDepartments = async () => {
    try {
      const { data } = await apiClient.get('/departments');
      const allDepts = Array.isArray(data) ? data : (data.departments || []);
      const depts = isHOD && user?.departmentId
        ? allDepts.filter((dept: { id: string }) => dept.id === user.departmentId)
        : allDepts;
      const enriched = await Promise.all(
        depts.map(async (dept: { id: string; name: string }) => {
          try {
            const { data: classData } = await apiClient.get(`/departments/${dept.id}/classes`);
            const deptClasses = (Array.isArray(classData) ? classData : []).map((c: { id: string; name: string }) => ({
              id: c.id,
              name: c.name,
              departmentId: dept.id,
            }));
            return { ...dept, classes: deptClasses };
          } catch {
            return { ...dept, classes: [] };
          }
        }),
      );
      setDepartments(enriched);
      setClasses(enriched.flatMap((d) => d.classes || []));
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  const fetchTeachers = async () => {
    try {
      if (user?.role === UserRole.HOD && user.departmentId) {
        const { data } = await apiClient.get(`/departments/${user.departmentId}/teachers`);
        let users = normalizeUsersList(data);
        if (user.id && !users.some((t) => t.id === user.id)) {
          users = [{ id: user.id, fullName: user.fullName }, ...users];
        }
        setTeachers(sortTeachersForSelect(users, user?.id));
      } else {
        const { data } = await apiClient.get('/users', {
          params: { roles: 'TEACHER,HOD' },
        });
        let users = normalizeUsersList(data);
        if (user?.role === UserRole.HOD && user.id && !users.some((t) => t.id === user.id)) {
          users = [{ id: user.id, fullName: user.fullName }, ...users];
        }
        setTeachers(sortTeachersForSelect(users, user?.id));
      }
    } catch (err) {
      console.error('Failed to fetch teachers:', err);
      if (user?.role === UserRole.HOD && user.id) {
        setTeachers([{ id: user.id, fullName: user.fullName }]);
      }
    }
  };

  const fetchEntries = async () => {
    try {
      const { data } = await apiClient.get('/timetable');
      const entries = Array.isArray(data) ? data : (data.entries || data || []);
      setEntries(entries);
    } catch (err) {
      console.error('Failed to fetch timetable:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const openGeneratorModal = async () => {
    setGenResult(null);
    setGenPreview(null);
    setGenError('');
    setGenClassIds([]);
    setGenRemake(false);
    setGenDurationUnit('min');
    setGenPeriodDuration(40);
    setGenPeriodHours(2);
    setLoadingGeneratorInfo(true);
    setShowGeneratorModal(true);
    try {
      const { data } = await apiClient.get('/timetable/generator-info');
      setGeneratorInfo(data);
      setGenClassIds(data.classes.map((c: SchoolClass) => c.id));
    } catch (err: any) {
      setGenError(err.response?.data?.error || 'Failed to load generator info');
    } finally {
      setLoadingGeneratorInfo(false);
    }
  };

  /** Compute period duration in minutes based on unit */
  const getDurationMinutes = () => {
    if (genDurationUnit === 'hr') return genPeriodHours * 60;
    return genPeriodDuration;
  };

  const handlePreview = async () => {
    if (genClassIds.length === 0) {
      setGenError('Select at least one class to generate a timetable for.');
      return;
    }
    setGenerating(true);
    setGenError('');
    setGenPreview(null);
    setGenResult(null);
    try {
      const roomsList = genRooms.split(',').map((r) => r.trim()).filter(Boolean);
      const { data } = await apiClient.post('/timetable/generate-preview', {
        classIds: genClassIds,
        periodDuration: getDurationMinutes(),
        startHour: genStartHour,
        rooms: roomsList,
      });
      setGenPreview(data);
    } catch (err: any) {
      setGenError(err.response?.data?.error || err.response?.data?.message || 'Preview generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    setGenError('');
    try {
      const roomsList = genRooms.split(',').map((r) => r.trim()).filter(Boolean);
      const { data } = await apiClient.post('/timetable/generate', {
        classIds: genClassIds,
        remake: genRemake,
        periodDuration: getDurationMinutes(),
        startHour: genStartHour,
        rooms: roomsList,
      });
      setGenResult(data);
      setGenPreview(null);
      fetchEntries();
    } catch (err: any) {
      setGenError(err.response?.data?.error || err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = () => {
    setGenPreview(null);
    setGenResult(null);
    setGenError('');
  };

  const filteredEntries = entries.filter((e) => {
    if (filterClass) {
      const classMatch = e.classId === filterClass || (e.class?.name || '').toLowerCase().includes(filterClass.toLowerCase());
      if (!classMatch) return false;
    }
    if (filterTeacher) {
      const teacherMatch = e.teacherId === filterTeacher || (e.teacher?.fullName || '').toLowerCase().includes(filterTeacher.toLowerCase());
      if (!teacherMatch) return false;
    }
    return true;
  });

  const openAddModal = () => {
    setEditingEntry(null);
    setFormData({
      ...emptyForm,
      departmentId: isHOD ? (user?.departmentId ?? '') : '',
    });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (entry: TimetableEntry) => {
    const matchedClass = classes.find((c) => c.id === entry.classId);
    setEditingEntry(entry);
    setFormData({
      departmentId: matchedClass?.departmentId || (isHOD ? (user?.departmentId ?? '') : ''),
      classId: entry.classId,
      teacherId: entry.teacherId,
      subject: entry.subject,
      dayOfWeek: entry.dayOfWeek,
      startTime: entry.startTime,
      endTime: entry.endTime,
      room: entry.room || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        classId: formData.classId,
        teacherId: formData.teacherId,
        subject: formData.subject,
        dayOfWeek: formData.dayOfWeek,
        startTime: formData.startTime,
        endTime: formData.endTime,
        room: formData.room || undefined,
      };

      if (editingEntry) {
        await apiClient.put(`/timetable/${editingEntry.id}`, payload);
      } else {
        await apiClient.post('/timetable', payload);
      }

      setShowModal(false);
      fetchEntries();
    } catch (err: any) {
      const backendMsg = err.response?.data?.error || err.response?.data?.message;
      const statusCode = err.response?.status;
      console.error('[Timetable] Submit error:', statusCode, err.response?.data || err.message);
      setError(backendMsg || `Operation failed (${statusCode || 'network error'})`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this timetable entry?')) return;
    try {
      await apiClient.delete(`/timetable/${entryId}`);
      fetchEntries();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const getEntriesForDay = (day: number) => filteredEntries.filter((e) => e.dayOfWeek === day);
  const todayIndex = (new Date().getDay() + 6) % 7;
  const getEntryTimeStatus = (entry: TimetableEntry): EntryTimeStatus => {
    if (entry.dayOfWeek !== todayIndex) return null;
    const start = minutesFromTime(entry.startTime);
    const end = minutesFromTime(entry.endTime);
    if (currentMinutes >= start && currentMinutes < end) return 'now';
    if (currentMinutes < start) return 'later';
    return 'past';
  };
  const timeStatusLabel = (status: EntryTimeStatus) =>
    status === 'now' ? 'Now' : status === 'later' ? 'Later' : status === 'past' ? 'Past' : '';
  const timeStatusClass = (status: EntryTimeStatus) => {
    if (status === 'now') return 'bg-red-500/20 text-red-300 border border-red-400/25';
    if (status === 'later') return 'bg-indigo-500/20 text-brand border border-indigo-400/20';
    if (status === 'past') return 'bg-slate-500/15 text-ink-subtle border border-white/10';
    return '';
  };
  const attendanceProgressLabel = (entry: TimetableEntry) => {
    if (getEntryTimeStatus(entry) !== 'now') return null;
    return `${entry.activeRecordCount ?? 0}/${entry.studentCount ?? 0}`;
  };
  const effectiveDepartmentId = isHOD ? (user?.departmentId ?? '') : formData.departmentId;
  const modalClassOptions = effectiveDepartmentId
    ? classes.filter((c) => c.departmentId === effectiveDepartmentId)
    : [];

  // Group preview slots by day for better reading
  const previewByDay = genPreview
    ? genPreview.slots.reduce<Record<number, PreviewSlot[]>>((acc, s) => {
        if (!acc[s.dayOfWeek]) acc[s.dayOfWeek] = [];
        acc[s.dayOfWeek].push(s);
        return acc;
      }, {})
    : {};

  return (
    <div className="page-shell">
      {/* Header */}
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-ink-muted hover:text-brand transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-ink">Timetable Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode(viewMode === 'table' ? 'grid' : 'table')}
              className="px-3 py-2 rounded-lg input-field text-ink text-sm hover:bg-surface-elevated transition-colors"
            >
              {viewMode === 'table' ? '📅 Grid View' : '📋 Table View'}
            </button>
            {canManage && (
              <>
                <button
                  onClick={openGeneratorModal}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors"
                >
                  ⚡ Auto Generate
                </button>
                <button
                  onClick={openAddModal}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition-colors"
                >
                  + Add Entry
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex gap-4 mb-6 flex-wrap">
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-4 py-2 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors text-sm min-w-[14rem]"
          >
            <option value="" className="bg-slate-900">All classes</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id} className="bg-slate-900">{cls.name}</option>
            ))}
          </select>
          <select
            value={filterTeacher}
            onChange={(e) => setFilterTeacher(e.target.value)}
            className="px-4 py-2 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors text-sm min-w-[14rem]"
          >
            <option value="" className="bg-slate-900">All teachers</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id} className="bg-slate-900">
                {teacherSelectLabel(teacher, user?.id)}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center text-ink-muted py-12">Loading timetable...</div>
        ) : viewMode === 'table' ? (
          /* Table View */
          <div className="surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Day</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Subject</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Class</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Teacher</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Time</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Active</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Room</th>
                    <th className="text-right px-6 py-4 text-sm font-semibold text-ink">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-ink-muted">No timetable entries</td>
                    </tr>
                  ) : (
                    filteredEntries
                      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                      .map((entry) => (
                        <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 text-sm text-white">
                            {DAYS[entry.dayOfWeek]}
                            {getEntryTimeStatus(entry) && (
                              <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${timeStatusClass(getEntryTimeStatus(entry))}`}>
                                {timeStatusLabel(getEntryTimeStatus(entry))}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-ink font-medium">{entry.subject}</td>
                          <td className="px-6 py-4 text-sm text-ink-muted">{entry.class?.name || classes.find((c) => c.id === entry.classId)?.name || 'Unknown class'}</td>
                          <td className="px-6 py-4 text-sm text-ink-muted">{entry.teacher?.fullName || entry.teacherId}</td>
                          <td className="px-6 py-4 text-sm text-ink-muted">{entry.startTime} - {entry.endTime}</td>
                          <td className="px-6 py-4 text-sm text-ink-muted">
                            {attendanceProgressLabel(entry) ? (
                              <span className="inline-flex items-center rounded-full bg-red-500/10 border border-red-400/20 px-2 py-0.5 text-xs font-semibold text-red-200">
                                {attendanceProgressLabel(entry)}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-ink-muted">{entry.room || '—'}</td>
                          <td className="px-6 py-4 text-right">
                            {canManage && (
                              <>
                            <button
                              onClick={() => openEditModal(entry)}
                              className="text-indigo-400 hover:text-indigo-300 text-sm mr-3 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="text-red-400 hover:text-red-300 text-sm transition-colors"
                            >
                              Delete
                            </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {DAYS.slice(0, 5).map((day, idx) => (
              <div key={day} className="surface-card p-4">
                <h4 className="text-white font-semibold text-sm mb-3 pb-2 border-b border-white/10">{day}</h4>
                <div className="space-y-2">
                  {getEntriesForDay(idx).length === 0 ? (
                    <p className="text-ink-subtle text-xs">No classes</p>
                  ) : (
                    getEntriesForDay(idx)
                      .sort((a, b) => a.startTime.localeCompare(b.startTime))
                      .map((entry) => (
                        <div
                          key={entry.id}
                          className="timetable-slot"
                          onClick={() => canManage && openEditModal(entry)}
                          onKeyDown={(e) => {
                            if (canManage && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              openEditModal(entry);
                            }
                          }}
                          role={canManage ? 'button' : undefined}
                          tabIndex={canManage ? 0 : undefined}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-ink">{entry.subject}</p>
                            {getEntryTimeStatus(entry) && (
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${timeStatusClass(getEntryTimeStatus(entry))}`}>
                                {timeStatusLabel(getEntryTimeStatus(entry))}
                              </span>
                            )}
                          </div>
                          <p className="text-ink-muted text-xs mt-1 font-mono">{entry.startTime} - {entry.endTime}</p>
                          {attendanceProgressLabel(entry) && (
                            <p className="mt-2 inline-flex items-center rounded-full bg-red-500/10 border border-red-400/20 px-2 py-0.5 text-[11px] font-semibold text-red-200">
                              {attendanceProgressLabel(entry)} marked
                            </p>
                          )}
                          <p className="text-ink-muted text-xs">{entry.class?.name || classes.find((c) => c.id === entry.classId)?.name || 'Unknown class'}</p>
                          {entry.room && <p className="text-ink-subtle text-xs">Room: {entry.room}</p>}
                        </div>
                      ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add/Edit Entry Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="input-field rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-ink mb-6">
              {editingEntry ? 'Edit Timetable Entry' : 'Add Timetable Entry'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Subject *</label>
                <input
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl input-field placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                  placeholder="Mathematics"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  {isHOD ? (
                    <div className="mb-3 rounded-xl border border-line bg-surface-muted px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Department</p>
                      <p className="text-sm font-medium text-ink">
                        {departments[0]?.name ?? 'Your department'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <label className="block text-sm text-ink-muted mb-1">Department *</label>
                      <select
                        required
                        value={formData.departmentId}
                        onChange={(e) => setFormData({ ...formData, departmentId: e.target.value, classId: '' })}
                        className="w-full px-4 py-2.5 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors mb-3"
                      >
                        <option value="" className="bg-slate-800">-- Select Department --</option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id} className="bg-slate-800">{dept.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <label className="block text-sm text-ink-muted mb-1">Class *</label>
                  <select
                    required
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    disabled={modalClassOptions.length === 0}
                    className="w-full px-4 py-2.5 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="" className="bg-slate-800">
                      {modalClassOptions.length === 0 ? '-- No classes available --' : '-- Select Class --'}
                    </option>
                    {modalClassOptions.map((cls) => (
                      <option key={cls.id} value={cls.id} className="bg-slate-800">{cls.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-ink-muted mb-1">Teacher *</label>
                  <select
                    required
                    value={formData.teacherId}
                    onChange={(e) => setFormData({ ...formData, teacherId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    <option value="" className="bg-slate-800">-- Select Teacher --</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id} className="bg-slate-800">
                        {teacherSelectLabel(t, user?.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-ink-muted mb-1">Day of Week *</label>
                <select
                  value={formData.dayOfWeek}
                  onChange={(e) => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors"
                >
                  {DAYS.map((day, idx) => (
                    <option key={day} value={idx} className="bg-slate-800">{day}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-ink-muted mb-1">Start Time *</label>
                  <input
                    type="time"
                    required
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-ink-muted mb-1">End Time *</label>
                  <input
                    type="time"
                    required
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl input-field focus:outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-ink-muted mb-1">Room</label>
                <input
                  type="text"
                  value={formData.room}
                  onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl input-field placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                  placeholder="Room 101"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl input-field text-ink-muted hover:bg-surface-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingEntry ? 'Update Entry' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Auto-Generator Modal */}
      {showGeneratorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="input-field rounded-2xl p-8 w-full max-w-4xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-ink mb-2">⚡ Auto-Generate Timetable</h3>
            <p className="text-ink-muted text-sm mb-6">
              Configure your lesson period length and rooms. Preview the schedule first, then confirm to save.
              {generatorInfo?.existingEntryCount && generatorInfo.existingEntryCount > 0
                ? ` Existing entries (${generatorInfo.existingEntryCount}) will remain — use "Remake" to replace them.`
                : ''}
            </p>

            {genError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {genError}
              </div>
            )}

            {/* ─── Success result (saved to DB) ─── */}
            {genResult && !genPreview && (
              <div className="mb-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">
                <p className="font-semibold text-base mb-2">✅ Timetable Saved!</p>
                <p>• {genResult.entriesCreated} lessons created across {genResult.classNames.length} class(es)</p>
                <p>• {genResult.teachersUsed} teacher(s) assigned ({genResult.skippedSlots} slots skipped)</p>
                <p>• Generated in {genResult.elapsed.toFixed(1)}s</p>
                {genResult.warning && (
                  <p className="mt-2 text-amber-300">⚠️ {genResult.warning}</p>
                )}
                {Object.keys(genResult.stats).length > 0 && (
                  <div className="mt-2">
                    <p className="font-semibold text-xs text-emerald-300 mb-1">Per class:</p>
                    {Object.entries(genResult.stats).map(([name, count]) => (
                      <p key={name} className="text-xs">• {name}: {count} lessons</p>
                    ))}
                  </div>
                )}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => { setShowGeneratorModal(false); setGenResult(null); }}
                    className="px-4 py-2 rounded-xl bg-slate-600 text-white text-sm hover:bg-slate-500 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleRegenerate}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-500 transition-colors"
                  >
                    Generate Again
                  </button>
                </div>
              </div>
            )}

            {/* ─── Preview result (not yet saved) ─── */}
            {!genResult && genPreview && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-emerald-300 font-semibold text-sm">
                    👀 Preview — {genPreview.slots.length} lesson(s) generated across {genPreview.classNames.length} class(es)
                    {genPreview.skippedSlots > 0 && (
                      <span className="text-amber-300 ml-2">({genPreview.skippedSlots} slots skipped)</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRegenerate}
                      className="px-3 py-1.5 rounded-lg bg-slate-600 text-white text-xs hover:bg-slate-500 transition-colors"
                    >
                      ← Back & Retry
                    </button>
                    <button
                      onClick={handleConfirmSave}
                      disabled={saving}
                      className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-50"
                    >
                      {saving ? '⏳ Saving...' : '✅ Confirm & Save'}
                    </button>
                  </div>
                </div>

                {/* Preview table grouped by day */}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-muted border-b border-white/10">
                        <th className="text-left px-3 py-2 font-semibold text-ink">Day</th>
                        <th className="text-left px-3 py-2 font-semibold text-ink">Subject</th>
                        <th className="text-left px-3 py-2 font-semibold text-ink">Class</th>
                        <th className="text-left px-3 py-2 font-semibold text-ink">Teacher</th>
                        <th className="text-left px-3 py-2 font-semibold text-ink">Time</th>
                        <th className="text-left px-3 py-2 font-semibold text-ink">Room</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DAYS.slice(0, 5).map((day, idx) => {
                        const daySlots = previewByDay[idx] || [];
                        return daySlots.length === 0 ? null : (
                          <React.Fragment key={day}>
                            <tr className="bg-slate-800/30 border-b border-white/5">
                              <td colSpan={6} className="px-3 py-1.5 text-xs font-bold text-ink-muted">{day}</td>
                            </tr>
                            {daySlots
                              .sort((a, b) => a.startTime.localeCompare(b.startTime))
                              .map((slot, si) => (
                                <tr key={si} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="px-3 py-2 text-ink-muted">{slot.dayName}</td>
                                  <td className="px-3 py-2 font-medium text-ink">{slot.subject}</td>
                                  <td className="px-3 py-2 text-ink-muted">{slot.className}</td>
                                  <td className="px-3 py-2 text-ink-muted">{slot.teacherName}</td>
                                  <td className="px-3 py-2 text-ink-muted font-mono">{slot.startTime} – {slot.endTime}</td>
                                  <td className="px-3 py-2 text-ink-muted">{slot.room || '—'}</td>
                                </tr>
                              ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {genPreview.skippedSlots > 0 && (
                  <p className="text-xs text-amber-300 mt-2">⚠️ {genPreview.skippedSlots} slot(s) could not be filled — try different settings.</p>
                )}
              </div>
            )}

            {/* ─── Configuration form (shown when no preview and no result) ─── */}
            {!genPreview && !genResult && (
              <>
                {loadingGeneratorInfo ? (
                  <div className="text-center py-8 text-ink-muted">Loading classes & teachers...</div>
                ) : generatorInfo ? (
                  <>
                    {/* Class Selection */}
                    <div className="mb-4">
                      <label className="block text-sm font-semibold text-ink mb-2">
                        Classes to schedule ({genClassIds.length} selected)
                      </label>
                      <div className="max-h-40 overflow-y-auto space-y-1.5">
                        {generatorInfo.classes.map((cls) => (
                          <label key={cls.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded px-2 py-1 transition-colors">
                            <input
                              type="checkbox"
                              className="accent-indigo-500"
                              checked={genClassIds.includes(cls.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setGenClassIds([...genClassIds, cls.id]);
                                } else {
                                  setGenClassIds(genClassIds.filter((id) => id !== cls.id));
                                }
                              }}
                            />
                            <span className="text-sm text-ink">{cls.name}</span>
                          </label>
                        ))}
                        {generatorInfo.classes.length === 0 && (
                          <p className="text-ink-muted text-sm">No classes found. Create classes first.</p>
                        )}
                      </div>
                    </div>

                    {/* Teacher count */}
                    <div className="mb-4 rounded-lg bg-surface-muted px-4 py-3">
                      <p className="text-sm text-ink-muted">
                        <span className="font-semibold text-ink">{generatorInfo.teachers.length}</span> teacher(s) available
                        {generatorInfo.subjects.length > 0 && (
                          <> · <span className="font-semibold text-ink">{generatorInfo.subjects.length}</span> subject(s) from existing timetable</>
                        )}
                      </p>
                    </div>

                    {/* Rooms Input */}
                    <div className="mb-4">
                      <label className="block text-sm text-ink-muted mb-1">
                        Rooms <span className="text-xs text-ink-subtle">(comma-separated — list all available rooms)</span>
                      </label>
                      <input
                        type="text"
                        value={genRooms}
                        onChange={(e) => setGenRooms(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl input-field placeholder-ink-subtle text-sm"
                        placeholder="Room 1, Room 2, Lab A, Lab B"
                      />
                      <p className="text-xs text-ink-subtle mt-1">
                        Leave empty to skip room assignment. The system distributes rooms evenly across lessons.
                      </p>
                    </div>

                    {/* Period Length — with unit toggle */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div>
                        <label className="block text-sm text-ink-muted mb-1">
                          Period length
                        </label>
                        <div className="flex gap-1">
                          {genDurationUnit === 'min' ? (
                            <select
                              value={genPeriodDuration}
                              onChange={(e) => setGenPeriodDuration(Number(e.target.value))}
                              className="flex-1 px-3 py-2.5 rounded-xl input-field text-sm"
                            >
                              <option value={20}>20 min</option>
                              <option value={30}>30 min</option>
                              <option value={35}>35 min</option>
                              <option value={40}>40 min</option>
                              <option value={45}>45 min</option>
                              <option value={50}>50 min</option>
                              <option value={60}>60 min</option>
                              <option value={80}>80 min</option>
                              <option value={90}>90 min</option>
                              <option value={120}>120 min</option>
                            </select>
                          ) : (
                            <select
                              value={genPeriodHours}
                              onChange={(e) => setGenPeriodHours(Number(e.target.value))}
                              className="flex-1 px-3 py-2.5 rounded-xl input-field text-sm"
                            >
                              <option value={1}>1 hour</option>
                              <option value={1.5}>1.5 hours</option>
                              <option value={2}>2 hours</option>
                              <option value={2.5}>2.5 hours</option>
                              <option value={3}>3 hours</option>
                            </select>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (genDurationUnit === 'min') {
                                setGenDurationUnit('hr');
                                setGenPeriodHours(1);
                              } else {
                                setGenDurationUnit('min');
                                setGenPeriodDuration(60);
                              }
                            }}
                            className="px-2.5 py-2.5 rounded-xl input-field text-xs font-medium text-ink-muted hover:text-ink transition-colors shrink-0"
                            title="Toggle between minutes and hours"
                          >
                            {genDurationUnit === 'min' ? '⏱ min' : '⏱ hr'}
                          </button>
                        </div>
                        <p className="text-xs text-ink-subtle mt-1">
                          {getDurationMinutes()} min per lesson
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm text-ink-muted mb-1">Start</label>
                        <select
                          value={genStartHour}
                          onChange={(e) => setGenStartHour(Number(e.target.value))}
                          className="w-full px-3 py-2.5 rounded-xl input-field text-sm"
                        >
                          <option value={6}>06:00</option>
                          <option value={7}>07:00</option>
                          <option value={8}>08:00</option>
                          <option value={9}>09:00</option>
                          <option value={10}>10:00</option>
                        </select>
                      </div>
                    </div>

                    {/* Toggle Remake */}
                    <label className="flex items-center gap-3 mb-6 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-amber-500"
                        checked={genRemake}
                        onChange={(e) => setGenRemake(e.target.checked)}
                      />
                      <div>
                        <p className="text-sm font-medium text-ink">Remake mode</p>
                        <p className="text-xs text-ink-muted">
                          Deletes existing entries for selected classes before generating
                        </p>
                      </div>
                    </label>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowGeneratorModal(false)}
                        className="flex-1 px-4 py-2.5 rounded-xl input-field text-ink-muted hover:bg-surface-elevated transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handlePreview}
                        disabled={generating || genClassIds.length === 0}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50"
                      >
                        {generating ? '⏳ Generating preview...' : '👀 Preview'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-red-300">Failed to load data. Check your connection.</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default TimetablePage;
