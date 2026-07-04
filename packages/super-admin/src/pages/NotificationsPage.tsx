import React, { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import { getSuperAdminApiError } from '../utils/apiError';
import AttachmentImageEditor from '../components/AttachmentImageEditor';

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
  attachments?: NotificationAttachment[];
}

interface NotificationAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url?: string;
  createdAt?: string;
}

interface AttachmentBlobState {
  url?: string;
  loading?: boolean;
  error?: boolean;
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
  attachments?: NotificationAttachment[];
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

function superAttachmentPath(att: NotificationAttachment, download = false): string {
  const suffix = download ? '?download=1' : '';
  return `/super/notifications/attachments/${encodeURIComponent(att.id)}${suffix}`;
}

function collectAttachmentsFromSupport(thread: SupportThreadDetail | null): NotificationAttachment[] {
  if (!thread) return [];
  const seen = new Set<string>();
  const attachments: NotificationAttachment[] = [];
  for (const message of thread.messages) {
    for (const attachment of message.attachments ?? []) {
      if (seen.has(attachment.id)) continue;
      seen.add(attachment.id);
      attachments.push(attachment);
    }
  }
  return attachments;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(att: NotificationAttachment): boolean {
  return att.mimeType.startsWith('image/');
}

function isVideoAttachment(att: NotificationAttachment): boolean {
  return att.mimeType.startsWith('video/');
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

function formatThreadTime(value: string): string {
  const d = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'SA';
}

function previewText(message: string, attachments = 0): string {
  const prefix = attachments > 0 ? `${attachments} attachment${attachments === 1 ? '' : 's'} - ` : '';
  return `${prefix}${message || 'Message'}`;
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
  const [supportSearch, setSupportSearch] = useState('');
  const [sentSearch, setSentSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(true);
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportReply, setSupportReply] = useState('');
  const [supportReplyAttachments, setSupportReplyAttachments] = useState<File[]>([]);
  const [editingSupportAttachmentIndex, setEditingSupportAttachmentIndex] = useState<number | null>(null);
  const [supportReplying, setSupportReplying] = useState(false);
  const [clearingSupportThread, setClearingSupportThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attachmentBlobs, setAttachmentBlobs] = useState<Record<string, AttachmentBlobState>>({});
  const attachmentUrlsRef = useRef<Record<string, string>>({});
  const attachmentLoadingRef = useRef<Set<string>>(new Set());

  const [audience, setAudience] = useState<Audience>('all_schools');
  const [schoolId, setSchoolId] = useState('');
  const [targetRole, setTargetRole] = useState<TargetRole>('ALL');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selectedAttachments, setSelectedAttachments] = useState<File[]>([]);
  const [editingAttachmentIndex, setEditingAttachmentIndex] = useState<number | null>(null);
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
  const filteredSupportThreads = useMemo(() => {
    const query = supportSearch.trim().toLowerCase();
    if (!query) return supportThreads;
    return supportThreads.filter((thread) => [
      thread.adminName,
      thread.schoolName,
      thread.schoolCode,
      thread.lastMessage,
      thread.lastSenderName,
    ].join(' ').toLowerCase().includes(query));
  }, [supportSearch, supportThreads]);
  const filteredSent = useMemo(() => {
    const query = sentSearch.trim().toLowerCase();
    if (!query) return sent;
    return sent.filter((item) => [
      item.title,
      item.message,
      item.targetScopeLabel,
      String(item.recipientCount),
      String(item.schoolCount),
    ].join(' ').toLowerCase().includes(query));
  }, [sent, sentSearch]);

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
      setSupportReplyAttachments([]);
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to open support thread.'));
    }
  };

  const handleSupportReply = async () => {
    if (!selectedSupportThread || (!supportReply.trim() && supportReplyAttachments.length === 0)) return;
    setSupportReplying(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('schoolId', selectedSupportThread.schoolId);
      formData.append('adminUserId', selectedSupportThread.adminUserId);
      if (supportReply.trim()) formData.append('message', supportReply.trim());
      supportReplyAttachments.forEach((file) => formData.append('attachments', file));

      await apiClient.post('/super/notifications/support/reply', formData, { timeout: 120_000 });
      setSupportReply('');
      setSupportReplyAttachments([]);
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

  const handleClearSupportThread = async () => {
    if (!selectedSupportThread) return;
    const confirmed = window.confirm(
      `Clear support conversation with ${selectedSupportThread.adminName}? This removes the messages in this support thread.`,
    );
    if (!confirmed) return;

    setClearingSupportThread(true);
    setError(null);
    try {
      await apiClient.delete(
        `/super/notifications/support/${selectedSupportThread.schoolId}/${selectedSupportThread.adminUserId}`,
      );
      setSelectedSupportThread(null);
      setSupportReply('');
      setSupportReplyAttachments([]);
      await fetchSupportThreads();
      setSuccess('Support conversation cleared.');
    } catch (err) {
      setError(getSuperAdminApiError(err, 'Failed to clear support conversation.'));
    } finally {
      setClearingSupportThread(false);
    }
  };

  useEffect(() => {
    Promise.all([fetchSchools(), fetchSent(), fetchSupportThreads()])
      .catch((err) => setError(getSuperAdminApiError(err, 'Failed to load notifications page.')))
      .finally(() => setLoading(false));
  }, []);

  const visibleSupportAttachments = useMemo(
    () => collectAttachmentsFromSupport(selectedSupportThread),
    [selectedSupportThread],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleSupportAttachments.map((att) => att.id));

    Object.entries(attachmentUrlsRef.current).forEach(([id, url]) => {
      if (!visibleIds.has(id)) {
        URL.revokeObjectURL(url);
        delete attachmentUrlsRef.current[id];
        attachmentLoadingRef.current.delete(id);
      }
    });

    setAttachmentBlobs((prev) => {
      const next: Record<string, AttachmentBlobState> = {};
      for (const id of visibleIds) {
        if (prev[id]) next[id] = prev[id];
      }
      return next;
    });

    visibleSupportAttachments.forEach((att) => {
      if (attachmentUrlsRef.current[att.id] || attachmentLoadingRef.current.has(att.id)) return;

      attachmentLoadingRef.current.add(att.id);
      setAttachmentBlobs((prev) => ({
        ...prev,
        [att.id]: { loading: true },
      }));

      apiClient.get<Blob>(superAttachmentPath(att), { responseType: 'blob' })
        .then(({ data }) => {
          const objectUrl = URL.createObjectURL(data);
          attachmentUrlsRef.current[att.id] = objectUrl;
          setAttachmentBlobs((prev) => ({
            ...prev,
            [att.id]: { url: objectUrl, loading: false },
          }));
        })
        .catch(() => {
          setAttachmentBlobs((prev) => ({
            ...prev,
            [att.id]: { loading: false, error: true },
          }));
        })
        .finally(() => {
          attachmentLoadingRef.current.delete(att.id);
        });
    });
  }, [visibleSupportAttachments]);

  useEffect(() => {
    return () => {
      Object.values(attachmentUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlsRef.current = {};
      attachmentLoadingRef.current.clear();
    };
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

  const saveEditedAttachment = (file: File) => {
    setSelectedAttachments((prev) =>
      prev.map((item, index) => (index === editingAttachmentIndex ? file : item)),
    );
    setEditingAttachmentIndex(null);
  };

  const handleSupportAttachmentSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_ATTACHMENT_FILES - supportReplyAttachments.length;
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
      setSupportReplyAttachments((prev) => [...prev, ...validFiles]);
      setError(null);
    }
    event.target.value = '';
  };

  const removeSupportReplyAttachment = (index: number) => {
    setSupportReplyAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const saveEditedSupportReplyAttachment = (file: File) => {
    setSupportReplyAttachments((prev) =>
      prev.map((item, index) => (index === editingSupportAttachmentIndex ? file : item)),
    );
    setEditingSupportAttachmentIndex(null);
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

  const renderSupportAttachments = (attachments: NotificationAttachment[] | undefined, alignRight: boolean) => {
    if (!attachments || attachments.length === 0) return null;

    return (
      <div className={`mt-3 grid gap-2 ${alignRight ? 'justify-items-end' : ''}`}>
        {attachments.map((attachment) => {
          const blob = attachmentBlobs[attachment.id];
          const href = blob?.url;
          const loadingAttachment = blob?.loading && !blob.url;
          const failed = blob?.error && !blob.url;

          if (isImageAttachment(attachment)) {
            return (
              <div key={attachment.id} className={`overflow-hidden rounded-xl border border-gray-700 bg-gray-900 ${alignRight ? 'ml-auto' : ''}`}>
                {loadingAttachment ? (
                  <div className="flex h-36 w-full max-w-xs items-center justify-center text-xs text-gray-500">
                    Loading image...
                  </div>
                ) : failed || !href ? (
                  <div className="flex h-36 w-full max-w-xs items-center justify-center px-4 text-center text-xs text-red-300">
                    Image could not be loaded.
                  </div>
                ) : (
                  <a href={href} target="_blank" rel="noreferrer" className="block">
                    <img src={href} alt={attachment.fileName} className="max-h-56 w-full max-w-xs object-cover" loading="lazy" />
                  </a>
                )}
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-gray-400">
                  <span className="min-w-0 truncate">{attachment.fileName} - {formatFileSize(attachment.sizeBytes)}</span>
                  {href && <a href={href} download={attachment.fileName} className="shrink-0 text-amber-200 hover:text-amber-100">Download</a>}
                </div>
              </div>
            );
          }

          if (isVideoAttachment(attachment)) {
            return (
              <div key={attachment.id} className={`overflow-hidden rounded-xl border border-gray-700 bg-gray-900 ${alignRight ? 'ml-auto' : ''}`}>
                {loadingAttachment ? (
                  <div className="flex h-44 w-full max-w-sm items-center justify-center text-xs text-gray-500">
                    Loading video...
                  </div>
                ) : failed || !href ? (
                  <div className="flex h-44 w-full max-w-sm items-center justify-center px-4 text-center text-xs text-red-300">
                    Video could not be loaded.
                  </div>
                ) : (
                  <video controls preload="metadata" src={href} className="max-h-72 w-full max-w-sm bg-black" />
                )}
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-gray-400">
                  <span className="min-w-0 truncate">{attachment.fileName} - {formatFileSize(attachment.sizeBytes)}</span>
                  {href && <a href={href} download={attachment.fileName} className="shrink-0 text-amber-200 hover:text-amber-100">Download</a>}
                </div>
              </div>
            );
          }

          return (
            <div key={attachment.id} className={`flex max-w-full items-center gap-3 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-left ${alignRight ? 'ml-auto' : ''}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-xs font-bold text-amber-100">
                {attachment.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-100">{attachment.fileName}</span>
                <span className="block text-xs text-gray-500">
                  {loadingAttachment ? 'Loading...' : failed ? 'Could not load file' : formatFileSize(attachment.sizeBytes)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {href ? (
                  <>
                    <a href={href} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-700 px-2 py-1 text-gray-300 hover:bg-gray-800 hover:text-white">Open</a>
                    <a href={href} download={attachment.fileName} className="rounded-lg bg-amber-600 px-2 py-1 font-semibold text-white hover:bg-amber-500">Download</a>
                  </>
                ) : (
                  <span className="rounded-lg border border-gray-700 px-2 py-1 text-gray-500">
                    {failed ? 'Unavailable' : 'Loading'}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
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
                        {file.type.startsWith('image/') && (
                          <button
                            type="button"
                            onClick={() => setEditingAttachmentIndex(index)}
                            className="rounded px-1.5 py-0.5 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                          >
                            Edit image
                          </button>
                        )}
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
          <div className="overflow-hidden rounded-2xl border border-gray-700 bg-[#17212b]">
            <div className="grid min-h-[28rem] grid-cols-1 xl:grid-cols-[24rem_minmax(0,1fr)]">
              <div className="border-b border-white/5 xl:border-b-0 xl:border-r">
                <div className="border-b border-white/5 bg-[#17212b] p-3">
                  <div className="relative">
                    <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7f91a4]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.1-5.4a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                    </svg>
                    <input
                      value={supportSearch}
                      onChange={(event) => setSupportSearch(event.target.value)}
                      placeholder="Search support messages"
                      className="h-11 w-full rounded-xl border border-white/5 bg-[#223140] pl-10 pr-3 text-sm text-[#e9edef] outline-none placeholder:text-[#7f91a4] focus:border-amber-400/40"
                    />
                  </div>
                </div>
                {filteredSupportThreads.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-[#8da0b3]">No support message matches your search.</p>
                ) : (
                  <div className="max-h-[32rem] overflow-y-auto">
                    {filteredSupportThreads.map((thread) => {
                const selected =
                  selectedSupportThread?.schoolId === thread.schoolId &&
                  selectedSupportThread?.adminUserId === thread.adminUserId;
                return (
                  <button
                    key={`${thread.schoolId}-${thread.adminUserId}`}
                    type="button"
                    onClick={() => void openSupportThread(thread)}
                    className={`flex w-full items-center gap-3 border-b border-white/5 px-3 py-3 text-left transition-colors ${
                      selected
                        ? 'bg-[#223140]'
                        : 'bg-transparent hover:bg-[#1d2a36]'
                    }`}
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-100 ring-1 ring-amber-400/25">
                      {initials(thread.adminName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#f3f6f8]">{thread.adminName}</span>
                        <span className="shrink-0 text-[11px] text-[#7f91a4]">{formatThreadTime(thread.lastAt)}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-[#9fb0c0]">{thread.lastMessage}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#6f8294]">{thread.schoolName} ({thread.schoolCode})</span>
                    </span>
                  </button>
                );
                    })}
                  </div>
                )}
              </div>

              <div className="min-h-[22rem] bg-[#0f1720] p-4">
              {!selectedSupportThread ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
                  Select a school admin conversation.
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <div className="flex flex-col gap-3 border-b border-gray-700 pb-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{selectedSupportThread.adminName}</h3>
                      <p className="text-xs text-gray-400">
                        {selectedSupportThread.schoolName} ({selectedSupportThread.schoolCode})
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleClearSupportThread()}
                      disabled={clearingSupportThread}
                      className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {clearingSupportThread ? 'Clearing...' : 'Clear conversation'}
                    </button>
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
                          {renderSupportAttachments(item.attachments, item.isMine)}
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
                      placeholder="Reply to this school admin, or attach a file..."
                      className="w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <div className="mt-3 rounded-xl border border-dashed border-gray-700 bg-gray-950/70 p-3">
                      <input
                        type="file"
                        multiple
                        accept={ATTACHMENT_ACCEPT}
                        onChange={handleSupportAttachmentSelect}
                        disabled={supportReplyAttachments.length >= MAX_ATTACHMENT_FILES}
                        className="block w-full text-sm text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-500 disabled:opacity-60"
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Attach screenshots, videos, PDFs, Office documents, or text files. Up to {MAX_ATTACHMENT_FILES} files, 10MB each.
                      </p>
                      {supportReplyAttachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {supportReplyAttachments.map((file, index) => (
                            <span key={`${file.name}-${file.size}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300">
                              <span className="max-w-[14rem] truncate">{file.name}</span>
                              <span className="text-gray-500">{formatFileSize(file.size)}</span>
                              {file.type.startsWith('image/') && (
                                <button
                                  type="button"
                                  onClick={() => setEditingSupportAttachmentIndex(index)}
                                  className="rounded px-1.5 py-0.5 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                                >
                                  Edit image
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeSupportReplyAttachment(index)}
                                className="rounded px-1 text-gray-500 hover:bg-red-950/50 hover:text-red-300"
                                aria-label={`Remove ${file.name}`}
                              >
                                x
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSupportReply()}
                        disabled={supportReplying || (!supportReply.trim() && supportReplyAttachments.length === 0)}
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
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-700/80 bg-gray-800/80 p-6 shadow-lg shadow-black/10">
        <div className="mb-5 flex flex-col gap-4 border-b border-gray-700/80 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">Sent updates</h2>
            <p className="text-sm text-gray-400">Edit message/title or remove a platform update from recipients.</p>
          </div>
          <div className="relative w-full lg:w-80">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.1-5.4a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
            </svg>
            <input
              value={sentSearch}
              onChange={(event) => setSentSearch(event.target.value)}
              placeholder="Search sent updates"
              className="h-10 w-full rounded-xl border border-gray-700 bg-gray-950 pl-10 pr-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-amber-400/40"
            />
          </div>
        </div>

        {sentLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading sent updates...</p>
        ) : sent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-700 py-8 text-center text-sm text-gray-500">
            No platform updates sent yet.
          </p>
        ) : filteredSent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-700 py-8 text-center text-sm text-gray-500">
            No sent update matches your search.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-700 bg-[#17212b]">
            {filteredSent.map((item) => {
              const batchId = item.batchId ?? item.id;
              return (
                <div key={batchId} className="flex gap-3 border-b border-white/5 p-4 last:border-b-0">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-100 ring-1 ring-amber-400/25">
                    SA
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-white">{item.title}</h3>
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                          Official
                        </span>
                        {item.updatedAt && (
                          <span className="text-xs italic text-amber-300/80">edited</span>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-400">{previewText(item.message, item.attachments?.length ?? 0)}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>{item.targetScopeLabel || 'Recipients'}</span>
                        <span>{item.recipientCount} user{item.recipientCount === 1 ? '' : 's'}</span>
                        <span>{item.schoolCount} school{item.schoolCount === 1 ? '' : 's'}</span>
                        <span>{formatThreadTime(item.createdAt)}</span>
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

      {editingAttachmentIndex !== null && selectedAttachments[editingAttachmentIndex] && (
        <AttachmentImageEditor
          file={selectedAttachments[editingAttachmentIndex]}
          onCancel={() => setEditingAttachmentIndex(null)}
          onSave={saveEditedAttachment}
        />
      )}
      {editingSupportAttachmentIndex !== null && supportReplyAttachments[editingSupportAttachmentIndex] && (
        <AttachmentImageEditor
          file={supportReplyAttachments[editingSupportAttachmentIndex]}
          onCancel={() => setEditingSupportAttachmentIndex(null)}
          onSave={saveEditedSupportReplyAttachment}
        />
      )}
    </div>
  );
};

export default NotificationsPage;
