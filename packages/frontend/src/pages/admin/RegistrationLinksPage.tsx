import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '@sams/shared';

interface RegistrationLink {
  id: string;
  token: string;
  targetRole: string;
  classId?: string;
  departmentId?: string;
  schoolId: string;
  useCount: number;
  maxUses: number;
  expiresAt: string;
  createdAt: string;
  className?: string;
  departmentName?: string;
}

interface Department {
  id: string;
  name: string;
  classes?: ClassItem[];
}

interface ClassItem {
  id: string;
  name: string;
}

const RegistrationLinksPage: React.FC = () => {
  const { user } = useAuthStore();
  const isHOD = user?.role === UserRole.HOD;
  const isTeacher = user?.role === UserRole.TEACHER;

  const [links, setLinks] = useState<RegistrationLink[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hodClasses, setHodClasses] = useState<ClassItem[]>([]);
  const [teacherClasses, setTeacherClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Teachers can only generate STUDENT links; HOD can do TEACHER or STUDENT
  const [targetRole, setTargetRole] = useState(isHOD ? 'TEACHER' : 'STUDENT');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [maxUses, setMaxUses] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadingClasses, setLoadingClasses] = useState(false);

  useEffect(() => {
    fetchLinks();
    if (isTeacher) {
      fetchTeacherClasses();
    } else if (isHOD) {
      fetchHodClasses();
    } else {
      fetchDepartments();
    }
  }, []);

  const fetchLinks = async () => {
    try {
      const { data } = await apiClient.get('/registration-links');
      setLinks(Array.isArray(data) ? data : (data.links || []));
    } catch (err) {
      console.error('Failed to fetch links:', err);
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

  // Fetch classes in the teacher's department
  const fetchTeacherClasses = async () => {
    setLoadingClasses(true);
    try {
      if (user?.departmentId) {
        const { data } = await apiClient.get(`/departments/${user.departmentId}/classes`);
        setTeacherClasses(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch teacher classes:', err);
      setTeacherClasses([]);
    } finally {
      setLoadingClasses(false);
    }
  };  const fetchHodClasses = async () => {
    setLoadingClasses(true);
    try {
      if (user?.departmentId) {
        const { data } = await apiClient.get(`/departments/${user.departmentId}/classes`);
        setHodClasses(Array.isArray(data) ? data : []);
      } else {
        // Fallback: fetch all departments and filter by HOD's department
        const { data } = await apiClient.get('/departments');
        const depts = Array.isArray(data) ? data : (data.departments || []);
        const hodDept = depts.find((d: Department) => d.id === user?.departmentId);
        setHodClasses(hodDept?.classes || []);
      }
    } catch (err) {
      console.error('Failed to fetch HOD classes:', err);
      setHodClasses([]);
    } finally {
      setLoadingClasses(false);
    }
  };

  const classesForSelectedDept = departments.find(d => d.id === selectedDept)?.classes || [];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        expiryDays,
        maxUses,
        targetRole: isTeacher ? 'STUDENT' : targetRole,
      };

      if (isTeacher) {
        // Teacher generates student links — use their dept and selected class
        payload.classId = selectedClass;
        payload.departmentId = user?.departmentId;
      } else if (targetRole === 'STUDENT') {
        payload.classId = selectedClass || undefined;
        if (isHOD) {
          // HOD's dept is set server-side
        } else {
          payload.departmentId = selectedDept || undefined;
        }
      } else {
        // HOD links or TEACHER links
        if (targetRole === 'HOD' && selectedDept) payload.departmentId = selectedDept;
        if (targetRole === 'TEACHER' && selectedDept) payload.departmentId = selectedDept;
        if (targetRole === 'TEACHER' && selectedClass) payload.classId = selectedClass;
      }

      await apiClient.post('/registration-links', payload);
      setShowModal(false);
      setTargetRole(isHOD ? 'TEACHER' : 'STUDENT');
      setSelectedDept('');
      setSelectedClass('');
      fetchLinks();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to generate link');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = (token: string, id: string) => {
    const url = `${window.location.origin}/register/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this registration link?')) return;
    try {
      await apiClient.delete(`/registration-links/${id}`);
      fetchLinks();
    } catch (err) {
      alert('Failed to delete link');
    }
  };

  const getLinkStatus = (link: RegistrationLink) => {
    const now = new Date();
    const expires = new Date(link.expiresAt);
    if (link.useCount >= link.maxUses) return { label: 'Exhausted', color: 'bg-orange-500/20 text-orange-300' };
    if (expires < now) return { label: 'Expired', color: 'bg-red-500/20 text-red-300' };
    return { label: 'Active', color: 'bg-green-500/20 text-green-300' };
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'STUDENT': return 'bg-blue-500/20 text-blue-300';
      case 'TEACHER': return 'bg-green-500/20 text-green-300';
      case 'HOD': return 'bg-orange-500/20 text-orange-300';
      default: return 'bg-gray-500/20 text-gray-300';
    }
  };

  // Determine if the generate button should be disabled
  const isGenerateDisabled = () => {
    if (submitting) return true;
    // Teacher: must pick a class from their dept
    if (isTeacher && !selectedClass) return true;
    if (isTeacher && teacherClasses.length === 0) return true;
    // HOD creating student link needs a class
    if (isHOD && targetRole === 'STUDENT' && hodClasses.length === 0) return true;
    if (isHOD && targetRole === 'STUDENT' && !selectedClass) return true;
    // Admin creating any link needs a department
    if (!isHOD && !isTeacher && targetRole !== 'SCHOOL_ADMIN' && !selectedDept) return true;
    // Student links need a class too (teacher links don't — teacher teaches multiple classes)
    if (!isHOD && !isTeacher && targetRole === 'STUDENT' && !selectedClass) return true;
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm bg-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to={isHOD ? '/dashboard' : isTeacher ? '/dashboard' : '/admin'}
              className="text-gray-400 hover:text-cyan-400 transition-colors"
            >
              ← {isHOD || isTeacher ? 'Dashboard' : 'Admin'}
            </Link>
            <h1 className="text-lg font-bold text-white">Registration Links</h1>
          </div>
          <button
            onClick={() => { setError(''); setShowModal(true); }}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20"
          >
            + Generate Link
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Links Table */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Link</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">For</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Dept / Class</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Uses</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Expires</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-white">Status</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">Loading...</td></tr>
                ) : links.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No registration links yet. Click "Generate Link" to create one.</td></tr>
                ) : (
                  links.map((link) => {
                    const status = getLinkStatus(link);
                    return (
                      <tr key={link.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm text-gray-300 font-mono">{link.token.substring(0, 8)}...</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getRoleBadge(link.targetRole)}`}>
                            {link.targetRole}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-0.5">
                            {link.departmentName && (
                              <span className="text-xs text-gray-300">{link.departmentName}</span>
                            )}
                            {link.className && (
                              <span className="text-xs text-teal-400">{link.className}</span>
                            )}
                            {!link.departmentName && !link.className && (
                              <span className="text-xs text-gray-600">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-300">{link.useCount} / {link.maxUses}</td>
                        <td className="px-6 py-4 text-sm text-gray-400">{new Date(link.expiresAt).toLocaleDateString()}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => copyLink(link.token, link.id)} className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors mr-3">
                            {copiedId === link.id ? '✓ Copied' : 'Copy'}
                          </button>
                          <button onClick={() => handleDelete(link.id)} className="text-red-400 hover:text-red-300 text-sm transition-colors">
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Generate Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="backdrop-blur-xl bg-slate-800/90 border border-white/10 rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">Generate Registration Link</h3>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              {/* Target Role — teachers can only generate student links */}
              {!isTeacher && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Who is this link for? *</label>
                  <select
                    value={targetRole}
                    onChange={(e) => { setTargetRole(e.target.value); setSelectedDept(''); setSelectedClass(''); }}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  >
                    {isHOD ? (
                      <>
                        <option value="TEACHER" className="bg-slate-800">Teachers</option>
                        <option value="STUDENT" className="bg-slate-800">Students</option>
                      </>
                    ) : (
                      <>
                        <option value="STUDENT" className="bg-slate-800">Students</option>
                        <option value="TEACHER" className="bg-slate-800">Teachers</option>
                        <option value="HOD" className="bg-slate-800">HODs (Heads of Department)</option>
                      </>
                    )}
                  </select>
                </div>
              )}

              {/* Teacher: pick a class from their department */}
              {isTeacher && (
                <div>
                  <p className="text-xs text-teal-400 mb-3">Generating a student registration link for your department</p>
                  <label className="block text-sm text-gray-300 mb-1">Class *</label>
                  {loadingClasses ? (
                    <div className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 text-sm">
                      Loading classes...
                    </div>
                  ) : teacherClasses.length === 0 ? (
                    <div className="w-full px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                      No classes in your department yet. Ask your HOD to create classes first.
                    </div>
                  ) : (
                    <select
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                    >
                      <option value="" className="bg-slate-800">-- Select Class --</option>
                      {teacherClasses.map(c => (
                        <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* HOD: Class picker when STUDENT is selected */}
              {isHOD && targetRole === 'STUDENT' && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Class *</label>
                  {loadingClasses ? (
                    <div className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 text-sm">
                      Loading classes...
                    </div>
                  ) : hodClasses.length === 0 ? (
                    <div className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-500 text-sm cursor-not-allowed">
                      No classes available in your department
                    </div>
                  ) : (
                    <select
                      value={selectedClass}
                      onChange={(e) => setSelectedClass(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                    >
                      <option value="" className="bg-slate-800">-- Select Class --</option>
                      {hodClasses.map(c => (
                        <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* SCHOOL_ADMIN: Department (for HODs, Students and Teachers) */}
              {!isHOD && (targetRole === 'HOD' || targetRole === 'STUDENT' || targetRole === 'TEACHER') && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Department *
                  </label>
                  {departments.length === 0 ? (
                    <div className="w-full px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                      No departments yet — create one in Departments first
                    </div>
                  ) : (
                    <select
                      value={selectedDept}
                      onChange={(e) => { setSelectedDept(e.target.value); setSelectedClass(''); }}
                      className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                    >
                      <option value="" className="bg-slate-800">-- Select Department --</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id} className="bg-slate-800">{d.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* SCHOOL_ADMIN: Class (for Students and Teachers) */}
              {!isHOD && (targetRole === 'STUDENT' || targetRole === 'TEACHER') && selectedDept && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">
                    Class {targetRole === 'STUDENT' ? '*' : '(optional — leave blank for any class)'}
                  </label>
                  <select
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  >
                    <option value="" className="bg-slate-800">-- Select Class --</option>
                    {classesForSelectedDept.map(c => (
                      <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>
                    ))}
                  </select>
                  {classesForSelectedDept.length === 0 && (
                    <p className="text-xs text-yellow-400 mt-1">No classes in this department. Create one first.</p>
                  )}
                </div>
              )}

              {/* Expiry & Max Uses */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Expires in (days)</label>
                  <input
                    type="number"
                    min={7}
                    max={365}
                    value={expiryDays}
                    onChange={(e) => setExpiryDays(parseInt(e.target.value) || 30)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Max registrations</label>
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(parseInt(e.target.value) || 50)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Info box */}
              <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/20">
                <p className="text-xs text-teal-300">
                  This link will allow up to <strong>{maxUses}</strong> {targetRole.toLowerCase()}s to self-register.
                  {targetRole === 'STUDENT' && selectedClass && ' They will be assigned to the selected class.'}
                  {targetRole !== 'STUDENT' && ' They will need to provide their Work ID and phone number.'}
                </p>
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
                  disabled={isGenerateDisabled()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-semibold hover:from-teal-400 hover:to-cyan-400 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Generating...' : 'Generate Link'}
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

export default RegistrationLinksPage;
