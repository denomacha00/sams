import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { prepareImagesForAiUpload } from '../lib/aiImageUpload';
import { useAuthStore } from '../store/authStore';
import AiChartRenderer from './AiChartRenderer';
import { useVoiceBiometrics, loadVoicePrint } from '../hooks/useVoiceBiometrics';

interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
  awaitingSlot?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  pendingAction?: PendingAction;
  isError?: boolean;
  isSystemNotice?: boolean;
}

interface AiThreadRecord {
  id: string;
  message: string;
  response: string;
  createdAt: string;
}

const AI_UNAVAILABLE_INTENTS = new Set(['ai_error', 'ai_not_configured']);
const AI_VISION_FAILURE_INTENTS = new Set(['image_analysis_error', 'ai_not_configured', 'upload_error']);

const CONFIRM_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;
const SUPER_AI_THREAD_STORAGE_KEY = 'sams-super-admin-ai-thread-id';

const SUPER_ADMIN_NAV_TARGETS: Array<{ path: string; label: string; patterns: RegExp[] }> = [
  { path: '/', label: 'Dashboard', patterns: [/dashboard/i, /home/i] },
  { path: '/licenses', label: 'License Management', patterns: [/license(?:s)?(?:\s+management)?/i] },
  { path: '/license-expiry', label: 'License Expiry Engine', patterns: [/license\s+expiry/i, /expiry\s+engine/i] },
  { path: '/schools', label: 'Schools', patterns: [/schools?/i] },
  { path: '/batch-operations', label: 'Batch Operations', patterns: [/batch/i, /bulk/i] },
  { path: '/feature-flags', label: 'Feature Flags', patterns: [/feature\s+flags?/i, /flags?/i] },
  { path: '/revenue', label: 'Revenue', patterns: [/revenue$/i, /payments?/i] },
  { path: '/revenue-forecast', label: 'Revenue Forecast', patterns: [/revenue\s+forecast/i, /forecast/i] },
  { path: '/performance', label: 'Performance Monitor', patterns: [/performance/i, /monitor/i] },
  { path: '/security', label: 'Security Dashboard', patterns: [/security/i] },
  { path: '/audit-logs', label: 'Audit Logs', patterns: [/audit/i, /logs?/i] },
  { path: '/school-admin-activity', label: 'School Admin Activity', patterns: [/admin\s+activity/i] },
  { path: '/brand-templates', label: 'Branding Templates', patterns: [/brand/i, /templates?/i] },
  { path: '/scheduled-jobs', label: 'Scheduled Jobs', patterns: [/scheduled\s+jobs?/i, /jobs?/i, /cron/i] },
  { path: '/data-export', label: 'Data Export', patterns: [/data\s+export/i, /exports?/i] },
  { path: '/knowledge', label: 'Knowledge Base', patterns: [/knowledge/i, /docs?/i, /documentation/i] },
  { path: '/notifications', label: 'Notifications', patterns: [/notifications?/i, /messages?/i, /inbox/i] },
  { path: '/settings', label: 'Settings', patterns: [/settings?/i] },
];

const SUPER_NAV_COMMAND_RE = /\b(?:take|go|open|show|move|navigate|send)\s+(?:me\s+)?(?:to\s+)?(.+)/i;

function detectSuperAdminNavigation(message: string) {
  const match = message.trim().match(SUPER_NAV_COMMAND_RE);
  if (!match) return null;
  const targetText = match[1]?.trim() ?? '';
  return SUPER_ADMIN_NAV_TARGETS.find((target) =>
    target.patterns.some((pattern) => pattern.test(targetText)),
  ) ?? null;
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    content:
      'ðŸ‘‹ Hello, Super Admin! I\'m your AI system assistant. I can help you with:\n\n' +
      'â€¢ **System stats** â€” "how many schools", "total revenue", "platform overview"\n' +
      'â€¢ **School ops** â€” "school info for X", "suspend school Y", "extend license for Z"\n' +
      'â€¢ **Password reset** â€” "reset password for user at school CODE" (temp password or OTP)\n' +
      'â€¢ **Live database** â€” "@db" for platform overview, "@school greenwood" for one school\n' +
      'â€¢ **Server ops** â€” "@status", "@test", "@logs", "@verify", "@readiness", "@secrets", "@diagnose-ai", "@traffic", "@restart-api", "@migrate-status", "@migrate-deploy", "@unlock-users", "@git-pull", "@deploy"\n' +
      'â€¢ **Troubleshooting** â€” "why is a school not working", "common problems"\n' +
      'â€¢ **How-to guides** â€” "how to generate a license", "how to suspend a school"\n' +
      'â€¢ **Platform docs** â€” architecture and features from DOCUMENTATION.md + Knowledge Base\n\n' +
      'I use documentation, knowledge base, live stats, and executable actions â€” **not** source code or repository access. I cannot expose API keys or secrets.\n\n' +
      'Say normal actions directly. For terminal/server commands, start with @. Every server command asks you to confirm before it runs.',
    timestamp: new Date(),
  };
}

function superAiThreadStorageKey(userId?: string): string {
  return userId ? `${SUPER_AI_THREAD_STORAGE_KEY}:${userId}` : SUPER_AI_THREAD_STORAGE_KEY;
}

function loadSuperAiThreadId(userId?: string): string | undefined {
  try {
    return (
      localStorage.getItem(superAiThreadStorageKey(userId)) ||
      localStorage.getItem(SUPER_AI_THREAD_STORAGE_KEY) ||
      undefined
    );
  } catch {
    return undefined;
  }
}

function saveSuperAiThreadId(threadId: string | undefined, userId?: string): void {
  try {
    const key = superAiThreadStorageKey(userId);
    if (threadId) {
      localStorage.setItem(key, threadId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function threadRecordsToMessages(records: AiThreadRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const record of records) {
    const timestamp = new Date(record.createdAt);
    if (record.message?.trim()) {
      messages.push({
        id: `${record.id}-u`,
        role: 'user',
        content: record.message,
        timestamp,
      });
    }
    if (record.response?.trim()) {
      messages.push({
        id: `${record.id}-a`,
        role: 'assistant',
        content: record.response,
        timestamp,
      });
    }
  }
  return messages;
}

function buildMemoryNoticeMessage(notice: string): ChatMessage {
  return {
    id: `memory-notice-${Date.now()}`,
    role: 'assistant',
    content: notice,
    timestamp: new Date(),
    isSystemNotice: true,
  };
}

function messagesToAiHistory(messages: ChatMessage[], maxMessages = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((message) => !message.isSystemNotice)
    .filter((message) => message.id !== 'welcome')
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 2_000),
    }))
    .slice(-maxMessages);
}

const SuperAdminAI: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '👋 Hello, Super Admin! I\'m your AI system assistant. I can help you with:\n\n' +
        '• **System stats** — "how many schools", "total revenue", "platform overview"\n' +
        '• **School ops** — "school info for X", "suspend school Y", "extend license for Z"\n' +
        '• **Password reset** — "reset password for user at school CODE" (temp password or OTP)\n' +
        '• **Live database** — "@db" for platform overview, "@school greenwood" for one school\n' +
        '• **Server ops** — "@status", "@test", "@logs", "@verify", "@readiness", "@secrets", "@diagnose-ai", "@traffic", "@restart-api", "@migrate-status", "@migrate-deploy", "@unlock-users", "@git-pull", "@deploy"\n' +
        '• **Troubleshooting** — "why is a school not working", "common problems"\n' +
        '• **How-to guides** — "how to generate a license", "how to suspend a school"\n' +
        '• **Platform docs** — architecture and features from DOCUMENTATION.md + Knowledge Base\n\n' +
        'I use documentation, knowledge base, live stats, and executable actions — **not** source code or repository access. I cannot expose API keys or secrets.\n\n' +
        'Say normal actions directly. For terminal/server commands, start with @. Every server command asks you to confirm before it runs.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(() => loadSuperAiThreadId(user?.id));
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Voice biometrics ───────────────────────────────────────────────────
  const { verify, isVerifying } = useVoiceBiometrics();
  const [voiceResult, setVoiceResult] = useState<{ match: boolean; score: number } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setThreadId(loadSuperAiThreadId(user?.id));
    setHistoryLoaded(false);
    pendingActionRef.current = null;
    setMessages([createWelcomeMessage()]);
  }, [user?.id]);

  useEffect(() => {
    if (!threadId || historyLoaded) return;
    let cancelled = false;

    void (async () => {
      try {
        const { data } = await apiClient.get(`/ai/conversations/${threadId}`);
        if (cancelled) return;
        const restored = threadRecordsToMessages(data.records ?? []);
        const next: ChatMessage[] = [];
        if (data.memoryNotice) {
          next.push(buildMemoryNoticeMessage(data.memoryNotice));
        }
        if (restored.length > 0) {
          next.push(...restored);
        } else if (next.length === 0) {
          next.push(createWelcomeMessage());
        }
        setMessages(next);
      } catch {
        if (!cancelled) setMessages([createWelcomeMessage()]);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, historyLoaded]);

  const generateId = () => Math.random().toString(36).substring(2, 10);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 4 - selectedImages.length;
    const slice = files.slice(0, remaining);
    if (slice.length === 0) return;

    try {
      const toAdd = await prepareImagesForAiUpload(slice);
      if (toAdd.length === 0) return;

      setSelectedImages((prev) => [...prev, ...toAdd]);
      toAdd.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => setImagePreviews((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      });
    } catch {
      appendAssistant('Could not prepare that photo. Try another image.', undefined, true);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const appendAssistant = (content: string, pendingAction?: PendingAction, isError?: boolean) => {
    if (pendingAction) {
      pendingActionRef.current = pendingAction;
    } else if (!content.includes('Confirm Action')) {
      pendingActionRef.current = null;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        pendingAction,
        isError,
      },
    ]);
  };

  const appendMemoryNotice = (notice?: string) => {
    if (!notice) return;
    setMessages((prev) => {
      if (prev.some((m) => m.isSystemNotice && m.content === notice)) return prev;
      return [...prev, buildMemoryNoticeMessage(notice)];
    });
  };

  const runQuery = async (
    question: string,
    options?: { confirmAction?: boolean; pendingAction?: PendingAction },
  ) => {
    const { data } = await apiClient.post('/ai/query', {
      question,
      threadId,
      history: messagesToAiHistory(messages),
      confirmAction: options?.confirmAction,
      pendingAction: options?.pendingAction,
    });
    if (data.threadId) {
      setThreadId(data.threadId);
      saveSuperAiThreadId(data.threadId, user?.id);
    }
    appendMemoryNotice(data.memoryNotice);

    if (data.pendingAction) {
      appendAssistant(data.answer, data.pendingAction, AI_UNAVAILABLE_INTENTS.has(data.intent));
      return;
    }

    pendingActionRef.current = null;
    appendAssistant(data.answer, undefined, AI_UNAVAILABLE_INTENTS.has(data.intent));
  };

  const clearConversation = async () => {
    setLoading(true);
    try {
      if (threadId) {
        await apiClient.delete(`/ai/conversations/${threadId}`);
      }
    } catch {
      // Still reset the panel if the saved thread was already removed.
    } finally {
      pendingActionRef.current = null;
      setThreadId(undefined);
      saveSuperAiThreadId(undefined, user?.id);
      setSelectedImages([]);
      setImagePreviews([]);
      setMessages([createWelcomeMessage()]);
      setHistoryLoaded(true);
      setLoading(false);
    }
  };

  const handleConfirmAction = async (pending: PendingAction) => {
    setLoading(true);
    try {
      await runQuery('yes', { confirmAction: true, pendingAction: pending });
    } catch (err: any) {
      appendAssistant(
        `❌ Action failed: ${err.response?.data?.error || err.message || 'Unknown error'}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question && selectedImages.length === 0) return;
    if (loading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: question || 'What is in this image?',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      if (selectedImages.length === 0) {
        const navigationTarget = detectSuperAdminNavigation(question);
        if (navigationTarget) {
          navigate(navigationTarget.path);
          appendAssistant(`Opened **${navigationTarget.label}**.`);
          setIsOpen(false);
          return;
        }
      }

      if (selectedImages.length > 0) {
        const formData = new FormData();
        selectedImages.forEach((file) => formData.append('images', file));
        formData.append('question', question || 'What is in this image?');
        if (threadId) formData.append('threadId', threadId);
        setSelectedImages([]);
        setImagePreviews([]);

        const { data } = await apiClient.post('/ai/query-with-image', formData);
        if (data.threadId) {
          setThreadId(data.threadId);
          saveSuperAiThreadId(data.threadId, user?.id);
        }
        appendMemoryNotice(data.memoryNotice);
        appendAssistant(
          data.answer,
          undefined,
          AI_VISION_FAILURE_INTENTS.has(data.intent) || AI_UNAVAILABLE_INTENTS.has(data.intent),
        );
        return;
      }

      const pending = pendingActionRef.current;
      if (CONFIRM_RE.test(question) && pending) {
        await runQuery(question, {
          confirmAction: true,
          pendingAction: pending,
        });
        return;
      }

      if (pending) {
        await runQuery(question, { pendingAction: pending });
        return;
      }

      await runQuery(question);
    } catch (err: any) {
      const status = err.response?.status;
      const answer =
        status === 413
          ? 'Could not send that photo — it is too large for the server. Try one image or a screenshot.'
          : err.response?.data?.answer ||
            err.response?.data?.error ||
            err.message ||
            'Unknown error';
      appendAssistant(`Sorry, I encountered an error: ${answer}`, undefined, true);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
        aria-label="Open Super Admin AI Assistant"
      >
        <span className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-7 h-7"
          >
            <path
              fillRule="evenodd"
              d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z"
              clipRule="evenodd"
            />
          </svg>
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
        </span>
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[420px] h-[600px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="bg-purple-700 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5 text-indigo-200"
              >
                <path
                  fillRule="evenodd"
                  d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <h3 className="text-white font-semibold text-sm">Super Admin AI</h3>
                <p className="text-purple-200 text-xs">System Administrator Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void clearConversation()}
                disabled={loading || (!threadId && messages.length <= 1)}
                className="text-xs text-purple-100 hover:text-white disabled:opacity-40 transition-colors"
                aria-label="Clear AI conversation"
              >
                Clear
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-purple-200 hover:text-white transition-colors"
                aria-label="Close AI panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : msg.isError
                        ? 'bg-red-950 text-red-100 border border-red-600'
                        : 'bg-gray-800 text-gray-200 border border-gray-700'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  <AiChartRenderer content={msg.content} />
                  {msg.pendingAction && (
                    <button
                      onClick={() => void handleConfirmAction(msg.pendingAction!)}
                      disabled={loading}
                      className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium py-1.5 px-3 rounded transition-colors"
                    >
                      ✓ Confirm: {msg.pendingAction.description}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">●</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>●</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>●</span>
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-gray-700 p-3">
            {imagePreviews.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {imagePreviews.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img} alt="Selected" className="h-10 w-10 object-cover rounded border border-gray-600" />
                    <button type="button" onClick={() => removeImage(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px]">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-gray-800 border border-gray-600 text-gray-400 hover:text-white px-2 py-2 rounded-lg transition-colors"
                title="Upload images (max 4)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2 2v10a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedImages.length > 0 ? 'Ask about these images...' : 'Ask or run an admin action...'}
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                disabled={loading}
              />
              <button
                onClick={() => void handleSend()}
                disabled={loading || (!input.trim() && selectedImages.length === 0)}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-2 rounded-lg transition-colors"
                aria-label="Send message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Try: &quot;suspend school Y&quot; • &quot;clear audit logs&quot; • &quot;system stats&quot;
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default SuperAdminAI;
