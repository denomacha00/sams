import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';

interface School {
  id: string;
  name: string;
  schoolCode: string;
  planTier: string;
}

interface SentNotification {
  id: string;
  title: string;
  message: string;
  batchId: string | null;
  targetScopeLabel?: string | null;
  recipientCount: number;
  schoolCount: number;
  createdAt: string;
  updatedAt?: string | null;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}

interface SupportThread {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  adminUserId: string;
  adminName: string;
  lastMessage: string;
  lastSenderRole: string | null;
  lastSenderName: string;
  lastAt: string;
}

interface SupportMessage {
  id: string;
  message: string;
  createdAt: string;
  senderName: string;
  senderRole: string;
  isMine: boolean;
}

interface SupportThreadDetail {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  adminUserId: string;
  adminName: string;
  messages: SupportMessage[];
}

type Audience = 'all_schools' | 'school';
type TargetRole = 'ALL' | 'SCHOOL_ADMIN' | 'HOD' | 'TEACHER' | 'STUDENT';

const MAX_ATTACHMENT_FILES = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/pdf',
  'text/plain',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
].join(',');

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const roleOptions: Array<{ value: TargetRole; label: string }> = [
  { value: 'ALL', label: 'All users' },
  { value: 'SCHOOL_ADMIN', label: 'School admins only' },
  { value: 'HOD', label: 'HODs only' },
  { value: 'TEACHER', label: 'Teachers only' },
  { value: 'STUDENT', label: 'Students only' },
];

const NotificationsPage: React.FC = () => {
  const [schools, setSchools] = useState<School[]>([]);
  const [sent, setSent] = useState<SentNotification[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  const [selectedSupportThread, setSelectedSupportThread] = useState<SupportThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(true);
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportReply, setSupportReply] = useState('');
  const [supportReplying, setSupportReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [audience, setAudience] = useState<Audience>('all_schools');
  const [schoolId, setSchoolId] = useState('');
  const [targetRole, setTargetRole] = useState<TargetRole>('ALL');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  const [editing, setEditing] = useState<SentNotification | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  const selectedSchool = useMemo(
    () => schools.find((school) => school.id === schoolId),
    [schoolId, schools],
  );

  const fetchSchools = async () => {
    const { data } = await apiClient.get('/super/schools');
    setSchools(Array.isArray(data.schools) ? data.schools : []);
  };

  const fetchSent = async () => {
    setSentLoading(true);
    try {
      const { data } = await apiClient.get('/super/notifications/sent');
      setSent(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to load sent notifications.'));
    } finally {
      setSentLoading(false);
    }
  };

  const fetchSupportThreads = async () => {
    setSupportLoading(true);
    try {
      const { data } = await apiClient.get('/super/notifications/support');
      setSupportThreads(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to load school support messages.'));
    } finally {
      setSupportLoading(false);
    }
  };

  const openSupportThread = async (thread: SupportThread) => {
    setError(null);
    try {
      const { data } = await apiClient.get(`/super/notifications/support/${thread.schoolId}/${thread.adminUserId}`);
      setSelectedSupportThread(data);
      setSupportReply('');
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to open support thread.'));
    }
  };

  const handleSupportReply = async () => {
    if (!selectedSupportThread || !supportReply.trim()) return;
    setSupportReplying(true);
    setError(null);
    try {
      await apiClient.post('/super/notifications/support/reply', {
        schoolId: selectedSupportThread.schoolId,
        adminUserId: selectedSupportThread.adminUserId,
        message: supportReply.trim(),
      });
      setSupportReply('');
      await openSupportThread({
        schoolId: selectedSupportThread.schoolId,
        schoolName: selectedSupportThread.schoolName,
        schoolCode: selectedSupportThread.schoolCode,
        adminUserId: selectedSupportThread.adminUserId,
        adminName: selectedSupportThread.adminName,
        lastMessage: '',
        lastSenderRole: null,
        lastSenderName: '',
        lastAt: new Date().toISOString(),
      });
      await fetchSupportThreads();
      setSuccess('Reply sent to school admin.');
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to send support reply.'));
    } finally {
      setSupportReplying(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchSchools(), fetchSent(), fetchSupportThreads()])
      .catch((err) => setError(getSuperAdminApiError(err, 'Failed to load notifications page.')))
      .finally(() => setLoading(false));
  }, []);

  const handleAttachmentSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_ATTACHMENT_FILES - selectedAttachments.length;
    if (remaining <= 0) {
      setError(`Attach up to ${MAX_ATTACHMENT_FILES} files.`);
      event.target.value = '';
      return;
    }

    const validFiles: File[] = [];
    for (const file of files.slice(0, remaining)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`${file.name} is too large. Each attachment must be 10MB or smaller.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      setSelectedAttachments((prev) => [...prev, ...validFiles]);
      setError(null);
    }
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setSelectedAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('audience', audience);
      if (audience === 'school') formData.append('schoolId', schoolId);
      formData.append('targetRole', targetRole);
      formData.append('title', title.trim());
      formData.append('message', message.trim());
      selectedAttachments.forEach((file) => formData.append('attachments', file));

      const { data } = await apiClient.post('/super/notifications/send', formData, { timeout: 120_000 });
      if (data?.recipientCount === 0) {
        setError(data.warning || 'No users matched this audience.');
        return;
      }

      setSuccess(`Delivered to ${data.recipientCount} user${data.recipientCount === 1 ? '' : 's'} across ${data.schoolCount} school${data.schoolCount === 1 ? '' : 's'}.`);
      setTitle('');
      setMessage('');
      setSelectedAttachments([]);
      setSchoolId('');
      setAudience('all_schools');
      setTargetRole('ALL');
      await fetchSent();
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to send platform notification.'));
    } finally {
      setSending(false);
    }
  };

  const openEdit = (notification: SentNotification) => {
    setEditing(notification);
    setEditTitle(notification.title);
    setEditMessage(notification.message);
    setError(null);
  };

  const handleEditSave = async () => {
    if (!editing) return;
    setEditSaving(true);
    setError(null);
    try {
      await apiClient.patch(`/super/notifications/${editing.id}`, {
        title: editTitle.trim(),
        message: editMessage.trim(),
      });
      setEditing(null);
      await fetchSent();
      setSuccess('Platform notification updated.');
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to update platform notification.'));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (notification: SentNotification) => {
    const batchId = notification.batchId ?? notification.id;
    if (!confirm(`Delete "${notification.title}" for all recipients?`)) return;

    setDeletingBatchId(batchId);
    setError(null);
    try {
      await apiClient.delete(`/super/notifications/batch/${batchId}`);
      setSent((prev) => prev.filter((item) => (item.batchId ?? item.id) !== batchId));
      setSuccess('Platform notification deleted.');
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to delete platform notification.'));
    } finally {
      setDeletingBatchId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <div className="rounded-2xl border border-gray-700 bg-gray-800 px-5 py-4 text-sm text-gray-300">
          Loading notifications...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-gray-800 via-gray-800 to-amber-950/25 p-7 shadow-xl shadow-black/20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Platform notices</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Super Admin Notifications</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
          Send official SAMS updates to all schools or a selected school. Recipients see these in Alerts with a distinct SAMS update badge.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg shadow-black/10">
        <div className="mb-5 flex flex-col gap-1 border-b border-gray-700/80 pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-white">Compose official update</h2>
          <p className="text-sm text-gray-400">Photos, videos, PDFs, links, and text stay in-app only.</p>
        </div>

        <form onSubmit={handleSend} className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Audience</label>
                <select
                  value={audience}
                  onChange={(event) => {
                    const next = event.target.value as Audience;
                    setAudience(next);
                    if (next === 'all_schools') setSchoolId('');
                  }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="all_schools">All schools</option>
                  <option value="school">Selected school</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Recipients</label>
                <select
                  value={targetRole}
                  onChange={(event) => setTargetRole(event.target.value as TargetRole)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {audience === 'school' && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">School</label>
                <select
                  value={schoolId}
                  onChange={(event) => setSchoolId(event.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Select school</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name} ({school.schoolCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Title</label>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
                placeholder="e.g. New SAMS attendance update"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Message</label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                maxLength={2000}
                required
                placeholder="Write the official update. Links are clickable in the school app."
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-300">Attachments</label>
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/50 p-4">
                <input
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT}
                  onChange={handleAttachmentSelect}
                  disabled={selectedAttachments.length >= MAX_ATTACHMENT_FILES}
                  className="block w-full text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-500 disabled:opacity-60"
                />
                <p className="mt-2 text-xs text-gray-500">
                  Up to {MAX_ATTACHMENT_FILES} files, 10MB each. Supports images, videos, PDFs, Office documents, and text.
                </p>
                {selectedAttachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAttachments.map((file, index) => (
                      <span key={`${file.name}-${file.size}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300">
                        <span className="max-w-[14rem] truncate">{file.name}</span>
                        <span className="text-gray-500">{formatFileSize(file.size)}</span>
                        <button type="button" onClick={() => removeAttachment(index)} className="rounded px-1 text-gray-500 hover:bg-red-950/50 hover:text-red-300">
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="rounded-2xl border border-gray-700 bg-gray-900/55 p-5">
            <h3 className="text-sm font-semibold text-white">Delivery summary</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-400">
              <div className="flex justify-between gap-4">
                <span>Scope</span>
                <span className="text-right text-gray-200">{audience === 'all_schools' ? 'All schools' : selectedSchool?.name || 'One school'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Recipients</span>
                <span className="text-right text-gray-200">{roleOptions.find((option) => option.value === targetRole)?.label}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Files</span>
                <span className="text-right text-gray-200">{selectedAttachments.length}</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={sending || !title.trim() || !message.trim() || (audience === 'school' && !schoolId)}
              className="mt-5 w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send official update'}
            </button>
          </aside>
        </form>
      </section>

      <section className="rounded-2xl border border-amber-500/25 bg-gray-800/80 p-6 shadow-lg shadow-black/10">
        <div className="mb-5 flex flex-col gap-1 border-b border-gray-700/80 pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-white">School admin support inbox</h2>
          <p className="text-sm text-gray-400">Read messages sent from school admins and reply inside the app.</p>
        </div>

        {supportLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading support messages...</p>
        ) : supportThreads.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-700 py-8 text-center text-sm text-gray-500">
            No school admin support messages yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <div className="space-y-2">
              {supportThreads.map((thread) => {
                const selected =
                  selectedSupportThread?.schoolId === thread.schoolId &&
                  selectedSupportThread?.adminUserId === thread.adminUserId;
                return (
                  <button
                    key={`${thread.schoolId}-${thread.adminUserId}`}
                    type="button"
                    onClick={() => void openSupportThread(thread)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      selected
                        ? 'border-amber-400/45 bg-amber-500/10'
                        : 'border-gray-700 bg-gray-900/45 hover:border-gray-600 hover:bg-gray-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{thread.adminName}</p>
                        <p className="truncate text-xs text-amber-200">{thread.schoolName} ({thread.schoolCode})</p>
                      </div>
                      <span className="shrink-0 text-xs text-gray-500">{formatDateTime(thread.lastAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-gray-400">{thread.lastMessage}</p>
                  </button>
                );
              })}
            </div>

            <div className="min-h-[22rem] rounded-2xl border border-gray-700 bg-gray-900/45 p-4">
              {!selectedSupportThread ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
                  Select a school admin conversation.
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <div className="border-b border-gray-700 pb-3">
                    <h3 className="text-sm font-semibold text-white">{selectedSupportThread.adminName}</h3>
                    <p className="text-xs text-gray-400">
                      {selectedSupportThread.schoolName} ({selectedSupportThread.schoolCode})
                    </p>
                  </div>

                  <div className="mt-4 max-h-80 flex-1 space-y-3 overflow-y-auto pr-1">
                    {selectedSupportThread.messages.map((item) => (
                      <div key={item.id} className={`flex ${item.isMine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[86%] rounded-2xl border px-4 py-3 text-sm ${
                          item.isMine
                            ? 'border-amber-500/25 bg-amber-500/12 text-amber-50'
                            : 'border-gray-700 bg-gray-800 text-gray-200'
                        }`}>
                          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{item.isMine ? 'You' : item.senderName}</span>
                            <span>{formatDateTime(item.createdAt)}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">{item.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 border-t border-gray-700 pt-4">
                    <textarea
                      value={supportReply}
                      onChange={(event) => setSupportReply(event.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="Reply to this school admin..."
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSupportReply()}
                        disabled={supportReplying || !supportReply.trim()}
                        className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {supportReplying ? 'Sending...' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg shadow-black/10">
        <div className="mb-5 flex flex-col gap-1 border-b border-gray-700/80 pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-white">Sent updates</h2>
          <p className="text-sm text-gray-400">Edit message/title or remove a platform update from recipients.</p>
        </div>

        {sentLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading sent updates...</p>
        ) : sent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-700 py-8 text-center text-sm text-gray-500">
            No platform updates sent yet.
          </p>
        ) : (
          <div className="space-y-3">
            {sent.map((item) => {
              const batchId = item.batchId ?? item.id;
              return (
                <div key={batchId} className="rounded-2xl border border-gray-700 bg-gray-900/45 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-white">{item.title}</h3>
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                          SAMS update
                        </span>
                        {item.updatedAt && (
                          <span className="text-xs italic text-amber-300/80">edited</span>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-400">{item.message}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>{item.targetScopeLabel || 'Recipients'}</span>
                        <span>{item.recipientCount} user{item.recipientCount === 1 ? '' : 's'}</span>
                        <span>{item.schoolCount} school{item.schoolCount === 1 ? '' : 's'}</span>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </div>
                      {!!item.attachments?.length && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.attachments.map((attachment) => (
                            <span key={attachment.id} className="rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300">
                              {attachment.fileName} - {formatFileSize(attachment.sizeBytes)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item)}
                        disabled={deletingBatchId === batchId}
                        className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-950/40 disabled:opacity-50"
                      >
                        {deletingBatchId === batchId ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setEditing(null)} />
          <div className="relative w-full max-w-xl rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Edit platform update</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  maxLength={200}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Message</label>
                <textarea
                  value={editMessage}
                  onChange={(event) => setEditMessage(event.target.value)}
                  rows={5}
                  maxLength={2000}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleEditSave()}
                disabled={editSaving || !editTitle.trim() || !editMessage.trim()}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {editSaving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
