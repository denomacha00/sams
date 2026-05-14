import React, { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

type Scope = 'school' | 'department' | 'class';
type Channel = 'inapp' | 'sms';

const NotificationsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSendForm, setShowSendForm] = useState(false);

  // Send form state
  const [scope, setScope] = useState<Scope>('class');
  const [targetId, setTargetId] = useState('');
  const [message, setMessage] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['inapp']);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const canSend = user && ['SCHOOL_ADMIN', 'HOD', 'TEACHER'].includes(user.role);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const { data } = await apiClient.get('/notifications');
      setNotifications(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // ignore
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError(null);
    setSendSuccess(false);

    try {
      await apiClient.post('/notifications/send', {
        scope,
        targetId: targetId || undefined,
        message,
        channels,
      });
      setSendSuccess(true);
      setMessage('');
      setTargetId('');
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err: any) {
      setSendError(err.response?.data?.error || 'Failed to send notification');
    } finally {
      setSending(false);
    }
  };

  const toggleChannel = (ch: Channel) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  };

  const getScopeOptions = (): Scope[] => {
    if (!user) return [];
    switch (user.role) {
      case 'SCHOOL_ADMIN':
        return ['school', 'department', 'class'];
      case 'HOD':
        return ['department', 'class'];
      case 'TEACHER':
        return ['class'];
      default:
        return [];
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Notifications</h1>
            <p className="text-gray-400 text-sm mt-1">View and manage your messages</p>
          </div>
          {canSend && (
            <button
              onClick={() => setShowSendForm(!showSendForm)}
              className="px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-semibold rounded-xl hover:from-teal-400 hover:to-cyan-500 transition-all shadow-lg shadow-teal-500/20"
            >
              {showSendForm ? 'Cancel' : 'Send Message'}
            </button>
          )}
        </div>

        {/* Send Form */}
        {showSendForm && canSend && (
          <div className="mb-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Send Notification</h2>

            {sendSuccess && (
              <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-400/30 rounded-xl">
                <p className="text-sm text-emerald-300 text-center">Message sent successfully!</p>
              </div>
            )}
            {sendError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                <p className="text-sm text-red-300 text-center">{sendError}</p>
              </div>
            )}

            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Recipient Scope</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as Scope)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                >
                  {getScopeOptions().map((s) => (
                    <option key={s} value={s} className="bg-slate-800">
                      {s === 'school' ? 'Whole School' : s === 'department' ? 'Department' : 'Class'}
                    </option>
                  ))}
                </select>
              </div>

              {scope !== 'school' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">
                    Target ID ({scope === 'department' ? 'Department' : 'Class'} ID)
                  </label>
                  <input
                    type="text"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all"
                    placeholder={`Enter ${scope} ID`}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 transition-all resize-none"
                  placeholder="Type your message..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">Send via</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channels.includes('inapp')}
                      onChange={() => toggleChannel('inapp')}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-500/40"
                    />
                    <span className="text-sm text-gray-300">In-App</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channels.includes('sms')}
                      onChange={() => toggleChannel('sms')}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-500/40"
                    />
                    <span className="text-sm text-gray-300">SMS</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={sending || !message.trim() || channels.length === 0}
                className="w-full bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold py-3 px-4 rounded-xl hover:from-teal-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-teal-500/30"
              >
                {sending ? 'Sending...' : 'Send Notification'}
              </button>
            </form>
          </div>
        )}

        {/* Notifications List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-teal-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
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
            {notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => !notif.read && markAsRead(notif.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  notif.read
                    ? 'bg-white/3 border-white/5'
                    : 'bg-white/5 border-teal-500/20 hover:border-teal-500/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {!notif.read && (
                        <div className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0" />
                      )}
                      <h3 className={`text-sm font-semibold ${notif.read ? 'text-gray-400' : 'text-white'}`}>
                        {notif.title}
                      </h3>
                    </div>
                    <p className={`text-sm mt-1 ${notif.read ? 'text-gray-500' : 'text-gray-300'}`}>
                      {notif.message}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0 ml-4">
                    {new Date(notif.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
