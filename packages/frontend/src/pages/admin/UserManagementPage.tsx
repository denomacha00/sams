import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../services/apiClient';

interface User {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: string;
  admissionNumber?: string;
  departmentId?: string;
  classId?: string;
  isLocked: boolean;
  createdAt: string;
}

interface Department {
  id: string;
  name: string;
  classes?: { id: string; name: string }[];
}

interface UserFormData {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  admissionNumber: string;
  password: string;
  departmentId: string;
  classId: string;
}

const emptyForm: UserFormData = {
  fullName: '',
  email: '',
  phone: '',
  role: 'STUDENT',
  admissionNumber: '',
  password: '',
  departmentId: '',
  classId: '',
};

const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
      setDepartments(Array.isArray(data) ? data : (data.departments || []));
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  const classesForDept = departments.find(d => d.id === formData.departmentId)?.classes || [];

  const filteredUsers = activeTab === 'ALL'
    ? users
    : users.filter((u) => u.role === activeTab);

  const openAddModal = () => {
    setEditingUser(null);
    setFormData(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      fullName: user.fullName,
      email: user.email || '',
      phone: user.phone || '',
      role: user.role,
      admissionNumber: user.admissionNumber || '',
      password: '',
      departmentId: user.departmentId || '',
      classId: user.classId || '',
    });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload: any = {
        fullName: formData.fullName,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        role: formData.role,
        admissionNumber: formData.role === 'STUDENT' ? formData.admissionNumber : undefined,
        departmentId: formData.departmentId || undefined,
        classId: formData.classId || undefined,
      };

      if (editingUser) {
        if (formData.password) payload.password = formData.password;
        await apiClient.put(`/users/${editingUser.id}`, payload);
      } else {
        payload.password = formData.password;
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

  const tabs = ['ALL', 'HOD', 'TEACHER', 'STUDENT'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-gray-400 hover:text-cyan-400 transition-colors">
              ← Admin
            </Link>
            <h1 className="text-lg font-bold text-white">User Management</h1>
          </div>
          <button
            onClick={openAddModal}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            + Add User
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10'
              }`}
            >
              {tab === 'ALL' ? 'All' : tab === 'HOD' ? 'HODs' : tab === 'TEACHER' ? 'Teachers' : 'Students'}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Role</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Adm No.</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Status</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">Loading...</td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No users found</td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 text-sm text-white">{u.fullName}</td>
                      <td className="px-6 py-4 text-sm text-gray-400">{u.email || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          u.role === 'HOD' ? 'bg-orange-500/20 text-orange-300' :
                          u.role === 'TEACHER' ? 'bg-green-500/20 text-green-300' :
                          u.role === 'STUDENT' ? 'bg-blue-500/20 text-blue-300' :
                          'bg-purple-500/20 text-purple-300'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-400">{u.admissionNumber || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          u.isLocked ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'
                        }`}>
                          {u.isLocked ? 'Locked' : 'Active'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openEditModal(u)}
                          className="text-cyan-400 hover:text-cyan-300 text-sm mr-3 transition-colors"
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
          <div className="backdrop-blur-xl bg-slate-800/90 border border-white/10 rounded-2xl p-8 w-full max-w-lg mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">
              {editingUser ? 'Edit User' : 'Add New User'}
            </h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="John Doe"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    placeholder="john@school.com"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Phone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    placeholder="+254..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Role *</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  >
                    <option value="STUDENT" className="bg-slate-800">Student</option>
                    <option value="TEACHER" className="bg-slate-800">Teacher</option>
                    <option value="HOD" className="bg-slate-800">HOD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    {formData.role === 'STUDENT' ? 'Admission Number' : 'Staff ID'}
                  </label>
                  <input
                    type="text"
                    value={formData.admissionNumber}
                    onChange={(e) => setFormData({ ...formData, admissionNumber: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    placeholder={formData.role === 'STUDENT' ? 'ADM001' : 'Optional'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Department</label>
                  <select
                    value={formData.departmentId}
                    onChange={(e) => setFormData({ ...formData, departmentId: e.target.value, classId: '' })}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  >
                    <option value="" className="bg-slate-800">-- No Department --</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id} className="bg-slate-800">{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Class</label>
                  <select
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    disabled={!formData.departmentId}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                  >
                    <option value="" className="bg-slate-800">-- No Class --</option>
                    {classesForDept.map(c => (
                      <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Password {editingUser ? '(leave blank to keep current)' : '*'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  placeholder="••••••••"
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
          <p className="text-xs text-gray-500">© 2025 SAMS · Developed by Denis Macharia</p>
        </div>
      </footer>
    </div>
  );
};

export default UserManagementPage;
