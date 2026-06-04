import React, { useState, useRef, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { useVoiceQuery } from '../hooks/useVoiceQuery';
import {
  buildMemoryNoticeMessage,
  getAiAuthHint,
  getAiErrorMessage,
  isAiAuthIntent,
  isAiUnavailableIntent,
  isAiUploadErrorIntent,
  isAiVisionFailureIntent,
  loadAiThreadId,
  saveAiThreadId,
  threadRecordsToMessages,
  type AiChatMessage,
} from '../lib/aiChat';
import { prepareImagesForAiUpload } from '../lib/aiImageUpload';
import { AiMessageContent } from '../lib/aiMessageContent';

interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
  awaitingSlot?: string;
}

interface Message extends AiChatMessage {
  imageUrl?: string;
  userImages?: string[];
  pendingAction?: PendingAction;
  isError?: boolean;
}

const CONFIRM_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hello! I'm the SAMS AI Assistant. Ask me about attendance, timetables, risk scores, or anything about the system.",
  timestamp: new Date(),
};

/** Sparkle/brain AI icon used across the app */
export const AISparkleIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
);

const FloatingAI: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(() => loadAiThreadId());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image generation patterns
  const IMAGE_GEN_PATTERNS = [
    /^generate\s+(?:an?\s+)?image/i,
    /^draw\s+/i,
    /^show\s+me\s+a\s+picture/i,
    /^create\s+(?:an?\s+)?image/i,
    /^make\s+(?:an?\s+)?image/i,
  ];

  const isImageGenRequest = (text: string) => IMAGE_GEN_PATTERNS.some((p) => p.test(text.trim()));

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

  const clearImages = () => { setSelectedImages([]); setImagePreviews([]); };

  // Restore encrypted thread history after refresh (thread id alone is not enough for UI).
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
        } else if (next.length === 0) {
          next.push(WELCOME_MESSAGE);
        }
        setMessages(next);
      } catch {
        if (!cancelled) setMessages([WELCOME_MESSAGE]);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [threadId, historyLoaded]);

  const appendMemoryNotice = useCallback((notice?: string) => {
    if (!notice) return;
    setMessages((prev) => {
      if (prev.some((m) => m.isSystemNotice && m.content === notice)) return prev;
      return [...prev, buildMemoryNoticeMessage(notice)];
    });
  }, []);

  const confirmPendingAction = useCallback(async (pending: PendingAction) => {
    setLoading(true);
    try {
      const { data } = await apiClient.post('/ai/query', {
        question: 'yes',
        threadId,
        confirmAction: true,
        pendingAction: pending,
      });
      if (data.threadId) {
        setThreadId(data.threadId);
        saveAiThreadId(data.threadId);
      }
      pendingActionRef.current = null;
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: "I couldn't complete that action. Please try again.",
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  const submitQuery = useCallback(async (text: string) => {
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
      // Case 1: Images uploaded — use vision endpoint
      if (selectedImages.length > 0) {
        const formData = new FormData();
        selectedImages.forEach((file) => formData.append('images', file));
        formData.append('question', text.trim() || 'What is in this image?');
        clearImages();

        const { data } = await apiClient.post('/ai/query-with-image', formData);
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer,
          timestamp: new Date(),
          isError:
            isAiUploadErrorIntent(data.intent) ||
            isAiVisionFailureIntent(data.intent) ||
            isAiUnavailableIntent(data.intent),
        }]);
        return;
      }

      // Case 2: Image generation request
      if (isImageGenRequest(text)) {
        const { data } = await apiClient.post('/ai/generate-image', { prompt: text.trim() });
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), role: 'assistant',
          content: `Here's the generated image:`, imageUrl: data.imageUrl, timestamp: new Date(),
        }]);
        return;
      }

      // Case 3: Normal text query (with action confirmation support)
      const isConfirm = CONFIRM_RE.test(text.trim()) && pendingActionRef.current;
      const pending = pendingActionRef.current;
      const { data } = await apiClient.post('/ai/query', {
        question: text.trim(),
        threadId,
        ...(isConfirm && pending
          ? { confirmAction: true, pendingAction: pending }
          : pending
            ? { pendingAction: pending }
            : {}),
      });
      if (data.threadId) {
        setThreadId(data.threadId);
        saveAiThreadId(data.threadId);
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
        }]);
        return;
      }

      pendingActionRef.current = null;
      const authHint = getAiAuthHint(data.intent);
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: authHint ?? data.answer,
        timestamp: new Date(),
        isError: isAiUnavailableIntent(data.intent) || isAiAuthIntent(data.intent),
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: getAiErrorMessage(err, "I'm having trouble connecting. Please try again."),
        timestamp: new Date(),
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [selectedImages, imagePreviews, threadId, appendMemoryNotice]);

  const { isListening, startListening, stopListening } = useVoiceQuery(submitQuery);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuery(input);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  return (
    <>
      {/* Chat Panel */}
      <div
        className={`ai-chat-panel transition-all duration-300 ease-in-out ${
          isOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-muted rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
              <AISparkleIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">SAMS AI Assistant</h3>
              <p className="text-[10px] text-ink-muted">Powered by AI</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-surface-elevated text-ink-muted hover:text-ink transition-colors"
            aria-label="Close chat"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                  <AISparkleIcon className="w-3 h-3 text-white" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-brand text-white'
                    : msg.isError
                      ? 'bg-red-950/50 border border-red-500/40 text-red-200'
                      : msg.isSystemNotice
                        ? 'bg-indigo-950/50 border border-indigo-500/40 text-indigo-300'
                        : 'bg-surface-muted border border-line text-ink'
                }`}
              >
                {/* User uploaded images */}
                {msg.userImages && msg.userImages.length > 0 && (
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {msg.userImages.map((img, i) => (
                      <img key={i} src={img} alt="Uploaded" className="h-16 w-16 object-cover rounded-lg" />
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' ? (
                  <AiMessageContent content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                )}
                {msg.pendingAction && (
                  <button
                    type="button"
                    onClick={() => void confirmPendingAction(msg.pendingAction!)}
                    disabled={loading}
                    className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors"
                  >
                    Confirm: {msg.pendingAction.description}
                  </button>
                )}
                {/* AI generated image */}
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="AI Generated" className="max-w-full rounded-lg mt-2 border border-white/10" loading="lazy" />
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                <AISparkleIcon className="w-3 h-3 text-white" />
              </div>
              <div className="bg-surface-muted border border-line rounded-xl px-3 py-2">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-line p-3 bg-surface rounded-b-2xl">
          {/* Image previews */}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {imagePreviews.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="Selected" className="h-12 w-12 object-cover rounded-lg border border-line" />
                  <button type="button" onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] hover:bg-red-600">×</button>
                </div>
              ))}
              {selectedImages.length < 4 && (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="h-12 w-12 rounded-lg border border-dashed border-line flex items-center justify-center text-ink-subtle hover:text-ink hover:border-line-strong transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                </button>
              )}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            {/* Hidden file input (multiple) */}
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />

            {/* Image upload button */}
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="p-2 bg-surface-muted text-ink-muted border border-line rounded-lg hover:bg-surface-elevated hover:text-ink transition-all"
              title="Upload images (max 4)" aria-label="Upload images">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedImages.length > 0 ? 'Ask about these images...' : 'Ask SAMS AI...'}
              disabled={loading}
              className="flex-1 bg-surface-muted border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-brand/30 disabled:opacity-50 transition-all"
            />

            {/* Voice button */}
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className={`relative p-2 rounded-lg transition-all duration-200 ${
                isListening
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'bg-surface-muted text-ink-muted border border-line hover:bg-surface-elevated hover:text-ink'
              }`}
              title={isListening ? 'Stop listening' : 'Voice input'}
              aria-label={isListening ? 'Stop listening' : 'Voice input'}
            >
              {isListening && (
                <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-ping" />
              )}
              <svg className="w-4 h-4 relative z-10" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            </button>

            {/* Send button */}
            <button
              type="submit"
              disabled={loading || (!input.trim() && selectedImages.length === 0)}
              className="p-2 bg-brand text-white rounded-lg hover:bg-brand-hover hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              aria-label="Send message"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Floating Button with pulse animation */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={isOpen ? 'ai-fab ai-fab-open' : 'ai-fab'}
        aria-label={isOpen ? 'Close SAMS AI Assistant' : 'Open SAMS AI Assistant'}
      >
        {!isOpen && (
          <span className="absolute inset-0 rounded-full bg-indigo-400/30 animate-ping opacity-40 pointer-events-none" />
        )}

        {isOpen ? (
          <svg className="w-6 h-6 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <AISparkleIcon className="w-7 h-7 text-white" />
        )}
      </button>
    </>
  );
};

export default FloatingAI;
