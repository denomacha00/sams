import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../services/apiClient';

interface Department {
  id: string;
  name: string;
  createdAt: string;
  hodId?: string | null;
  hodName?: string | null;
  classes?: ClassItem[];
  teachers?: TeacherItem[];
}

interface ClassItem {
  id: string;
  name: string;
  capacity: number;
  departmentId: string;
  classTeacherId: string | null;
  classTeacherName: string | null;
}

interface TeacherItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

const DepartmentsPage: React.FC = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editingClass, setEditingClass] = useState<ClassItem | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [deptName, setDeptName] = useState('');
  const [className, setClassName] = useState('');
  const [classCapacity, setClassCapacity] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  // HOD assignment state
  const [showHodModal, setShowHodModal] = useState(false);
  const [hodDept, setHodDept] = useState<Department | null>(null);
  const [hodUsers, setHodUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [selectedHodId, setSelectedHodId] = useState('');
  const [hodSubmitting, setHodSubmitting] = useState(false);
  const [hodError, setHodError] = useState('');

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const { data } = await apiClient.get('/departments');
      const depts: Department[] = data.departments || data || [];

      // Fetch enriched classes (includes classTeacherName) and teachers for each dept in parallel
      const deptsWithData = await Promise.all(
        depts.map(async (dept) => {
          const [classRes, teacherRes] = await Promise.allSettled([
            apiClient.get(`/departments/${dept.id}/classes`),
            apiClient.get(`/departments/${dept.id}/teachers`),
          ]);

          // Classes: use enriched GET /classes filtered by dept if dept classes don't have classTeacherName
          let classes: ClassItem[] = [];
          if (classRes.status === 'fulfilled') {
            const raw = classRes.value.data.classes || classRes.value.data || [];
            // If classTeacherName is missing, fetch from enriched /classes endpoint
            if (raw.length > 0 && raw[0].classTeacherName === undefined) {
              try {
                const enrichedRes = await apiClient.get('/classes');
                const allClasses: ClassItem[] = enrichedRes.data.classes || enrichedRes.data || [];
                classes = allClasses.filter((c) => c.departmentId === dept.id);
              } catch {
                classes = raw;
              }
            } else {
              classes = raw;
            }
          }

          const teachers: TeacherItem[] = teacherRes.status === 'fulfilled'
            ? (teacherRes.value.data || [])
            : [];

          return { ...dept, classes, teachers };
        })
      );

      setDepartments(deptsWithData);
    } catch (err) {
      console.error('Failed to fetch departments', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (deptId: string) => {
    const next = new Set(expandedDepts);
    if (next.has(deptId)) next.delete(deptId);
    else next.add(deptId);
    setExpandedDepts(next);
  };

  const openAddDeptModal = () => {
    setEditingDept(null);
    setDeptName('');
    setError('');
    setShowDeptModal(true);
  };

  const openEditDeptModal = (dept: Department) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setError('');
    setShowDeptModal(true);
  };

  const openAddClassModal = (deptId: string) => {
    setEditingClass(null);
    setSelectedDeptId(deptId);
    setClassName('');
    setClassCapacity(50);
    setError('');
    setShowClassModal(true);
  };

  const openEditClassModal = (cls: ClassItem) => {
    setEditingClass(cls);
    setSelectedDeptId(cls.departmentId);
    setClassName(cls.name);
    setClassCapacity(cls.capacity);
    setError('');
    setShowClassModal(true);
  };

  const handleDeptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (editingDept) {
        await apiClient.put(`/departments/${editingDept.id}`, { name: deptName });
      } else {
        await apiClient.post('/departments', { name: deptName });
      }
      setShowDeptModal(false);
      fetchDepartments();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        name: className,
        capacity: classCapacity,
        departmentId: selectedDeptId,
      };

      if (editingClass) {
        await apiClient.put(`/classes/${editingClass.id}`, payload);
      } else {
        await apiClient.post('/classes', payload);
      }
      setShowClassModal(false);
      fetchDepartments();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDept = async (deptId: string) => {
    if (!confirm('Are you sure you want to delete this department? All classes under it will also be removed.')) return;
    try {
      await apiClient.delete(`/departments/${deptId}`);
      fetchDepartments();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleDeleteClass = async (classId: string) => {
    if (!confirm('Are you sure you want to delete this class?')) return;
    try {
      await apiClient.delete(`/classes/${classId}`);
      fetchDepartments();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const openHodModal = async (dept: Department) => {
    setHodDept(dept);
    setSelectedHodId(dept.hodId || '');
    setHodError('');
    // Fetch HOD-eligible users (teachers in this department + existing HODs)
    try {
      const { data } = await apiClient.get('/users', { params: { role: 'HOD' } });
      const allHods = data.users || data || [];
      // Also get teachers in this department
      const { data: teacherData } = await apiClient.get(`/departments/${dept.id}/teachers`);
      const teachers = teacherData || [];
      // Combine: existing HODs + teachers in this dept (who could be promoted)
      const combined = [...allHods, ...teachers.filter((t: any) => !allHods.find((h: any) => h.id === t.id))];
      setHodUsers(combined.map((u: any) => ({ id: u.id, fullName: u.fullName })));
    } catch {
      setHodUsers([]);
    }
    setShowHodModal(true);
  };

  const handleHodAssign = async () => {
    if (!hodDept) return;
    setHodSubmitting(true);
    setHodError('');
    try {
      // Update the selected user's departmentId and role to HOD
      if (selectedHodId) {
        await apiClient.put(`/users/${selectedHodId}`, {
          departmentId: hodDept.id,
          role: 'HOD',
        });
      }
      setShowHodModal(false);
      fetchDepartments();
    } catch (err: any) {
      setHodError(err.response?.data?.error || 'Failed to assign HOD');
    } finally {
      setHodSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-ink-muted hover:text-brand transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-ink">Departments & Classes</h1>
          </div>
          <button
            onClick={openAddDeptModal}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-sm font-semibold hover:from-indigo-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            + Add Department
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center text-ink-muted py-12">Loading departments...</div>
        ) : departments.length === 0 ? (
          <div className="text-center text-ink-muted py-12">
            <p className="mb-4">No departments found</p>
            <button
              onClick={openAddDeptModal}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white text-sm font-semibold"
            >
              Create your first department
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {departments.map((dept) => (
              <div key={dept.id} className="surface-card rounded-2xl overflow-hidden">
                {/* Department Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                  <button
                    onClick={() => toggleExpand(dept.id)}
                    className="flex items-center gap-3 text-left"
                  >
                    <svg
                      className={`w-4 h-4 text-ink-muted transition-transform ${expandedDepts.has(dept.id) ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div>
                      <h3 className="text-white font-semibold">{dept.name}</h3>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="text-xs text-ink-muted">{dept.classes?.length || 0} classes · {dept.teachers?.length || 0} teachers</p>
                        {dept.hodName ? (
                          <span className="text-xs text-orange-300 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
                            HOD: {dept.hodName}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-subtle italic">No HOD assigned</span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openHodModal(dept)}
                      className="px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 text-xs hover:bg-orange-500/20 transition-colors"
                    >
                      {dept.hodName ? 'Change HOD' : 'Assign HOD'}
                    </button>
                    <button
                      onClick={() => openAddClassModal(dept.id)}
                      className="px-3 py-1.5 rounded-lg bg-surface-muted border border-line text-cyan-400 text-xs hover:bg-white/10 transition-colors"
                    >
                      + Add Class
                    </button>
                    <button
                      onClick={() => openEditDeptModal(dept)}
                      className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteDept(dept.id)}
                      className="text-red-400 hover:text-red-300 text-sm transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Classes List */}
                {expandedDepts.has(dept.id) && (
                  <div className="px-6 py-3">
                    {/* Teachers in this department */}
                    {dept.teachers && dept.teachers.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Teachers ({dept.teachers.length})</h4>
                        <div className="flex flex-wrap gap-2">
                          {dept.teachers.map((teacher) => (
                            <div key={teacher.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                              <div className="w-5 h-5 rounded-full bg-indigo-500/30 flex items-center justify-center">
                                <span className="text-xs font-semibold text-brand">{teacher.fullName.charAt(0)}</span>
                              </div>
                              <span className="text-xs text-indigo-200">{teacher.fullName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Classes */}
                    <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Classes ({dept.classes?.length || 0})</h4>
                    {(!dept.classes || dept.classes.length === 0) ? (
                      <p className="text-ink-subtle text-sm py-3">No classes in this department</p>
                    ) : (
                      <div className="space-y-2">
                        {dept.classes.map((cls) => (
                          <div key={cls.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/5 border border-white/5">
                            <div>
                              <p className="text-white text-sm font-medium">{cls.name}</p>
                              <p className="text-ink-subtle text-xs">Capacity: {cls.capacity}</p>
                              <p className="text-xs mt-0.5">
                                {cls.classTeacherName ? (
                                  <span className="text-indigo-400">Class Teacher: {cls.classTeacherName}</span>
                                ) : (
                                  <span className="text-ink-muted italic">No class teacher assigned</span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => openEditClassModal(cls)}
                                className="text-cyan-400 hover:text-cyan-300 text-xs transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteClass(cls.id)}
                                className="text-red-400 hover:text-red-300 text-xs transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Department Modal */}
      {showDeptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl surface-card border-line rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-ink mb-6">
              {editingDept ? 'Edit Department' : 'Add Department'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleDeptSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Department Name *</label>
                <input
                  type="text"
                  required
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="e.g. Science Department"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDeptModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-semibold hover:from-indigo-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingDept ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Class Modal */}
      {showClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl surface-card border-line rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-ink mb-6">
              {editingClass ? 'Edit Class' : 'Add Class'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleClassSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Class Name *</label>
                <input
                  type="text"
                  required
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="e.g. Form 1A"
                />
              </div>

              <div>
                <label className="block text-sm text-ink-muted mb-1">Capacity</label>
                <input
                  type="number"
                  min={1}
                  value={classCapacity}
                  onChange={(e) => setClassCapacity(parseInt(e.target.value) || 50)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowClassModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white font-semibold hover:from-indigo-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingClass ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HOD Assignment Modal */}
      {showHodModal && hodDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl surface-card border-line rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-ink mb-2">
              {hodDept.hodName ? 'Change HOD' : 'Assign HOD'}
            </h3>
            <p className="text-sm text-ink-muted mb-6">
              Department: <span className="text-white font-medium">{hodDept.name}</span>
              {hodDept.hodName && <span className="text-orange-300 ml-2">(Current: {hodDept.hodName})</span>}
            </p>

            {hodError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {hodError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Select HOD *</label>
                <select
                  value={selectedHodId}
                  onChange={(e) => setSelectedHodId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                >
                  <option value="" className="bg-slate-800">-- Select a user --</option>
                  {hodUsers.map(u => (
                    <option key={u.id} value={u.id} className="bg-slate-800">{u.fullName}</option>
                  ))}
                </select>
                <p className="text-xs text-ink-subtle mt-1">Shows existing HODs and teachers in this department</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowHodModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleHodAssign}
                  disabled={hodSubmitting || !selectedHodId}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold hover:from-orange-400 hover:to-amber-400 transition-all disabled:opacity-50"
                >
                  {hodSubmitting ? 'Assigning...' : 'Assign HOD'}
                </button>
              </div>
            </div>
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

export default DepartmentsPage;
