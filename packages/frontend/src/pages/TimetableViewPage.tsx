import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
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
  class?: { name: string; departmentId?: string };
  teacher?: { fullName: string };
}

interface Department {
  id: string;
  name: string;
  classes?: { id: string; name: string }[];
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TimetableViewPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isSchoolAdmin = user?.role === UserRole.SCHOOL_ADMIN;
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filterDepartmentId, setFilterDepartmentId] = useState('');
  const [filterClassId, setFilterClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntries = async () => {
      try {
        const params: Record<string, string> = {};
        if (filterClassId) params.classId = filterClassId;
        const { data } = await apiClient.get('/timetable', { params });
        const list = Array.isArray(data) ? data : (data.entries || []);
        setEntries(list);
      } catch (err) {
        console.error('Failed to fetch timetable:', err);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };
    void fetchEntries();
  }, [filterClassId]);

  useEffect(() => {
    if (!isSchoolAdmin) return;
    const loadDepartments = async () => {
      try {
        const { data } = await apiClient.get('/departments');
        const depts: Department[] = Array.isArray(data) ? data : (data.departments || []);
        const enriched = await Promise.all(
          depts.map(async (d) => {
            try {
              const { data: cd } = await apiClient.get(`/departments/${d.id}/classes`);
              return { ...d, classes: Array.isArray(cd) ? cd : [] };
            } catch {
              return { ...d, classes: [] };
            }
          }),
        );
        setDepartments(enriched);
      } catch {
        /* ignore */
      }
    };
    void loadDepartments();
  }, [isSchoolAdmin]);

  const classOptions = useMemo(() => {
    if (!filterDepartmentId) return [];
    return departments.find((d) => d.id === filterDepartmentId)?.classes || [];
  }, [departments, filterDepartmentId]);

  const filteredEntries = useMemo(() => {
    if (!filterDepartmentId) return entries;
    const classIds = new Set(classOptions.map((c) => c.id));
    return entries.filter((e) => classIds.has(e.classId));
  }, [entries, filterDepartmentId, classOptions]);

  const getEntriesForDay = (day: number) =>
    filteredEntries.filter((e) => e.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));

  const todayIndex = (new Date().getDay() + 6) % 7;

  const pageTitle = isSchoolAdmin ? 'School Timetable' : 'My Timetable';

  return (
    <div className="page-shell">
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-ink-muted hover:text-brand transition-colors">
              ← Dashboard
            </Link>
            <h1 className="text-lg font-bold text-ink">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            {isSchoolAdmin && (
              <Link
                to="/ai"
                className="px-3 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-sm hover:bg-indigo-500/30 transition-colors"
              >
                Ask AI about timetable
              </Link>
            )}
            <button
              onClick={() => setViewMode(viewMode === 'table' ? 'grid' : 'table')}
              className="px-3 py-2 rounded-lg input-field text-ink-muted text-sm hover:bg-surface-elevated transition-colors"
            >
              {viewMode === 'table' ? '📅 Grid View' : '📋 Table View'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {isSchoolAdmin && (
          <div className="flex flex-wrap gap-4 mb-6">
            <select
              value={filterDepartmentId}
              onChange={(e) => { setFilterDepartmentId(e.target.value); setFilterClassId(''); setLoading(true); }}
              className="px-4 py-2 rounded-xl input-field text-sm min-w-[14rem]"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              value={filterClassId}
              onChange={(e) => { setFilterClassId(e.target.value); setLoading(true); }}
              disabled={!filterDepartmentId}
              className="px-4 py-2 rounded-xl input-field text-sm min-w-[14rem] disabled:opacity-50"
            >
              <option value="">All classes in department</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <div className="text-center text-ink-muted py-12">
            <div className="flex items-center justify-center gap-3">
              <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading timetable...
            </div>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl input-field mb-4">
              <svg className="w-8 h-8 text-ink-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-ink-muted">No timetable entries found</p>
            <p className="text-ink-subtle text-sm mt-1">
              {isSchoolAdmin ? 'Try another department or class, or ask your HOD to set up timetables.' : 'Your HOD has not set up the timetable yet.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {DAYS.slice(0, 5).map((day, idx) => (
              <div
                key={day}
                className={`surface-card p-4 transition-all ${
                  idx === todayIndex ? 'timetable-day--today' : ''
                }`}
              >
                <h4 className={`font-semibold text-sm mb-3 pb-2 border-b border-line flex items-center gap-2 ${
                  idx === todayIndex ? 'text-brand' : 'text-ink'
                }`}>
                  {day}
                  {idx === todayIndex && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-brand">Today</span>
                  )}
                </h4>
                <div className="space-y-2">
                  {getEntriesForDay(idx).length === 0 ? (
                    <p className="text-ink-subtle text-xs py-2">No classes</p>
                  ) : (
                    getEntriesForDay(idx).map((entry) => (
                      <div
                        key={entry.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedEntryId(entry.id === selectedEntryId ? null : entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedEntryId(entry.id === selectedEntryId ? null : entry.id);
                          }
                        }}
                        className={`timetable-slot ${
                          selectedEntryId === entry.id ? 'timetable-slot--selected' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-ink">{entry.subject}</p>
                        <p className="text-brand text-xs mt-1 font-mono">{entry.startTime} - {entry.endTime}</p>
                        {entry.class?.name && <p className="text-ink-muted text-xs mt-0.5">{entry.class.name}</p>}
                        {entry.teacher?.fullName && <p className="text-ink-subtle text-xs">{entry.teacher.fullName}</p>}
                        {entry.room && <p className="text-ink-subtle text-xs">📍 {entry.room}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface-card border-line rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line bg-surface-muted">
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Day</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Subject</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Class</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Teacher</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Time</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Room</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                    .map((entry) => (
                      <tr
                        key={entry.id}
                        className={`border-b border-line hover:bg-surface-muted transition-colors ${
                          entry.dayOfWeek === todayIndex ? 'timetable-row--today' : ''
                        }`}
                      >
                        <td className="px-6 py-4 text-sm text-ink">
                          {DAYS[entry.dayOfWeek]}
                          {entry.dayOfWeek === todayIndex && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-brand">Today</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-ink font-medium">{entry.subject}</td>
                        <td className="px-6 py-4 text-sm text-ink-muted">{entry.class?.name || '—'}</td>
                        <td className="px-6 py-4 text-sm text-ink-muted">{entry.teacher?.fullName || '—'}</td>
                        <td className="px-6 py-4 text-sm text-ink-muted font-mono">{entry.startTime} - {entry.endTime}</td>
                        <td className="px-6 py-4 text-sm text-ink-muted">{entry.room || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-ink-subtle">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default TimetableViewPage;
