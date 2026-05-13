import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../services/apiClient';

interface Department {
  id: string;
  name: string;
  createdAt: string;
  classes?: ClassItem[];
}

interface ClassItem {
  id: string;
  name: string;
  capacity: number;
  departmentId: string;
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

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const { data } = await apiClient.get('/departments');
      const depts = data.departments || data || [];
      // Fetch classes for each department
      const deptsWithClasses = await Promise.all(
        depts.map(async (dept: Department) => {
          try {
            const classRes = await apiClient.get(`/departments/${dept.id}/classes`);
            return { ...dept, classes: classRes.data.classes || classRes.data || [] };
          } catch {
            return { ...dept, classes: [] };
          }
        })
      );
      setDepartments(deptsWithClasses);
    } catch (err) {
      // Fallback: try fetching from a combined endpoint
      try {
        const { data } = await apiClient.get('/classes');
        const classes = data.classes || data || [];
        // Group by department
        const deptMap: Record<string, Department> = {};
        classes.forEach((c: any) => {
          if (!deptMap[c.departmentId]) {
            deptMap[c.departmentId] = {
              id: c.departmentId,
              name: c.department?.name || c.departmentId,
              createdAt: '',
              classes: [],
            };
          }
          deptMap[c.departmentId].classes!.push(c);
        });
        setDepartments(Object.values(deptMap));
      } catch {
        console.error('Failed to fetch departments');
      }
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-gray-400 hover:text-cyan-400 transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-white">Departments & Classes</h1>
          </div>
          <button
            onClick={openAddDeptModal}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            + Add Department
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading departments...</div>
        ) : departments.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="mb-4">No departments found</p>
            <button
              onClick={openAddDeptModal}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold"
            >
              Create your first department
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {departments.map((dept) => (
              <div key={dept.id} className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                {/* Department Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                  <button
                    onClick={() => toggleExpand(dept.id)}
                    className="flex items-center gap-3 text-left"
                  >
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedDepts.has(dept.id) ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div>
                      <h3 className="text-white font-semibold">{dept.name}</h3>
                      <p className="text-xs text-gray-400">{dept.classes?.length || 0} classes</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openAddClassModal(dept.id)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-cyan-400 text-xs hover:bg-white/10 transition-colors"
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
                    {(!dept.classes || dept.classes.length === 0) ? (
                      <p className="text-gray-500 text-sm py-3">No classes in this department</p>
                    ) : (
                      <div className="space-y-2">
                        {dept.classes.map((cls) => (
                          <div key={cls.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/5 border border-white/5">
                            <div>
                              <p className="text-white text-sm font-medium">{cls.name}</p>
                              <p className="text-gray-500 text-xs">Capacity: {cls.capacity}</p>
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
          <div className="backdrop-blur-xl bg-slate-800/90 border border-white/10 rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">
              {editingDept ? 'Edit Department' : 'Add Department'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleDeptSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Department Name *</label>
                <input
                  type="text"
                  required
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="e.g. Science Department"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDeptModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
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
          <div className="backdrop-blur-xl bg-slate-800/90 border border-white/10 rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">
              {editingClass ? 'Edit Class' : 'Add Class'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleClassSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Class Name *</label>
                <input
                  type="text"
                  required
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="e.g. Form 1A"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Capacity</label>
                <input
                  type="number"
                  min={1}
                  value={classCapacity}
                  onChange={(e) => setClassCapacity(parseInt(e.target.value) || 50)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowClassModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingClass ? 'Update' : 'Create'}
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

export default DepartmentsPage;
