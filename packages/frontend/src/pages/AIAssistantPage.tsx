import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { useVoiceQuery } from '../hooks/useVoiceQuery';
import { useAuthStore } from '../store/authStore';
import {
  buildMemoryNoticeMessage,
  getAiAuthHint,
  getAiErrorMessage,
  isAiAuthIntent,
  isAiUnavailableIntent,
  isAiUploadErrorIntent,
  isAiVisionFailureIntent,
  loadAiThreadId,
  messagesToAiHistory,
  saveAiThreadId,
  threadRecordsToMessages,
  type AiActionData,
  type AiChatMessage,
} from '../lib/aiChat';
import { prepareImagesForAiUpload } from '../lib/aiImageUpload';
import { AiMessageContent } from '../lib/aiMessageContent';
import { readAccessToken } from '../lib/authTokens';
import { detectAiNavigationRequest } from '../lib/aiNavigation';
import { applyAiThemeCommand, detectAiThemeRequest } from '../lib/aiThemeCommand';

interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
  awaitingSlot?: string;
}

interface Message extends AiChatMessage {
  userImages?: string[];
  pendingAction?: PendingAction;
  actionData?: AiActionData;
  isError?: boolean;
}

const SUGGESTED_QUESTIONS = [
  'What is the overall attendance rate this week?',
  'Which students are at risk?',
  'Show me attendance trends',
  'How many sessions were held today?',
];

const CONFIRM_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;

const AIAssistantPage: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const threadOwner = useMemo(
    () => user ? { userId: user.id, schoolId: user.schoolId, role: user.role } : null,
    [user?.id, user?.schoolId, user?.role],
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(() => loadAiThreadId(threadOwner));
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

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
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Could not prepare that photo. Try another image.',
        timestamp: new Date(),
        isError: true,
      }]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const clearImages = () => {
    setSelectedImages([]);
    setImagePreviews([]);
  };

  const downloadAiFile = async (download: NonNullable<AiActionData['download']>) => {
    if (!download.endpoint.startsWith('/reports/')) {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'I blocked that download because it is not a supported SAMS report export.',
        timestamp: new Date(),
        isError: true,
      }]);
      return;
    }

    const { data } = await apiClient.get(download.endpoint, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = download.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    setThreadId(loadAiThreadId(threadOwner));
    setHistoryLoaded(false);
    pendingActionRef.current = null;
    setMessages([]);
  }, [threadOwner]);

  // Restore encrypted thread history after refresh.
  useEffect(() => {
    if (!threadId || historyLoaded) return;
    let cancelled = false;

    void (async () => {
      try {
        const { data } = await apiClient.get(`/ai/conversations/${threadId}`);
        if (cancelled) return;
        const restored = threadRecordsToMessages(data.records ?? []);
        const next: Message[] = [];
        if (data.memoryNotice) {
          next.push(buildMemoryNoticeMessage(data.memoryNotice));
        }
        if (restored.length > 0) {
          next.push(...restored);
        }
        setMessages(next);
      } catch {
        // Keep empty — user can start fresh
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, historyLoaded]);

  const appendMemoryNotice = (notice?: string) => {
    if (!notice) return;
    setMessages((prev) => {
      if (prev.some((m) => m.isSystemNotice && m.content === notice)) return prev;
      return [...prev, buildMemoryNoticeMessage(notice)];
    });
  };

  const clearConversation = async () => {
    setLoading(true);
    try {
      if (threadId && readAccessToken()) {
        await apiClient.delete(`/ai/conversations/${threadId}`);
      }
    } catch {
      // Local reset still helps if the server-side thread was already gone.
    } finally {
      pendingActionRef.current = null;
      setThreadId(null);
      saveAiThreadId(null, threadOwner);
      setMessages([]);
      setHistoryLoaded(true);
      clearImages();
      setLoading(false);
    }
  };

  const confirmPendingAction = async (pending: PendingAction) => {
    setLoading(true);
    try {
      const { data } = await apiClient.post('/ai/query', {
        question: 'yes',
        threadId,
        history: messagesToAiHistory(messages),
        confirmAction: true,
        pendingAction: pending,
      });
      if (data.threadId) {
        setThreadId(data.threadId);
        saveAiThreadId(data.threadId, threadOwner);
      }
      pendingActionRef.current = null;
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        actionData: data.data,
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I could not complete that action.',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const submitQuery = async (text: string) => {
    if (!text.trim() && selectedImages.length === 0) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim() || 'What is in this image?',
      userImages: imagePreviews.length > 0 ? [...imagePreviews] : undefined,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const themeCommand = selectedImages.length === 0 ? detectAiThemeRequest(text) : null;
      if (themeCommand) {
        applyAiThemeCommand(themeCommand);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Changed to **${themeCommand.label}**.`,
          timestamp: new Date(),
        }]);
        return;
      }

      const navigationTarget = selectedImages.length === 0 ? detectAiNavigationRequest(text) : null;
      if (navigationTarget) {
        navigate(navigationTarget.path);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Opened **${navigationTarget.label}**.`,
          timestamp: new Date(),
        }]);
        return;
      }

      if (selectedImages.length > 0) {
        const formData = new FormData();
        selectedImages.forEach((file) => formData.append('images', file));
        formData.append('question', text.trim() || 'What is in this image?');
        if (threadId) formData.append('threadId', threadId);
        clearImages();
        const { data } = await apiClient.post('/ai/query-with-image', formData);
        if (data.threadId) {
          setThreadId(data.threadId);
          saveAiThreadId(data.threadId, threadOwner);
        }
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer,
          timestamp: new Date(),
          actionData: data.data,
          isError:
            isAiUploadErrorIntent(data.intent) ||
            isAiVisionFailureIntent(data.intent) ||
            isAiUnavailableIntent(data.intent),
        }]);
        return;
      }

      if (!readAccessToken()) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'No sign-in token was found for this browser. Please sign in again to use school data in AI.',
          timestamp: new Date(),
          isError: true,
        }]);
        return;
      }

      const isConfirm = CONFIRM_RE.test(text.trim()) && pendingActionRef.current;
      const pending = pendingActionRef.current;
      const history = messagesToAiHistory(messages);
      const { data } = await apiClient.post('/ai/query', {
        question: text.trim(),
        threadId,
        history,
        ...(isConfirm && pending
          ? { confirmAction: true, pendingAction: pending }
          : pending
            ? { pendingAction: pending }
            : {}),
      });
      if (data.threadId) {
        setThreadId(data.threadId);
        saveAiThreadId(data.threadId, threadOwner);
      }
      appendMemoryNotice(data.memoryNotice);

      if (data.pendingAction) {
        pendingActionRef.current = data.pendingAction;
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer,
          timestamp: new Date(),
          pendingAction: data.pendingAction,
          actionData: data.data,
        }]);
        return;
      }

      pendingActionRef.current = null;
      const authHint = getAiAuthHint(data.intent);
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: authHint ?? data.answer,
        timestamp: new Date(),
        actionData: data.data,
        isError: isAiUnavailableIntent(data.intent) || isAiAuthIntent(data.intent),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: getAiErrorMessage(err, 'Sorry, I encountered an error. Please try again.'),
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const { isListening, startListening, stopListening } = useVoiceQuery(submitQuery);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuery(input);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="page-shell flex flex-col">
      {/* Header */}
      <div className="inner-page-header px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink">AI Assistant</h1>
              <p className="text-xs text-ink-muted">Ask questions about attendance, reports, or get insights</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void clearConversation()}
            disabled={loading || (!threadId && messages.length === 0)}
            className="btn-secondary px-3 py-2 text-xs disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-light border border-line mb-4">
                <svg className="w-8 h-8 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="text-ink text-lg font-medium mb-1">How can I help you today?</p>
              <p className="text-ink-subtle text-sm mb-8">
                Ask about attendance trends, student performance, or any school data.
              </p>

              {/* Suggested questions */}
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submitQuery(q)}
                    className="px-4 py-2 bg-surface-muted border border-line rounded-xl text-sm text-ink-muted hover:bg-surface-elevated hover:border-line-strong transition-all duration-200"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3.5 ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/20'
                    : msg.isError
                      ? 'bg-red-950/50 border border-red-500/40 text-red-200'
                      : msg.isSystemNotice
                        ? 'bg-indigo-950/50 border border-indigo-500/40 text-indigo-300'
                        : 'bg-surface-muted border border-line text-ink'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <AiMessageContent content={msg.content} className="whitespace-pre-wrap text-sm" />
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                )}
                {msg.userImages && msg.userImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {msg.userImages.map((src, i) => (
                      <img key={i} src={src} alt="" className="max-h-24 rounded-lg border border-white/10" />
                    ))}
                  </div>
                )}
                {msg.pendingAction && (
                  <button
                    type="button"
                    onClick={() => void confirmPendingAction(msg.pendingAction!)}
                    disabled={loading}
                    className="mt-3 w-full px-3 py-2 text-xs font-semibold rounded-xl bg-orange-500/90 hover:bg-orange-600 text-white disabled:opacity-50"
                  >
                    Confirm: {msg.pendingAction.description}
                  </button>
                )}
                {msg.actionData?.download && (
                  <button
                    type="button"
                    onClick={() => void downloadAiFile(msg.actionData!.download!)}
                    className="mt-3 w-full px-3 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    {msg.actionData.download.label}
                  </button>
                )}
                <p
                  className={`text-xs mt-2 ${
                    msg.role === 'user' ? 'text-indigo-200/70' : 'text-ink-subtle'
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface-muted border border-line rounded-2xl px-5 py-4">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-line bg-surface px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {imagePreviews.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {imagePreviews.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="" className="h-16 w-16 object-cover rounded-lg border border-white/10" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || selectedImages.length >= 4}
              className="p-3 rounded-xl bg-surface-muted text-ink-muted border border-line hover:bg-surface-elevated hover:text-ink disabled:opacity-50"
              title="Upload images (max 4)"
              aria-label="Upload images"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedImages.length > 0 ? 'Ask about these images...' : 'Type your question...'}
              disabled={loading}
              className="flex-1 input-field placeholder-ink-subtle focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 transition-all duration-200"
            />

            {/* Voice input button */}
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className={`relative p-3 rounded-xl transition-all duration-200 ${
                isListening
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'bg-surface-muted text-ink-muted border border-line hover:bg-surface-elevated hover:text-ink'
              }`}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              {isListening && (
                <span className="absolute inset-0 rounded-xl bg-red-500/20 animate-ping" />
              )}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 relative z-10" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            </button>

            <button
              type="submit"
              disabled={loading || (!input.trim() && selectedImages.length === 0)}
              className="btn-primary py-3 px-5 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>

          <p className="text-center text-xs text-ink-muted mt-3">
            © 2025 SAMS · Developed by Denis Macharia
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPage;
