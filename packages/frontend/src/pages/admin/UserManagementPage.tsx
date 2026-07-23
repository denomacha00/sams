import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '@sams/shared';
import apiClient from '../../services/apiClient';
import { UserAvatar } from '../../components/UserAvatar';

interface User {
  id: string;
  fullName: string;
  username?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string | null;
  role: string;
  admissionNumber?: string;
  departmentId?: string;
  classId?: string;
  isLocked: boolean;
  isClassRep?: boolean;
  attendanceGpsExempt?: boolean;
  createdAt: string;
}

interface Department {
  id: string;
  name: string;
  hodId?: string | null;
  hodName?: string | null;
  classes?: { id: string; name: string }[];
}

interface UserFormData {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: string;
  admissionNumber: string;
  password: string;
  departmentId: string;
  classId: string;
  subjects: string;
  attendanceGpsExempt: boolean;
}

const emptyForm: UserFormData = {
  fullName: '',
  username: '',
  email: '',
  phone: '',
  role: 'STUDENT',
  admissionNumber: '',
  password: '',
  departmentId: '',
  classId: '',
  subjects: '',
  attendanceGpsExempt: false,
};

const UserManagementPage: React.FC = () => {
  const currentUser = useAuthStore((s) => s.user);
  const isHOD = currentUser?.role === UserRole.HOD;

  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [hodWarning, setHodWarning] = useState<string | null>(null);

  // Derived: existing HOD for selected department
  const existingHodForDept = departments.find(d => d.id === formData.departmentId)?.hodName ?? null;
  const existingHodIdForDept = departments.find(d => d.id === formData.departmentId)?.hodId ?? null;

  // Validation: check if role requires dept/class
  const getRoleRequirements = (role: string) => {
    switch (role) {
      case 'HOD': return { needsDept: true, needsClass: false };
      case 'TEACHER': return { needsDept: true, needsClass: false }; // teacher can teach multiple classes
      case 'STUDENT': return { needsDept: true, needsClass: true };
      default: return { needsDept: false, needsClass: false };
    }
  };
  const { needsDept, needsClass } = getRoleRequirements(formData.role);
  const canAssignSubjects = formData.role === 'TEACHER' || formData.role === 'HOD';

  const parseSubjects = (value: string) =>
    Array.from(new Set(
      value
        .split(',')
        .map((subject) => subject.trim())
        .filter(Boolean),
    ));

  useEffect(() => {
    fetchUsers();
    fetchDepartments();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data } = await apiClient.get('/users');
      setUsers(data.users || data || []);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const { data } = await apiClient.get('/departments');
      const depts: Department[] = Array.isArray(data) ? data : (data.departments || []);
      // Fetch classes for each department
      const deptsWithClasses = await Promise.all(
        depts.map(async (d) => {
          try {
            const { data: classData } = await apiClient.get(`/departments/${d.id}/classes`);
            return { ...d, classes: Array.isArray(classData) ? classData : [] };
          } catch {
            return { ...d, classes: [] };
          }
        })
      );
      setDepartments(deptsWithClasses);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  // When dept changes and role is HOD, check for existing HOD
  const handleDeptChange = (deptId: string) => {
    setFormData({ ...formData, departmentId: deptId, classId: '' });
    if (formData.role === 'HOD' && deptId) {
      const dept = departments.find(d => d.id === deptId);
      if (dept?.hodId && dept.hodId !== editingUser?.id) {
        setHodWarning(`${dept.hodName || 'Someone'} is already HOD of this department. Saving will replace them.`);
      } else {
        setHodWarning(null);
      }
    } else {
      setHodWarning(null);
    }
  };

  const classesForDept = departments.find(d => d.id === formData.departmentId)?.classes || [];

  const filteredUsers = users.filter((u) => {
    const matchesTab = activeTab === 'ALL' || u.role === activeTab;
    if (!searchQuery.trim()) return matchesTab;
    const q = searchQuery.toLowerCase();
    return matchesTab && (
      u.fullName.toLowerCase().includes(q) ||
      (u.username?.toLowerCase().includes(q)) ||
      (u.admissionNumber?.toLowerCase().includes(q)) ||
      (u.email?.toLowerCase().includes(q)) ||
      (u.phone?.includes(q))
    );
  });

  const openAddModal = () => {
    setEditingUser(null);
    setFormData(emptyForm);
    setError('');
    setHodWarning(null);
    setShowModal(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      fullName: user.fullName,
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role,
      admissionNumber: user.admissionNumber || '',
      password: '',
      departmentId: user.departmentId || '',
      classId: user.classId || '',
      subjects: '',
      attendanceGpsExempt: user.attendanceGpsExempt ?? false,
    });
    setError('');
    setHodWarning(null);
    setShowModal(true);
    if (user.role === 'TEACHER' || user.role === 'HOD') {
      void apiClient.get(`/teacher-subjects/${user.id}`)
        .then(({ data }) => {
          setFormData((current) => ({
            ...current,
            subjects: Array.isArray(data.subjects) ? data.subjects.join(', ') : '',
          }));
        })
        .catch(() => {});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    // Validate dept/class requirements
    if (needsDept && !formData.departmentId) {
      setError(`A department is required for ${formData.role} role. Please create a department first.`);
      setSubmitting(false);
      return;
    }
    if (needsClass && !formData.classId) {
      setError(`A class is required for ${formData.role} role. Please select a class.`);
      setSubmitting(false);
      return;
    }

    try {
      const payload: any = {
        fullName: formData.fullName,
        username: formData.username.trim(),
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        role: formData.role,
        admissionNumber: formData.role === 'STUDENT' ? formData.admissionNumber : undefined,
        departmentId: formData.departmentId || undefined,
        classId: formData.classId || undefined,
      };

      if (editingUser) {
        if (formData.password) payload.password = formData.password;
        if (editingUser.role === 'STUDENT') {
          payload.attendanceGpsExempt = formData.attendanceGpsExempt;
        }
        await apiClient.put(`/users/${editingUser.id}`, payload);
        if (editingUser.role === 'TEACHER' || editingUser.role === 'HOD') {
          await apiClient.put(`/teacher-subjects/${editingUser.id}`, {
            subjects: parseSubjects(formData.subjects),
          });
        }
      } else {
        payload.password = formData.password;
        if (formData.role === 'TEACHER' || formData.role === 'HOD') {
          payload.subjects = formData.subjects;
        }
        await apiClient.post('/users', payload);
      }

      setShowModal(false);
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await apiClient.delete(`/users/${userId}`);
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  // HOD can only manage TEACHER and STUDENT roles in their department
  const tabs = isHOD ? ['ALL', 'TEACHER', 'STUDENT'] : ['ALL', 'HOD', 'TEACHER', 'STUDENT'];

  return (
    <div className="page-shell">
      {/* Header */}
      <header className="inner-page-header">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-ink-muted hover:text-brand transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-ink">
              {isHOD ? 'Department User Management' : 'User Management'}
            </h1>
          </div>
          <button
            onClick={openAddModal}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-700 text-white text-sm font-semibold hover:from-indigo-400 hover:to-indigo-500 transition-all shadow-lg shadow-indigo-500/20"
          >
            + Add User
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <p className="text-sm text-ink-muted mb-6 max-w-3xl">
          {isHOD
            ? 'For new department students, share a class registration link first. '
            : 'Most people join via registration links. '}
          <Link to="/admin/links" className="text-brand hover:text-brand-hover font-medium">
            Open Registration Links
          </Link>
          {' '}and use manual add only when someone cannot use link signup.
        </p>
        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-white/5 text-ink-muted hover:bg-white/10 hover:text-ink border border-white/10'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab === 'HOD' ? 'HODs' : tab === 'TEACHER' ? 'Teachers' : 'Students'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, admission number, email or phone..."
              className="w-full pl-11 pr-4 py-3 bg-surface-muted border border-line rounded-xl text-ink placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand/40/40 focus:border-brand transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                ✕
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-ink-muted mt-1">{filteredUsers.length} result{filteredUsers.length !== 1 ? 's' : ''} found</p>
          )}
        </div>

        {/* Table */}
        <div className="surface-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Username</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Role</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Adm No.</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Dept / Class</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-ink">Status</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-ink">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-ink-muted">Loading...</td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-ink-muted">
                      {searchQuery ? `No users found matching "${searchQuery}"` : 'No users found'}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 text-sm text-white">
                        <div className="flex items-center gap-3 min-w-[14rem]">
                          <UserAvatar
                            avatarUrl={u.avatarUrl}
                            fullName={u.fullName}
                            previewable
                            className="h-10 w-10 rounded-full"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{u.fullName}</p>
                            <p className="truncate text-xs text-ink-muted">
                              {u.phone || u.email || u.admissionNumber || 'No contact saved'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-indigo-300">{u.username || '—'}</td>
                      <td className="px-6 py-4 text-sm text-ink-muted">{u.email || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            u.role === 'HOD' ? 'bg-orange-500/20 text-orange-300' :
                            u.role === 'TEACHER' ? 'bg-indigo-500/20 text-indigo-300' :
                            u.role === 'STUDENT' ? 'bg-indigo-500/20 text-indigo-300' :
                            'bg-indigo-500/20 text-indigo-300'
                          }`}>
                            {u.role}
                          </span>
                          {u.role === 'TEACHER' && u.classId && (
                            <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300">
                              Class Teacher
                            </span>
                          )}
                          {u.role === 'STUDENT' && u.isClassRep && (
                            <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400">
                              Class Rep
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-ink-muted">{u.admissionNumber || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5">
                          {u.departmentId && (
                            <span className="text-xs text-ink-muted">
                              {departments.find(d => d.id === u.departmentId)?.name || u.departmentId}
                            </span>
                          )}
                          {u.classId && (
                            <span className="text-xs text-indigo-400">
                              {departments.flatMap(d => d.classes || []).find(c => c.id === u.classId)?.name || u.classId}
                            </span>
                          )}
                          {!u.departmentId && !u.classId && <span className="text-xs text-ink-muted">—</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          u.isLocked ? 'bg-red-500/20 text-red-300' : 'bg-indigo-500/20 text-indigo-300'
                        }`}>
                          {u.isLocked ? 'Locked' : 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openEditModal(u)}
                          className="text-indigo-400 hover:text-indigo-300 text-sm mr-3 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(u.id)}
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
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl surface-card border-line rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-ink mb-6">
              {editingUser ? 'Edit User' : 'Add New User'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-ink-muted mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm text-ink-muted mb-1">Username *</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={50}
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value.replace(/\s/g, '') })}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                  placeholder="e.g. hod_john"
                />
                <p className="text-xs text-ink-subtle mt-1">Used to sign in — letters, numbers, dots, underscores, hyphens.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-ink-muted mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                    placeholder="john@school.com"
                  />
                </div>
                <div>
                  <label className="block text-sm text-ink-muted mb-1">Phone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                    placeholder="+254..."
                  />
                </div>
              </div>

              {editingUser?.role === 'STUDENT' && (
                <label className="flex items-start gap-3 p-3 rounded-xl bg-surface-muted border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.attendanceGpsExempt}
                    onChange={(e) =>
                      setFormData({ ...formData, attendanceGpsExempt: e.target.checked })
                    }
                    className="mt-1 rounded border-white/20"
                  />
                  <span>
                    <span className="text-sm text-ink font-medium">GPS attendance permission</span>
                    <span className="block text-xs text-ink-muted mt-0.5">
                      Allow sign-in outside the session radius (medical leave, approved absence on campus, etc.)
                    </span>
                  </span>
                </label>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-ink-muted mb-1">Role *</label>
                  <select
                    value={formData.role}
                    onChange={(e) => {
                      setFormData({ ...formData, role: e.target.value, departmentId: '', classId: '', subjects: '' });
                      setHodWarning(null);
                    }}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                  >
                    <option value="STUDENT" className="bg-slate-800">Student</option>
                    <option value="TEACHER" className="bg-slate-800">Teacher</option>
                    {/* HOD users cannot create other HODs — only SCHOOL_ADMIN can */}
                    {!isHOD && <option value="HOD" className="bg-slate-800">HOD</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-ink-muted mb-1">
                    {formData.role === 'STUDENT' ? 'Admission Number' : 'Staff ID'}
                  </label>
                  <input
                    type="text"
                    value={formData.admissionNumber}
                    onChange={(e) => setFormData({ ...formData, admissionNumber: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                    placeholder={formData.role === 'STUDENT' ? 'ADM001' : 'Optional'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-ink-muted mb-1">
                    Department {needsDept ? '*' : ''}
                  </label>
                  {departments.length === 0 ? (
                    <div className="w-full px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                      No departments yet — create one first
                    </div>
                  ) : (
                    <select
                      value={formData.departmentId}
                      onChange={(e) => handleDeptChange(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
                    >
                      <option value="" className="bg-slate-800">-- Select Department --</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id} className="bg-slate-800">
                          {d.name}{d.hodName && formData.role === 'HOD' ? ` (HOD: ${d.hodName})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {hodWarning && (
                    <p className="text-xs text-orange-400 mt-1">⚠ {hodWarning}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-ink-muted mb-1">
                    Class {needsClass ? '*' : formData.role === 'TEACHER' ? '(optional — teacher can teach multiple)' : ''}
                  </label>
                  {formData.role === 'TEACHER' && (
                    <p className="text-xs text-indigo-400 mb-1">
                      Setting a class here makes this teacher the <strong>Class Teacher</strong> for that class.
                    </p>
                  )}
                  <select
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    disabled={!formData.departmentId || formData.role === 'HOD'}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-white focus:outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-50"
                  >
                    <option value="" className="bg-slate-800">
                      {formData.role === 'HOD' ? '-- N/A for HOD --' : '-- Select Class --'}
                    </option>
                    {classesForDept.map(c => (
                      <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>
                    ))}
                  </select>
                  {needsClass && formData.departmentId && classesForDept.length === 0 && (
                    <p className="text-xs text-orange-400 mt-1">No classes in this department yet</p>
                  )}
                </div>
              </div>

              {canAssignSubjects && (
                <div>
                  <label className="block text-sm text-ink-muted mb-1">Skilled units</label>
                  <textarea
                    value={formData.subjects}
                    onChange={(e) => setFormData({ ...formData, subjects: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                    placeholder="Mathematics, Physics, Chemistry"
                  />
                  <p className="text-xs text-ink-subtle mt-1">
                    Separate units with commas. The timetable generator uses these assignments before giving a teacher a lesson.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm text-ink-muted mb-1">
                  Password {editingUser ? '(leave blank to keep current)' : '*'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink placeholder-ink-subtle focus:outline-none focus:border-indigo-500/50 transition-colors"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-ink-muted hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-700 text-white font-semibold hover:from-indigo-400 hover:to-indigo-500 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
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

export default UserManagementPage;
