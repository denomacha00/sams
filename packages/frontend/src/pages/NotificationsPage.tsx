import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  updatedAt: string | null;
  senderId: string | null;
  senderName: string | null;
  senderRole: string | null;
  batchId: string | null;
}

interface Department {
  id: string;
  name: string;
  classes?: { id: string; name: string }[];
}

type Scope = 'school' | 'department' | 'class';
type Channel = 'inapp' | 'sms';
type TargetRole = 'ALL' | 'TEACHER' | 'STUDENT' | 'HOD';

function truncateName(name: string, maxLen = 50): string {
  return name.length <= maxLen ? name : name.slice(0, maxLen) + '…';
}

function isWithin24Hours(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

function formatRole(role: string | null): string {
  if (!role) return '';
  const map: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin', SCHOOL_ADMIN: 'Admin',
    HOD: 'HOD', TEACHER: 'Teacher', STUDENT: 'Student',
  };
  return map[role] ?? role;
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} at ${time}`;
}

const NotificationsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSendForm, setShowSendForm] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Send form state
  const [scope, setScope] = useState<Scope>(() => {
    if (!user) return 'class';
    if (user.role === 'TEACHER') return 'class';
    if (user.role === 'HOD') return 'department';
    return 'school';
  });
  const [targetId, setTargetId] = useState('');
  const [targetRole, setTargetRole] = useState<TargetRole>('ALL');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['inapp']);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Edit modal state
  const [editingNotification, setEditingNotification] = useState<Notification | null>(null);
  const [editMessage, setEditMessage] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirmation state
  const [deletingNotification, setDeletingNotification] = useState<Notification | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canSend = user && ['SCHOOL_ADMIN', 'HOD', 'TEACHER'].includes(user.role);
  const isAdmin = user && ['SCHOOL_ADMIN', 'HOD'].includes(user.role);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
    if (canSend) fetchScopeData();
  }, []);

  // Teachers: pre-select their class so send is not submitted with an empty target
  useEffect(() => {
    if (user?.role === 'TEACHER' && user.classId) {
      setScope('class');
      setTargetId(user.classId);
      setTargetRole('STUDENT');
    }
  }, [user?.role, user?.classId]);

  // Real-time socket listener
  useEffect(() => {
    if (!accessToken) return;
    const socket = io(import.meta.env.VITE_WS_URL || window.location.origin, {
      auth: { token: accessToken },
    });
    socketRef.current = socket;

    socket.on('notification:new', (data: any) => {
      const newNotif: Notification = {
        id: data.id || `tmp-${Date.now()}`,
        title: data.title || 'New Message',
        message: data.message,
        type: data.type || 'MESSAGE',
        read: false,
        createdAt: data.timestamp || new Date().toISOString(),
        updatedAt: null,
        senderId: data.senderId || null,
        senderName: null,
        senderRole: null,
        batchId: data.batchId || null,
      };
      // Refresh to get full sender info
      fetchNotifications();
      void newNotif;
    });

    socket.on('notification:updated', (data: { id: string; message: string; updatedAt: string }) => {
      setNotifications((prev) =>
        prev.map((n) => n.id === data.id ? { ...n, message: data.message, updatedAt: data.updatedAt } : n)
      );
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [accessToken]);

  const fetchNotifications = async () => {
    try {
      const { data } = await apiClient.get('/notifications');
      setNotifications(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const fetchScopeData = async () => {
    try {
      if (user?.role === 'SCHOOL_ADMIN') {
        const { data } = await apiClient.get('/departments');
        const depts: Department[] = Array.isArray(data) ? data : (data.departments || []);
        const deptsWithClasses = await Promise.all(
          depts.map(async (d) => {
            try {
              const { data: cd } = await apiClient.get(`/departments/${d.id}/classes`);
              return { ...d, classes: Array.isArray(cd) ? cd : [] };
            } catch { return { ...d, classes: [] }; }
          })
        );
        setDepartments(deptsWithClasses);
      } else if ((user?.role === 'HOD' || user?.role === 'TEACHER') && user.departmentId) {
        const { data } = await apiClient.get(`/departments/${user.departmentId}/classes`);
        setClasses(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  };

  const markAsRead = async (id: string) => {
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch { /* ignore */ }
  };

  const markAllAsRead = async () => {
    try {
      await apiClient.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      if (!channels.includes('inapp') && channels.includes('sms')) {
        setSendError(
          'SMS-only is selected. In-app messages will not appear in SAMS unless you also check In-App. Sandbox SMS only delivers to Africa\'s Talking test numbers.',
        );
        setSending(false);
        return;
      }

      const { data } = await apiClient.post(
        '/notifications/send',
        {
          scope,
          targetId: targetId || undefined,
          targetRole: targetRole === 'ALL' ? undefined : targetRole,
          title: title.trim() || undefined,
          message,
          channels,
        },
        { timeout: 90_000 },
      );

      const count = data?.recipientCount ?? 0;
      if (count === 0) {
        setSendError(
          data?.warning ||
            'No recipients matched. Assign users to the selected class/department, or widen the role filter.',
        );
        return;
      }

      setSendSuccess(true);
      setMessage('');
      setTitle('');
      if (user?.role !== 'TEACHER') {
        setTargetId('');
        setTargetRole('ALL');
      }
      // Refresh inbox in background — do not block the Send button
      void fetchNotifications();
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err: any) {
      if (err.code === 'ECONNABORTED') {
        setSendError('Request timed out. The message may still have been sent — refresh the page.');
      } else {
        setSendError(err.response?.data?.error || err.response?.data?.message || 'Failed to send notification');
      }
    } finally {
      setSending(false);
    }
  };

  const toggleChannel = (ch: Channel) => {
    setChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]);
  };

  const getScopeOptions = (): Scope[] => {
    if (!user) return [];
    if (user.role === 'SCHOOL_ADMIN') return ['school', 'department', 'class'];
    if (user.role === 'HOD') return ['department', 'class'];
    return ['class'];
  };

  // What role filters are available for the current sender + scope
  const getTargetRoleOptions = (): { value: TargetRole; label: string }[] => {
    if (!user) return [];
    if (user.role === 'TEACHER') return [{ value: 'STUDENT', label: 'Students only' }];
    if (user.role === 'HOD') {
      return [
        { value: 'ALL', label: 'Everyone in scope' },
        { value: 'TEACHER', label: 'Teachers only' },
        { value: 'STUDENT', label: 'Students only' },
      ];
    }
    // SCHOOL_ADMIN
    const opts: { value: TargetRole; label: string }[] = [
      { value: 'ALL', label: 'Everyone in scope' },
      { value: 'STUDENT', label: 'Students only' },
      { value: 'TEACHER', label: 'Teachers only' },
    ];
    if (scope === 'school' || scope === 'department') {
      opts.push({ value: 'HOD', label: 'HODs only' });
    }
    return opts;
  };

  const handleEdit = async () => {
    if (!editingNotification) return;
    if (editMessage.trim().length < 1 || editMessage.length > 1000) {
      setEditError('Message must be between 1 and 1000 characters');
      return;
    }
    setEditLoading(true);
    setEditError(null);
    try {
      await apiClient.patch(`/notifications/${editingNotification.id}`, { message: editMessage.trim() });
      setNotifications((prev) =>
        prev.map((n) => {
          if (editingNotification.batchId && n.batchId === editingNotification.batchId) {
            return { ...n, message: editMessage.trim(), updatedAt: new Date().toISOString() };
          }
          if (n.id === editingNotification.id) return { ...n, message: editMessage.trim(), updatedAt: new Date().toISOString() };
          return n;
        })
      );
      setEditingNotification(null);
    } catch (err: any) {
      setEditError(err.response?.data?.error || 'Failed to edit notification');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingNotification) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      if (deletingNotification.batchId) {
        await apiClient.delete(`/notifications/batch/${deletingNotification.batchId}`);
        setNotifications((prev) => prev.filter((n) => n.batchId !== deletingNotification.batchId));
      } else {
        // Non-batched (system notifications) — delete single record
        await apiClient.delete(`/notifications/${deletingNotification.id}`);
        setNotifications((prev) => prev.filter((n) => n.id !== deletingNotification.id));
      }
      setDeletingNotification(null);
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || 'Failed to delete notification');
    } finally {
      setDeleteLoading(false);
    }
  };

  const isOwnNotification = (notif: Notification): boolean => {
    if (!user) return false;
    if (isAdmin) return true;
    return !!notif.senderId && notif.senderId === user.id;
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Notifications
              {unreadCount > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-teal-500 text-white min-w-[1.5rem]">
                  {unreadCount}
                </span>
              )}
            </h1>
            <p className="text-gray-400 text-sm mt-1">View and manage your messages</p>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-3 py-2 text-sm text-gray-400 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 transition-all"
              >
                Mark all read
              </button>
            )}
            {canSend && (
              <button
                onClick={() => setShowSendForm(!showSendForm)}
                className="px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-semibold rounded-xl hover:from-teal-400 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/20"
              >
                {showSendForm ? 'Cancel' : 'Send Message'}
              </button>
            )}
          </div>
        </div>

        {/* Send Form */}
        {showSendForm && canSend && (
          <div className="mb-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Send Notification</h2>
            {sendSuccess && (
              <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-400/30 rounded-xl">
                <p className="text-sm text-emerald-300 text-center">
                  Message delivered in-app. Recipients see it under Notifications (bell icon).
                </p>
              </div>
            )}
            {sendError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                <p className="text-sm text-red-300 text-center">{sendError}</p>
              </div>
            )}
            <form onSubmit={handleSend} className="space-y-4">
              {/* Scope */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Send to</label>
                <select value={scope} onChange={(e) => { setScope(e.target.value as Scope); setTargetId(''); setTargetRole('ALL'); }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all">
                  {getScopeOptions().map((s) => (
                    <option key={s} value={s} className="bg-slate-800">
                      {s === 'school' ? 'Whole School' : s === 'department' ? 'Department' : 'Class'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target role filter */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Who receives it</label>
                <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as TargetRole)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all">
                  {getTargetRoleOptions().map((o) => (
                    <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Department / Class picker */}
              {scope !== 'school' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">
                    {scope === 'department' ? 'Department *' : 'Class *'}
                  </label>
                  {scope === 'department' && (
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all">
                      <option value="" className="bg-slate-800">-- Select Department --</option>
                      {departments.map((d) => <option key={d.id} value={d.id} className="bg-slate-800">{d.name}</option>)}
                    </select>
                  )}
                  {scope === 'class' && (
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all">
                      <option value="" className="bg-slate-800">-- Select Class --</option>
                      {user?.role === 'SCHOOL_ADMIN' && departments.flatMap((d) =>
                        (d.classes || []).map((c) => <option key={c.id} value={c.id} className="bg-slate-800">{d.name} — {c.name}</option>)
                      )}
                      {(user?.role === 'HOD' || user?.role === 'TEACHER') && classes.map((c) =>
                        <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>
                      )}
                    </select>
                  )}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Title <span className="text-gray-500 font-normal">(optional)</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
                  placeholder="e.g. Exam Reminder"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all" />
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Message *</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all resize-none"
                  placeholder="Type your message..." />
              </div>

              {/* Channels */}
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Send via</label>
                <div className="flex gap-4">
                  {(['inapp', 'sms'] as Channel[]).map((ch) => (
                    <label key={ch} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-500/40" />
                      <span className="text-sm text-gray-300">{ch === 'inapp' ? 'In-App' : 'SMS'}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button type="submit" disabled={sending || !message.trim() || channels.length === 0 || (scope !== 'school' && !targetId)}
                className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3 px-4 rounded-xl hover:from-teal-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-500/30">
                {sending ? 'Sending...' : 'Send Notification'}
              </button>
            </form>
          </div>
        )}

        {/* Notifications List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-teal-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-gray-400">No notifications yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notif) => {
              const senderDisplay = truncateName(notif.senderName || (notif.senderId === null ? 'System' : 'Deleted User'));
              const roleDisplay = formatRole(notif.senderRole);
              const isOwn = isOwnNotification(notif);
              const canModify = isOwn && (!!isAdmin || isWithin24Hours(notif.createdAt));
              const windowExpired = isOwn && !isAdmin && !isWithin24Hours(notif.createdAt);

              return (
                <div key={notif.id} onClick={() => !notif.read && markAsRead(notif.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer backdrop-blur-sm ${
                    notif.read ? 'bg-white/[0.03] border-white/5' : 'bg-white/[0.06] border-teal-500/20 hover:border-teal-500/40'
                  }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {!notif.read && <div className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0" />}
                        <h3 className={`text-sm font-semibold ${notif.read ? 'text-gray-400' : 'text-white'}`}>{notif.title}</h3>
                        {notif.updatedAt && <span className="text-xs text-amber-400/70 italic">edited</span>}
                      </div>
                      <p className={`text-sm mt-1.5 ${notif.read ? 'text-gray-500' : 'text-gray-300'}`}>{notif.message}</p>

                      {/* Sender info + time */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                            {senderDisplay.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs text-gray-400 font-medium">{senderDisplay}</span>
                          {roleDisplay && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10 text-gray-500 border border-white/5">{roleDisplay}</span>
                          )}
                        </div>
                        <span className="text-gray-600 text-xs">·</span>
                        <span className="text-xs text-gray-500">{formatDateTime(notif.createdAt)}</span>
                        {notif.updatedAt && (
                          <><span className="text-gray-600 text-xs">·</span>
                          <span className="text-xs text-amber-400/60">edited {formatDateTime(notif.updatedAt)}</span></>
                        )}
                      </div>
                    </div>

                    {/* Edit / Delete controls */}
                    {isOwn && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="relative group">
                          <button onClick={(e) => { e.stopPropagation(); if (canModify) { setEditingNotification(notif); setEditMessage(notif.message); setEditError(null); } }}
                            disabled={!canModify}
                            className={`p-1.5 rounded-lg transition-all ${canModify ? 'hover:bg-white/10 text-gray-400 hover:text-teal-400' : 'text-gray-600 cursor-not-allowed'}`}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {windowExpired && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 border border-white/10 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              Edit window expired (24h)
                            </div>
                          )}
                        </div>
                        <div className="relative group">
                          <button onClick={(e) => { e.stopPropagation(); if (canModify) { setDeletingNotification(notif); setDeleteError(null); } }}
                            disabled={!canModify}
                            className={`p-1.5 rounded-lg transition-all ${canModify ? 'hover:bg-white/10 text-gray-400 hover:text-red-400' : 'text-gray-600 cursor-not-allowed'}`}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          {windowExpired && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-800 border border-white/10 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              Delete window expired (24h)
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingNotification(null)} />
          <div className="relative w-full max-w-lg bg-slate-800/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white mb-4">Edit Notification</h2>
            {editError && <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl"><p className="text-sm text-red-300">{editError}</p></div>}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-300 mb-1.5">Message</label>
              <textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={5} maxLength={1000}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 transition-all resize-none" />
              <p className="text-xs text-gray-500 mt-1 text-right">{editMessage.length}/1000</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditingNotification(null)} className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={handleEdit} disabled={editLoading || editMessage.trim().length < 1}
                className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-xl hover:from-teal-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deletingNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeletingNotification(null)} />
          <div className="relative w-full max-w-md bg-slate-800/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">Delete Notification</h2>
            <p className="text-sm text-gray-400 mb-6">
              {deletingNotification.batchId
                ? 'This will remove the message for all recipients. Cannot be undone.'
                : 'This will remove this notification. Cannot be undone.'}
            </p>
            {deleteError && <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl"><p className="text-sm text-red-300">{deleteError}</p></div>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeletingNotification(null)} className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={handleDelete} disabled={deleteLoading}
                className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-rose-600 rounded-xl hover:from-red-400 hover:to-rose-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
