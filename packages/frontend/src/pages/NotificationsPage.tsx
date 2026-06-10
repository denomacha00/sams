import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  scope?: string | null;
  targetId?: string | null;
  targetRole?: string | null;
  targetScopeLabel?: string | null;
  attachments?: NotificationAttachment[];
}

interface NotificationAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt?: string;
}

interface AttachmentBlobState {
  url?: string;
  loading?: boolean;
  error?: boolean;
}

interface SentNotification extends Notification {
  recipientCount: number;
}

type Folder = 'alerts' | 'inbox' | 'sent';

interface Department {
  id: string;
  name: string;
  classes?: { id: string; name: string }[];
}

type Scope = 'school' | 'department' | 'class';
type Channel = 'inapp';
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'S';
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

function attachmentDownloadPath(att: NotificationAttachment, download = false): string {
  const suffix = download ? '?download=1' : '';
  return `/notifications/attachments/${encodeURIComponent(att.id)}${suffix}`;
}

function collectAttachments(messages: Notification[]): NotificationAttachment[] {
  const seen = new Set<string>();
  const attachments: NotificationAttachment[] = [];
  for (const message of messages) {
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

function renderLinkedText(text: string): React.ReactNode {
  const urlRe = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRe);
  return parts.map((part, index) => {
    if (!part.match(urlRe)) return <React.Fragment key={index}>{part}</React.Fragment>;
    const href = part.startsWith('http') ? part : `https://${part}`;
    return (
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200"
      >
        {part}
      </a>
    );
  });
}

const NotificationsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [sentMessages, setSentMessages] = useState<SentNotification[]>([]);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [loading, setLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(false);
  const [isClassRep, setIsClassRep] = useState(false);
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
  const [selectedAttachments, setSelectedAttachments] = useState<File[]>([]);
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

  // Reply modal (class rep only)
  const [replyingTo, setReplyingTo] = useState<Notification | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [openedNotification, setOpenedNotification] = useState<Notification | null>(null);
  const [attachmentBlobs, setAttachmentBlobs] = useState<Record<string, AttachmentBlobState>>({});
  const attachmentUrlsRef = useRef<Record<string, string>>({});
  const attachmentLoadingRef = useRef<Set<string>>(new Set());

  const canSend = user && ['SCHOOL_ADMIN', 'HOD', 'TEACHER'].includes(user.role);
  const isSchoolAdmin = user?.role === 'SCHOOL_ADMIN';
  const isStudent = user?.role === 'STUDENT';
  const isTeacher = user?.role === 'TEACHER';
  const isHOD = user?.role === 'HOD';
  const notificationChannels: Channel[] = ['inapp'];

  const [departments, setDepartments] = useState<Department[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [hodDepartmentName, setHodDepartmentName] = useState<string | null>(null);
  const [hodScopeError, setHodScopeError] = useState<string | null>(null);

  // Fetch notifications on mount; refresh classId for teachers (JWT may be stale)
  useEffect(() => {
    fetchNotifications();
    if (canSend) fetchScopeData();
    if (user?.role === 'STUDENT') {
      apiClient.get('/users/me').then(({ data }) => setIsClassRep(!!data.isClassRep)).catch(() => {});
    } else if (user?.role === 'TEACHER') {
      apiClient.get('/users/me').then(({ data }) => {
        if (data.classId) {
          updateUser({ classId: data.classId });
        }
        setScope('class');
        setTargetRole('STUDENT');
      }).catch(() => {});
    } else if (user?.role === 'HOD') {
      apiClient.get('/users/me').then(({ data }) => {
        if (data.departmentId) {
          updateUser({ departmentId: data.departmentId });
          setTargetId(data.departmentId);
          setHodScopeError(null);
        } else {
          setHodScopeError(
            'Your account is not linked to a department — contact school admin.',
          );
        }
        if (data.departmentName) setHodDepartmentName(data.departmentName);
      }).catch(() => {});
    }
  }, []);

  // Teachers always send class-scoped messages to students; class choice comes from taught classes.
  useEffect(() => {
    if (user?.role === 'TEACHER') {
      setScope('class');
      setTargetRole('STUDENT');
    }
  }, [user?.role]);

  // HOD: always use JWT/profile department for department-scoped sends (never pick another dept)
  useEffect(() => {
    if (user?.role !== 'HOD') return;
    if (scope === 'department' && user.departmentId) {
      setTargetId(user.departmentId);
    }
  }, [user?.role, user?.departmentId, scope]);

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

    socket.on('notification:updated', (data: { id: string; title?: string; message: string; updatedAt: string }) => {
      setNotifications((prev) =>
        prev.map((n) => n.id === data.id ? { ...n, title: data.title ?? n.title, message: data.message, updatedAt: data.updatedAt } : n)
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

  const fetchSentMessages = async () => {
    if (!canSend) return;
    setSentLoading(true);
    try {
      const { data } = await apiClient.get('/notifications/sent');
      setSentMessages(data);
    } catch { /* ignore */ } finally {
      setSentLoading(false);
    }
  };

  useEffect(() => {
    if (folder === 'sent' && canSend) void fetchSentMessages();
  }, [folder, canSend]);

  const visibleAttachments = useMemo(
    () => collectAttachments([...notifications, ...sentMessages]),
    [notifications, sentMessages],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleAttachments.map((att) => att.id));

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

    visibleAttachments.forEach((att) => {
      if (attachmentUrlsRef.current[att.id] || attachmentLoadingRef.current.has(att.id)) return;

      attachmentLoadingRef.current.add(att.id);
      setAttachmentBlobs((prev) => ({
        ...prev,
        [att.id]: { loading: true },
      }));

      apiClient.get<Blob>(attachmentDownloadPath(att), { responseType: 'blob' })
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
  }, [visibleAttachments]);

  useEffect(() => {
    return () => {
      Object.values(attachmentUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlsRef.current = {};
      attachmentLoadingRef.current.clear();
    };
  }, []);

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
      } else if (user?.role === 'TEACHER') {
        const { data } = await apiClient.get('/users/teaching-classes');
        const taughtClasses = Array.isArray(data) ? data : [];
        setClasses(taughtClasses);
        setScope('class');
        setTargetRole('STUDENT');
        if (taughtClasses.length === 1) {
          setTargetId(taughtClasses[0].id);
        } else if (!taughtClasses.some((c: { id: string }) => c.id === targetId)) {
          setTargetId('');
        }
      } else if (user?.role === 'HOD' && user.departmentId) {
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

  const handleAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const remaining = MAX_ATTACHMENT_FILES - selectedAttachments.length;
    if (remaining <= 0) {
      setSendError(`Attach up to ${MAX_ATTACHMENT_FILES} files.`);
      e.target.value = '';
      return;
    }

    const validFiles: File[] = [];
    for (const file of files.slice(0, remaining)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setSendError(`${file.name} is too large. Each attachment must be 10MB or smaller.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      setSelectedAttachments((prev) => [...prev, ...validFiles]);
      setSendError(null);
    }
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setSelectedAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      const effectiveTargetId =
        user?.role === 'HOD' && scope === 'department'
          ? user.departmentId ?? targetId
          : targetId;

      if (user?.role === 'HOD' && scope === 'department' && !effectiveTargetId) {
        setSendError('Your account is not linked to a department — contact school admin.');
        setSending(false);
        return;
      }

      const formData = new FormData();
      formData.append('scope', scope);
      if (effectiveTargetId) formData.append('targetId', effectiveTargetId);
      if (targetRole !== 'ALL') formData.append('targetRole', targetRole);
      if (title.trim()) formData.append('title', title.trim());
      formData.append('message', message);
      formData.append('channels', JSON.stringify(notificationChannels));
      selectedAttachments.forEach((file) => formData.append('attachments', file));

      const { data } = await apiClient.post(
        '/notifications/send',
        formData,
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
      setSelectedAttachments([]);
      if (user?.role === 'HOD' && scope === 'department' && user.departmentId) {
        setTargetId(user.departmentId);
      } else if (user?.role !== 'TEACHER') {
        setTargetId('');
      }
      if (user?.role !== 'TEACHER') {
        setTargetRole('ALL');
      }
      void fetchNotifications();
      if (folder === 'sent') void fetchSentMessages();
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

  const getScopeOptions = (): Scope[] => {
    if (!user) return [];
    if (user.role === 'SCHOOL_ADMIN') return ['school', 'department', 'class'];
    if (user.role === 'HOD') return ['department', 'class'];
    return ['class'];
  };

  const classOptionsForScope = (): { id: string; name: string }[] => {
    if (user?.role === 'SCHOOL_ADMIN') {
      if (!selectedDepartmentId) return [];
      const selectedDept = departments.find((d) => d.id === selectedDepartmentId);
      return selectedDept?.classes || [];
    }
    return classes;
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
      setSentMessages((prev) =>
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
        setSentMessages((prev) => prev.filter((n) => n.batchId !== deletingNotification.batchId));
      } else {
        await apiClient.delete(`/notifications/${deletingNotification.id}`);
        setNotifications((prev) => prev.filter((n) => n.id !== deletingNotification.id));
        setSentMessages((prev) => prev.filter((n) => n.id !== deletingNotification.id));
      }
      setDeletingNotification(null);
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || 'Failed to delete notification');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleReply = async () => {
    if (!replyingTo) return;
    if (replyMessage.trim().length < 1) {
      setReplyError('Message is required');
      return;
    }
    setReplyLoading(true);
    setReplyError(null);
    try {
      await apiClient.post('/notifications/reply', {
        parentNotificationId: replyingTo.id,
        message: replyMessage.trim(),
      });
      setReplyingTo(null);
      setReplyMessage('');
    } catch (err: any) {
      setReplyError(err.response?.data?.error || 'Failed to send reply');
    } finally {
      setReplyLoading(false);
    }
  };

  const isOwnSentMessage = (notif: Notification): boolean => {
    if (!user) return false;
    return !!notif.senderId && notif.senderId === user.id;
  };

  const openMessage = (notif: Notification, isSentFolder: boolean) => {
    if (!isSentFolder && !notif.read) {
      void markAsRead(notif.id);
    }
    setOpenedNotification(isSentFolder ? null : { ...notif, read: true });
  };

  const alertMessages = notifications.filter((n) => n.type !== 'MESSAGE' || !n.senderId);
  const inboxMessages = notifications.filter((n) => n.type === 'MESSAGE' && !!n.senderId);
  const inboxUnreadCount = inboxMessages.filter((n) => !n.read).length;
  const alertsUnreadCount = alertMessages.filter((n) => !n.read).length;
  const totalUnreadCount = notifications.filter((n) => !n.read).length;
  const folderUnreadCount =
    folder === 'alerts' ? alertsUnreadCount :
    folder === 'inbox' ? inboxUnreadCount :
    0;
  const displayList =
    folder === 'alerts' ? alertMessages :
    folder === 'inbox' ? inboxMessages :
    sentMessages;
  const listLoading = folder === 'sent' ? sentLoading : loading;

  const renderAttachments = (attachments: NotificationAttachment[] | undefined, isSentFolder: boolean) => {
    if (!attachments || attachments.length === 0) return null;

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className={`mt-3 grid gap-2 ${isSentFolder ? 'justify-items-end' : ''}`}
      >
        {attachments.map((att) => {
          const blob = attachmentBlobs[att.id];
          const href = blob?.url;
          const loading = blob?.loading && !blob.url;
          const failed = blob?.error && !blob.url;
          if (isImageAttachment(att)) {
            return (
              <div
                key={att.id}
                className={`block overflow-hidden rounded-xl border border-line bg-surface-elevated hover:border-indigo-500/40 transition-all ${isSentFolder ? 'ml-auto' : ''}`}
              >
                {loading ? (
                  <div className="flex h-36 w-full max-w-xs items-center justify-center text-xs text-ink-subtle">
                    Loading image...
                  </div>
                ) : failed || !href ? (
                  <div className="flex h-36 w-full max-w-xs items-center justify-center px-4 text-center text-xs text-red-300">
                    Image could not be loaded. Refresh and try again.
                  </div>
                ) : (
                  <a href={href} target="_blank" rel="noreferrer" className="block">
                    <img
                      src={href}
                      alt={att.fileName}
                      className="max-h-56 w-full max-w-xs object-cover"
                      loading="lazy"
                    />
                  </a>
                )}
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-ink-muted">
                  <span className="min-w-0 truncate">{att.fileName} - {formatFileSize(att.sizeBytes)}</span>
                  {href && (
                    <a href={href} download={att.fileName} className="shrink-0 text-indigo-300 hover:text-indigo-200">
                      Download
                    </a>
                  )}
                </div>
              </div>
            );
          }

          if (isVideoAttachment(att)) {
            return (
              <div
                key={att.id}
                className={`block overflow-hidden rounded-xl border border-line bg-surface-elevated hover:border-indigo-500/40 transition-all ${isSentFolder ? 'ml-auto' : ''}`}
              >
                {loading ? (
                  <div className="flex h-44 w-full max-w-sm items-center justify-center text-xs text-ink-subtle">
                    Loading video...
                  </div>
                ) : failed || !href ? (
                  <div className="flex h-44 w-full max-w-sm items-center justify-center px-4 text-center text-xs text-red-300">
                    Video could not be loaded. Refresh and try again.
                  </div>
                ) : (
                  <video
                    controls
                    preload="metadata"
                    src={href}
                    className="max-h-72 w-full max-w-sm bg-black"
                  />
                )}
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-ink-muted">
                  <span className="min-w-0 truncate">{att.fileName} - {formatFileSize(att.sizeBytes)}</span>
                  {href && (
                    <a href={href} download={att.fileName} className="shrink-0 text-indigo-300 hover:text-indigo-200">
                      Download
                    </a>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={att.id}
              className={`flex items-center gap-3 rounded-xl border border-line bg-surface-elevated px-3 py-2 text-left hover:border-indigo-500/40 transition-all max-w-full ${isSentFolder ? 'ml-auto' : ''}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-xs font-bold text-indigo-200">
                {att.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{att.fileName}</span>
                <span className="block text-xs text-ink-subtle">
                  {loading ? 'Loading...' : failed ? 'Could not load file' : formatFileSize(att.sizeBytes)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-line px-2 py-1 text-ink-muted hover:text-ink hover:bg-white/10"
                  >
                    Open
                  </a>
                ) : (
                  <span className="rounded-lg border border-line px-2 py-1 text-ink-subtle">
                    {failed ? 'Unavailable' : 'Loading'}
                  </span>
                )}
                {href && (
                  <a
                    href={href}
                    download={att.fileName}
                    className="rounded-lg bg-indigo-600 px-2 py-1 font-semibold text-white hover:bg-indigo-500"
                  >
                    Download
                  </a>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderMessageCard = (notif: Notification, isSentFolder: boolean) => {
    const isSuperAdminNotice = notif.type === 'SUPER_ADMIN';
    const senderDisplay = isSuperAdminNotice
      ? 'SAMS Super Admin'
      : truncateName(notif.senderName || (notif.senderId === null ? 'System' : 'Deleted User'));
    const roleDisplay = isSuperAdminNotice ? 'Super Admin' : formatRole(notif.senderRole);
    const isOwn = isOwnSentMessage(notif);
    // Edit/delete only on Sent tab, only own messages; school admin bypasses 24h window
    const canModify =
      isSentFolder &&
      isOwn &&
      notif.senderId === user?.id &&
      (!!isSchoolAdmin || isWithin24Hours(notif.createdAt));
    const windowExpired = isSentFolder && isOwn && !isSchoolAdmin && !isWithin24Hours(notif.createdAt);
    const canReply = !isSentFolder && isClassRep && notif.senderRole === 'TEACHER' && !!notif.senderId;
    const recipientCount = isSentFolder ? (notif as SentNotification).recipientCount : undefined;

    const unread = !isSentFolder && !notif.read;
    const cardClass = isSuperAdminNotice
      ? unread
        ? 'border-amber-400/60 bg-amber-500/12 shadow-card-soft-hover'
        : 'border-amber-400/30 bg-amber-500/8 shadow-card-soft hover:border-amber-400/45'
      : unread
        ? 'border-indigo-500/35 bg-indigo-500/10 shadow-card-soft-hover'
        : 'border-line bg-surface shadow-card-soft hover:border-indigo-500/25';
    const bubbleClass = isSuperAdminNotice && !isSentFolder
      ? 'max-w-[92%] bg-amber-500/12 border-amber-400/25 text-amber-50'
      : isSentFolder
        ? 'ml-auto max-w-[92%] bg-indigo-600/18 border-indigo-500/25 text-indigo-50'
        : 'max-w-[92%] bg-surface-muted border-line text-ink-muted';
    const pathLabel = isSentFolder
      ? `You → ${notif.targetScopeLabel ?? 'Recipients'}`
      : `${senderDisplay} → You`;

    return (
      <div
        key={notif.id}
        onClick={() => openMessage(notif, isSentFolder)}
        className={`group rounded-2xl border p-4 transition-all ${isSentFolder ? '' : 'cursor-pointer'} ${cardClass}`}
      >
        <div className={`flex items-start gap-3 ${isSentFolder ? 'flex-row-reverse' : ''}`}>
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-bold shrink-0 ${
            isSentFolder
              ? 'bg-indigo-600 text-white'
              : isSuperAdminNotice
                ? 'bg-amber-500/20 text-amber-100 border border-amber-400/30'
                : 'bg-surface-elevated text-ink border border-line'
          }`}>
            {isSentFolder ? 'ME' : isSuperAdminNotice ? 'SA' : initials(senderDisplay)}
          </div>

          <div className={`flex-1 min-w-0 ${isSentFolder ? 'text-right' : ''}`}>
            <div className={`flex items-center gap-2 flex-wrap ${isSentFolder ? 'justify-end' : ''}`}>
              {unread && <div className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />}
              <h3 className="text-sm font-semibold text-ink truncate max-w-full">{notif.title || 'Message'}</h3>
              {isSuperAdminNotice && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/25">
                  SAMS update
                </span>
              )}
              {notif.updatedAt && <span className="text-xs text-amber-400/80 italic">edited</span>}
              {recipientCount != null && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated text-ink-muted border border-line">
                  {recipientCount} recipient{recipientCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className={`mt-1 flex items-center gap-2 flex-wrap text-xs text-ink-subtle ${isSentFolder ? 'justify-end' : ''}`}>
              <span>{pathLabel}</span>
              {roleDisplay && !isSentFolder && <span className="px-1.5 py-0.5 rounded-full bg-white/5 border border-white/5">{roleDisplay}</span>}
              <span>·</span>
              <span>{formatDateTime(notif.createdAt)}</span>
              {notif.updatedAt && <span>· edited {formatDateTime(notif.updatedAt)}</span>}
            </div>

            {notif.targetScopeLabel && (isSentFolder || isTeacher || isHOD) && (
              <div className={`mt-2 ${isSentFolder ? 'flex justify-end' : ''}`}>
                <span className="inline-flex text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-200 border border-indigo-500/20">
                  {isSentFolder ? `Sent to ${notif.targetScopeLabel}` : notif.targetScopeLabel}
                </span>
              </div>
            )}

            <div className={`mt-3 rounded-2xl px-4 py-3 border ${bubbleClass}`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{renderLinkedText(notif.message)}</p>
            </div>
            {renderAttachments(notif.attachments, isSentFolder)}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {canReply && (
              <button onClick={(e) => { e.stopPropagation(); setReplyingTo(notif); setReplyMessage(''); setReplyError(null); }}
                className="px-2 py-1 text-xs rounded-lg bg-indigo-600/20 text-brand hover:bg-indigo-600/30 border border-indigo-500/30 transition-all">
                Reply
              </button>
            )}
            {canModify && (
              <>
                <div className="relative group">
                  <button onClick={(e) => { e.stopPropagation(); if (canModify) { setEditingNotification(notif); setEditMessage(notif.message); setEditError(null); } }}
                    disabled={!canModify}
                    className={`p-1.5 rounded-lg transition-all ${canModify ? 'hover:bg-white/10 text-ink-muted hover:text-brand' : 'text-ink-muted cursor-not-allowed'}`}>
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
                    className={`p-1.5 rounded-lg transition-all ${canModify ? 'hover:bg-white/10 text-ink-muted hover:text-red-400' : 'text-ink-muted cursor-not-allowed'}`}>
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
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page-shell p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink flex items-center gap-3">
              Message Center
              {totalUnreadCount > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-600 text-white min-w-[1.5rem]">
                  {totalUnreadCount}
                </span>
              )}
            </h1>
            <p className="text-ink-muted text-sm mt-1">
              {isStudent
                ? 'Follow school messages. Class representatives can reply to class teachers.'
                : 'Inbox, sent messages, and class/department broadcasts in one clean path.'}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex rounded-xl border border-line overflow-hidden">
              <button
                onClick={() => setFolder('alerts')}
                className={`px-3 py-2 text-sm transition-all ${folder === 'alerts' ? 'bg-indigo-600 text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-elevated'}`}
              >
                Alerts{alertsUnreadCount > 0 ? ` (${alertsUnreadCount})` : ''}
              </button>
              <button
                onClick={() => setFolder('inbox')}
                className={`px-3 py-2 text-sm transition-all ${folder === 'inbox' ? 'bg-indigo-600 text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-elevated'}`}
              >
                Inbox{inboxUnreadCount > 0 ? ` (${inboxUnreadCount})` : ''}
              </button>
              {canSend && (
                <button
                  onClick={() => setFolder('sent')}
                  className={`px-3 py-2 text-sm transition-all ${folder === 'sent' ? 'bg-indigo-600 text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-elevated'}`}
                >
                  Sent
                </button>
              )}
            </div>
            {folder !== 'sent' && folderUnreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="px-3 py-2 text-sm text-ink-muted hover:text-ink border border-line rounded-xl hover:bg-surface-elevated transition-all"
              >
                Mark all read
              </button>
            )}
            {canSend && (
              <button
                onClick={() => setShowSendForm(!showSendForm)}
                className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-500 transition-colors"
              >
                {showSendForm ? 'Cancel' : 'Send Message'}
              </button>
            )}
          </div>
        </div>

        {isStudent && (
          <div className="mb-6 p-4 rounded-2xl border border-line bg-surface shadow-card-soft text-sm text-ink-muted">
            You can read messages from teachers, HODs, and school admin here. If you are the class representative, replies go only to the teacher who messaged your class.
          </div>
        )}

        {/* Send Form */}
        {showSendForm && canSend && (
          <div className="mb-8 surface-card p-6 shadow-card-soft">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">Compose message</h2>
                <p className="text-xs text-ink-subtle mt-1">Choose the audience path first, then write the message.</p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full border border-indigo-500/25 bg-indigo-500/10 text-indigo-200">
                In-App
              </span>
            </div>
            {sendSuccess && (
              <div className="mb-4 p-3 bg-indigo-500/20 border border-indigo-400/30 rounded-xl">
                <p className="text-sm text-indigo-300 text-center">
                  Message delivered in-app. Recipients see it under Notifications (bell icon).
                </p>
              </div>
            )}
            {sendError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl">
                <p className="text-sm text-red-300 text-center">{sendError}</p>
              </div>
            )}
            {isHOD && hodScopeError && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl">
                <p className="text-sm text-amber-300 text-center">{hodScopeError}</p>
              </div>
            )}
            <form onSubmit={handleSend} className="space-y-4">
              {/* Scope */}
              <div>
                <label className="block text-sm font-semibold text-ink-muted mb-1.5">Send to</label>
                <select value={scope} onChange={(e) => {
                  const next = e.target.value as Scope;
                  setScope(next);
                  setTargetRole(user?.role === 'TEACHER' ? 'STUDENT' : 'ALL');
                  setSelectedDepartmentId('');
                  if (user?.role === 'HOD' && next === 'department' && user.departmentId) {
                    setTargetId(user.departmentId);
                  } else {
                    setTargetId('');
                  }
                }}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
                  {getScopeOptions().map((s) => (
                    <option key={s} value={s} className="bg-slate-800">
                      {s === 'school' ? 'Whole School' : s === 'department' ? 'Department' : 'Class'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target role filter */}
              <div>
                <label className="block text-sm font-semibold text-ink-muted mb-1.5">Who receives it</label>
                <select value={targetRole} onChange={(e) => setTargetRole(e.target.value as TargetRole)}
                  className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
                  {getTargetRoleOptions().map((o) => (
                    <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Department / Class picker */}
              {scope !== 'school' && (
                <div>
                  <label className="block text-sm font-semibold text-ink-muted mb-1.5">
                    {scope === 'department' ? 'Department' : 'Class *'}
                  </label>
                  {scope === 'department' && isHOD && (
                    <p className="w-full surface-card border-line rounded-xl px-4 py-3 text-ink-muted">
                      {hodDepartmentName
                        ? `Your department: ${hodDepartmentName}`
                        : user?.departmentId
                          ? 'Your department (from your account)'
                          : 'Department not linked to your account'}
                    </p>
                  )}
                  {scope === 'department' && !isHOD && (
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                      className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
                      <option value="" className="bg-slate-800">-- Select Department --</option>
                      {departments.map((d) => <option key={d.id} value={d.id} className="bg-slate-800">{d.name}</option>)}
                    </select>
                  )}
                  {scope === 'class' && (
                    <div className="space-y-3">
                      {user?.role === 'SCHOOL_ADMIN' && (
                        <div>
                          <label className="block text-sm font-semibold text-ink-muted mb-1.5">Department *</label>
                          <select
                            value={selectedDepartmentId}
                            onChange={(e) => {
                              setSelectedDepartmentId(e.target.value);
                              setTargetId('');
                            }}
                            className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                          >
                            <option value="" className="bg-slate-800">-- Select Department --</option>
                            {departments.map((d) => <option key={d.id} value={d.id} className="bg-slate-800">{d.name}</option>)}
                          </select>
                        </div>
                      )}
                      <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                        disabled={user?.role === 'SCHOOL_ADMIN' && !selectedDepartmentId}
                        className="w-full input-field focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                        <option value="" className="bg-slate-800">-- Select Class --</option>
                        {classOptionsForScope().map((c) => <option key={c.id} value={c.id} className="bg-slate-800">{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-sm font-semibold text-ink-muted mb-1.5">Title <span className="text-ink-subtle font-normal">(optional)</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
                  placeholder="e.g. Exam Reminder"
                  className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" />
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-semibold text-ink-muted mb-1.5">Message *</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4}
                  className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all resize-none"
                  placeholder="Type your message..." />
              </div>

              {/* Attachments */}
              <div>
                <label className="block text-sm font-semibold text-ink-muted mb-1.5">Attachments</label>
                <div className="rounded-xl border border-dashed border-line bg-surface-muted/60 p-4">
                  <input
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    onChange={handleAttachmentSelect}
                    disabled={selectedAttachments.length >= MAX_ATTACHMENT_FILES}
                    className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-500 disabled:opacity-60"
                  />
                  <p className="mt-2 text-xs text-ink-subtle">
                    Add images, videos, PDFs, Office documents, or text files. Up to {MAX_ATTACHMENT_FILES} files, 10MB each.
                  </p>
                  {selectedAttachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedAttachments.map((file, index) => (
                        <span
                          key={`${file.name}-${file.size}-${index}`}
                          className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface-elevated px-2.5 py-1.5 text-xs text-ink-muted"
                        >
                          <span className="truncate max-w-[14rem]">{file.name}</span>
                          <span className="text-ink-subtle">{formatFileSize(file.size)}</span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(index)}
                            className="rounded px-1 text-ink-subtle hover:bg-white/10 hover:text-red-300"
                            aria-label={`Remove ${file.name}`}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Channels */}
              <div>
                <label className="block text-sm font-semibold text-ink-muted mb-1.5">Send via</label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked readOnly disabled
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500/40 disabled:opacity-80" />
                    <span className="text-sm text-ink-muted">In-App</span>
                  </label>
                  <p className="text-xs text-ink-subtle">
                    SMS is reserved for password reset while provider limits are being upgraded.
                  </p>
                </div>
              </div>

              <button type="submit" disabled={
                sending ||
                !message.trim() ||
                (scope !== 'school' && !(isHOD && scope === 'department' ? user?.departmentId : targetId)) ||
                (isHOD && !!hodScopeError && scope === 'department')
              }
                className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {sending ? 'Sending...' : 'Send Notification'}
              </button>
            </form>
          </div>
        )}

        {/* Message List */}
        {listLoading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : displayList.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-ink-muted mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-ink-muted">{folder === 'inbox' ? 'No messages in your inbox' : 'No sent messages yet'}</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-line bg-surface/70 p-3 sm:p-4 shadow-card-soft space-y-3">
            {displayList.map((notif) => renderMessageCard(notif, folder === 'sent'))}
          </div>
        )}
      </div>

      {/* Opened inbox message */}
      {openedNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpenedNotification(null)} />
          <div className="relative max-h-[88vh] w-full max-w-2xl overflow-y-auto bg-surface border border-line rounded-2xl p-5 shadow-card-hover">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle mb-1">Inbox</p>
                <h2 className="text-lg font-semibold text-ink truncate">{openedNotification.title || 'Message'}</h2>
                <p className="text-xs text-ink-subtle mt-1">
                  {openedNotification.senderName || 'System'} · {formatDateTime(openedNotification.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setOpenedNotification(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-white/10 hover:text-ink"
              >
                Close
              </button>
            </div>

            <div className="rounded-2xl border border-line bg-surface-muted px-4 py-3 text-sm leading-relaxed text-ink-muted whitespace-pre-wrap">
              {renderLinkedText(openedNotification.message)}
            </div>
            {renderAttachments(openedNotification.attachments, false)}

            {isClassRep && openedNotification.senderRole === 'TEACHER' && openedNotification.senderId && (
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => {
                    setReplyingTo(openedNotification);
                    setReplyMessage('');
                    setReplyError(null);
                    setOpenedNotification(null);
                  }}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Reply to teacher
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reply Modal (class rep) */}
      {replyingTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReplyingTo(null)} />
          <div className="relative w-full max-w-lg bg-surface border border-line rounded-2xl p-6 shadow-card-hover">
            <h2 className="text-lg font-semibold text-ink mb-1">Reply to {replyingTo.senderName}</h2>
            <p className="text-xs text-ink-subtle mb-4">Your reply goes only to this teacher.</p>
            {replyError && <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl"><p className="text-sm text-red-300">{replyError}</p></div>}
            <textarea value={replyMessage} onChange={(e) => setReplyMessage(e.target.value)} rows={4} maxLength={1000}
              className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all resize-none"
              placeholder="Type your reply..." />
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setReplyingTo(null)} className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface-muted border border-line rounded-xl hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={handleReply} disabled={replyLoading || !replyMessage.trim()}
                className="px-4 py-2 text-sm font-semibold text-ink bg-indigo-600 rounded-xl hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {replyLoading ? 'Sending...' : 'Send Reply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingNotification && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingNotification(null)} />
          <div className="relative w-full max-w-lg bg-surface border border-line rounded-2xl p-6 shadow-card-hover">
            <h2 className="text-lg font-semibold text-ink mb-4">Edit Notification</h2>
            {editError && <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl"><p className="text-sm text-red-300">{editError}</p></div>}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-ink-muted mb-1.5">Message</label>
              <textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={5} maxLength={1000}
                className="w-full input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand/40/40 transition-all resize-none" />
              <p className="text-xs text-ink-subtle mt-1 text-right">{editMessage.length}/1000</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditingNotification(null)} className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface-muted border border-line rounded-xl hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={handleEdit} disabled={editLoading || editMessage.trim().length < 1}
                className="px-4 py-2 text-sm font-semibold text-ink bg-gradient-to-r from-indigo-500 to-indigo-700 rounded-xl hover:from-indigo-400 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
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
          <div className="relative w-full max-w-md bg-surface border border-line rounded-2xl p-6 shadow-card-hover">
            <h2 className="text-lg font-semibold text-ink mb-2">Delete Notification</h2>
            <p className="text-sm text-ink-muted mb-6">
              {deletingNotification.batchId
                ? 'This will remove the message for all recipients. Cannot be undone.'
                : 'This will remove this notification. Cannot be undone.'}
            </p>
            {deleteError && <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl"><p className="text-sm text-red-300">{deleteError}</p></div>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeletingNotification(null)} className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface-muted border border-line rounded-xl hover:bg-white/10 transition-all">Cancel</button>
              <button onClick={handleDelete} disabled={deleteLoading}
                className="px-4 py-2 text-sm font-semibold text-ink bg-gradient-to-r from-red-600 to-red-700 rounded-xl hover:from-red-500 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
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
