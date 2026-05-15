import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';

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
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TimetableViewPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid');

  useEffect(() => {
    const fetchEntries = async () => {
      try {
        const { data } = await apiClient.get('/timetable');
        const list = Array.isArray(data) ? data : (data.entries || []);
        setEntries(list);
      } catch (err) {
        console.error('Failed to fetch timetable:', err);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };
    fetchEntries();
  }, []);

  const getEntriesForDay = (day: number) =>
    entries.filter((e) => e.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));

  const todayIndex = (new Date().getDay() + 6) % 7; // Convert JS Sunday=0 to Monday=0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-gray-400 hover:text-cyan-400 transition-colors">
              ← Dashboard
            </Link>
            <h1 className="text-lg font-bold text-white">My Timetable</h1>
          </div>
          <button
            onClick={() => setViewMode(viewMode === 'table' ? 'grid' : 'table')}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10 transition-colors"
          >
            {viewMode === 'table' ? '📅 Grid View' : '📋 Table View'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center text-gray-400 py-12">
            <div className="flex items-center justify-center gap-3">
              <svg className="animate-spin h-5 w-5 text-teal-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading timetable...
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 border border-white/10 mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-400">No timetable entries found</p>
            <p className="text-gray-500 text-sm mt-1">Your school admin hasn't set up the timetable yet.</p>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {DAYS.slice(0, 5).map((day, idx) => (
              <div
                key={day}
                className={`backdrop-blur-xl bg-white/5 border rounded-2xl p-4 transition-all ${
                  idx === todayIndex ? 'border-teal-500/40 ring-1 ring-teal-500/20' : 'border-white/10'
                }`}
              >
                <h4 className={`font-semibold text-sm mb-3 pb-2 border-b border-white/10 flex items-center gap-2 ${
                  idx === todayIndex ? 'text-teal-400' : 'text-white'
                }`}>
                  {day}
                  {idx === todayIndex && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300">Today</span>
                  )}
                </h4>
                <div className="space-y-2">
                  {getEntriesForDay(idx).length === 0 ? (
                    <p className="text-gray-500 text-xs py-2">No classes</p>
                  ) : (
                    getEntriesForDay(idx).map((entry) => (
                      <div key={entry.id} className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-teal-500/30 transition-colors">
                        <p className="text-white text-sm font-medium">{entry.subject}</p>
                        <p className="text-teal-400 text-xs mt-1 font-mono">{entry.startTime} - {entry.endTime}</p>
                        {entry.class?.name && <p className="text-gray-400 text-xs mt-0.5">{entry.class.name}</p>}
                        {entry.teacher?.fullName && <p className="text-gray-500 text-xs">{entry.teacher.fullName}</p>}
                        {entry.room && <p className="text-gray-500 text-xs">📍 {entry.room}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Table View */
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-4 text-sm font-semibold text-white">Day</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-white">Subject</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-white">Class</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-white">Teacher</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-white">Time</th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-white">Room</th>
                  </tr>
                </thead>
                <tbody>
                  {entries
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                    .map((entry) => (
                      <tr
                        key={entry.id}
                        className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                          entry.dayOfWeek === todayIndex ? 'bg-teal-500/5' : ''
                        }`}
                      >
                        <td className="px-6 py-4 text-sm text-white">
                          {DAYS[entry.dayOfWeek]}
                          {entry.dayOfWeek === todayIndex && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300">Today</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-white font-medium">{entry.subject}</td>
                        <td className="px-6 py-4 text-sm text-gray-300">{entry.class?.name || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-300">{entry.teacher?.fullName || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-400 font-mono">{entry.startTime} - {entry.endTime}</td>
                        <td className="px-6 py-4 text-sm text-gray-400">{entry.room || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-500">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default TimetableViewPage;
