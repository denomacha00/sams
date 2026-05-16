import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../services/apiClient';

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

interface EntryFormData {
  classId: string;
  teacherId: string;
  subject: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string;
}

const emptyForm: EntryFormData = {
  classId: '',
  teacherId: '',
  subject: '',
  dayOfWeek: 0,
  startTime: '08:00',
  endTime: '09:00',
  room: '',
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TimetablePage: React.FC = () => {
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
  const [departments, setDepartments] = useState<{id: string; name: string; classes?: {id: string; name: string}[]}[]>([]);
  const [teachers, setTeachers] = useState<{id: string; fullName: string}[]>([]);

  useEffect(() => {
    fetchEntries();
    fetchDepartments();
    fetchTeachers();
  }, []);

  const fetchDepartments = async () => {
    try {
      const { data } = await apiClient.get('/departments');
      setDepartments(Array.isArray(data) ? data : (data.departments || []));
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  const fetchTeachers = async () => {
    try {
      const { data } = await apiClient.get('/users?role=TEACHER');
      const users = data.users || data || [];
      setTeachers(users);
    } catch (err) {
      console.error('Failed to fetch teachers:', err);
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
    setFormData(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEditModal = (entry: TimetableEntry) => {
    setEditingEntry(entry);
    setFormData({
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
      setError(err.response?.data?.error || err.response?.data?.message || 'Operation failed');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-gray-400 hover:text-cyan-400 transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-white">Timetable Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode(viewMode === 'table' ? 'grid' : 'table')}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10 transition-colors"
            >
              {viewMode === 'table' ? '📅 Grid View' : '📋 Table View'}
            </button>
            <button
              onClick={openAddModal}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
            >
              + Add Entry
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <input
            type="text"
            placeholder="Filter by class..."
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
          />
          <input
            type="text"
            placeholder="Filter by teacher..."
            value={filterTeacher}
            onChange={(e) => setFilterTeacher(e.target.value)}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
          />
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading timetable...</div>
        ) : viewMode === 'table' ? (
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
                    <th className="text-right px-6 py-4 text-sm font-semibold text-white">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-400">No timetable entries</td>
                    </tr>
                  ) : (
                    filteredEntries
                      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
                      .map((entry) => (
                        <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 text-sm text-white">{DAYS[entry.dayOfWeek]}</td>
                          <td className="px-6 py-4 text-sm text-white font-medium">{entry.subject}</td>
                          <td className="px-6 py-4 text-sm text-gray-300">{entry.class?.name || entry.classId}</td>
                          <td className="px-6 py-4 text-sm text-gray-300">{entry.teacher?.fullName || entry.teacherId}</td>
                          <td className="px-6 py-4 text-sm text-gray-400">{entry.startTime} - {entry.endTime}</td>
                          <td className="px-6 py-4 text-sm text-gray-400">{entry.room || '—'}</td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => openEditModal(entry)}
                              className="text-cyan-400 hover:text-cyan-300 text-sm mr-3 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="text-red-400 hover:text-red-300 text-sm transition-colors"
                            >
                              Delete
                            </button>
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
              <div key={day} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4">
                <h4 className="text-white font-semibold text-sm mb-3 pb-2 border-b border-white/10">{day}</h4>
                <div className="space-y-2">
                  {getEntriesForDay(idx).length === 0 ? (
                    <p className="text-gray-500 text-xs">No classes</p>
                  ) : (
                    getEntriesForDay(idx)
                      .sort((a, b) => a.startTime.localeCompare(b.startTime))
                      .map((entry) => (
                        <div key={entry.id} className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-cyan-500/30 transition-colors">
                          <p className="text-white text-sm font-medium">{entry.subject}</p>
                          <p className="text-gray-400 text-xs mt-1">{entry.startTime} - {entry.endTime}</p>
                          <p className="text-gray-500 text-xs">{entry.class?.name || entry.classId}</p>
                          {entry.room && <p className="text-gray-500 text-xs">Room: {entry.room}</p>}
                        </div>
                      ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl bg-slate-800/90 border border-white/10 rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">
              {editingEntry ? 'Edit Timetable Entry' : 'Add Timetable Entry'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Subject *</label>
                <input
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="Mathematics"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Class *</label>
                  <select
                    required
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  >
                    <option value="" className="bg-slate-800">-- Select Class --</option>
                    {departments.map(dept => (
                      <optgroup key={dept.id} label={dept.name} className="bg-slate-800">
                        {(dept.classes || []).map(cls => (
                          <option key={cls.id} value={cls.id} className="bg-slate-800">{cls.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Teacher *</label>
                  <select
                    required
                    value={formData.teacherId}
                    onChange={(e) => setFormData({ ...formData, teacherId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  >
                    <option value="" className="bg-slate-800">-- Select Teacher --</option>
                    {teachers.map(t => (
                      <option key={t.id} value={t.id} className="bg-slate-800">{t.fullName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Day of Week *</label>
                <select
                  value={formData.dayOfWeek}
                  onChange={(e) => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                >
                  {DAYS.map((day, idx) => (
                    <option key={day} value={idx} className="bg-slate-800">{day}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Start Time *</label>
                  <input
                    type="time"
                    required
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">End Time *</label>
                  <input
                    type="time"
                    required
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Room</label>
                <input
                  type="text"
                  value={formData.room}
                  onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="Room 101"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingEntry ? 'Update Entry' : 'Add Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-500">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default TimetablePage;
