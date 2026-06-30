import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { detectAiNavigationRequest } from '../lib/aiNavigation';
import { applyAiThemeCommand, detectAiThemeRequest } from '../lib/aiThemeCommand';
import { useAiSpeech } from '../hooks/useAiSpeech';
import { useAiStream } from '../hooks/useAiStream';

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
  actionData?: AiActionData;
  isError?: boolean;
  replyTo?: { id: string; content: string; role: 'user' | 'assistant' };
}

const CONFIRM_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;
const DONE_RE = /^(?:i'?m\s+)?done|no|stop|bye|enough|thats?\s+all|finish|end/i;

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hello! I'm the SAMS AI Assistant. Ask me about attendance, timetables, risk scores, or anything about the system.",
  timestamp: new Date(),
};

export const AISparkleIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
);

const FloatingAI: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const threadOwner = useMemo(
    () => user ? { userId: user.id, schoolId: user.schoolId, role: user.role } : null,
    [user?.id, user?.schoolId, user?.role],
  );
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(() => loadAiThreadId(threadOwner));
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<{ id: string; content: string; role: 'user' | 'assistant' } | null>(null);
  const [swipedMsgId, setSwipedMsgId] = useState<string | null>(null);
  const touchStartXRef = useRef(0);
  const touchStartIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const voicePendingRef = useRef(false);
  const pauseRecognitionRef = useRef<() => void>(() => {});
  const setAiSpeakingRef = useRef<(v: boolean) => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});
  const stopListeningRef = useRef<() => void>(() => {});
  const isListeningRef = useRef(false);

  const IMAGE_GEN_PATTERNS = [
    /^generate\s+(?:an?\s+)?image/i,
    /^generate\s+(?:an?\s+)?(?:photo|picture)/i,
    /^draw\s+/i,
    /^show\s+me\s+a\s+picture/i,
    /^create\s+(?:an?\s+)?image/i,
    /^create\s+(?:an?\s+)?(?:photo|picture)/i,
    /^make\s+(?:an?\s+)?image/i,
    /^make\s+(?:me\s+)?(?:an?\s+)?(?:photo|picture)/i,
    /^i\s+(?:want|need)\s+(?:an?\s+)?(?:.+\s+)?(?:photo|picture|image)\b/i,
  ];

  const isImageGenRequest = (text: string) => IMAGE_GEN_PATTERNS.some((p) => p.test(text.trim()));

  useEffect(() => {
    setThreadId(loadAiThreadId(threadOwner));
    setHistoryLoaded(false);
    pendingActionRef.current = null;
    setMessages([WELCOME_MESSAGE]);
  }, [threadOwner]);

  const { streamQuery, cancelStream } = useAiStream();
  const { speaking, speak, toggle: toggleSpeech, stop: stopSpeech } = useAiSpeech({
    onEnd: () => {
      if (voicePendingRef.current) {
        if (isListeningRef.current) stopListeningRef.current();
        setTimeout(() => {
          if (voicePendingRef.current && !isListeningRef.current) {
            setAiSpeakingRef.current(false);
            startListeningRef.current();
          }
        }, 300);
      }
    },
    onStart: () => {
      if (voicePendingRef.current && isListeningRef.current) {
        stopListeningRef.current();
      }
    },
  });

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
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: 'Could not prepare that photo. Try another image.', timestamp: new Date(), isError: true }]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const clearImages = () => { setSelectedImages([]); setImagePreviews([]); };

  const downloadAiFile = async (download: NonNullable<AiActionData['download']>) => {
    if (!download.endpoint.startsWith('/reports/')) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: 'I blocked that download because it is not a supported SAMS report export.', timestamp: new Date(), isError: true }]);
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
    if (!threadId || historyLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await apiClient.get(`/ai/conversations/${threadId}`);
        if (cancelled) return;
        const restored = threadRecordsToMessages(data.records ?? []);
        const next: Message[] = [];
        if (data.memoryNotice) next.push(buildMemoryNoticeMessage(data.memoryNotice));
        if (restored.length > 0) next.push(...restored);
        else if (next.length === 0) next.push(WELCOME_MESSAGE);
        setMessages(next);
      } catch {
        if (!cancelled) setMessages([WELCOME_MESSAGE]);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [threadId, historyLoaded]);

  const appendMemoryNotice = useCallback((notice?: string) => {
    if (!notice) return;
    setMessages((prev) => {
      if (prev.some((m) => m.isSystemNotice && m.content === notice)) return prev;
      return [...prev, buildMemoryNoticeMessage(notice)];
    });
  }, []);

  const clearConversation = useCallback(async () => {
    cancelStream();
    setLoading(true);
    try { if (threadId) await apiClient.delete(`/ai/conversations/${threadId}`); } catch {}
    finally {
      pendingActionRef.current = null;
      voicePendingRef.current = false;
      if (isListeningRef.current) stopListeningRef.current();
      setThreadId(null);
      saveAiThreadId(null, threadOwner);
      clearImages();
      setMessages([WELCOME_MESSAGE]);
      setHistoryLoaded(true);
      setLoading(false);
    }
  }, [threadId, threadOwner, cancelStream]);

  const submitQuery = useCallback(async (text: string) => {
    if (!text.trim() && selectedImages.length === 0) return;
    const currentReplyTo = replyTo;
    let effectiveText = text.trim() || 'What is in this image?';
    if (currentReplyTo) {
      const prefix = currentReplyTo.role === 'assistant' ? 'AI said' : 'You said';
      effectiveText = `[${prefix}: "${currentReplyTo.content.slice(0, 200)}"]\n\n${effectiveText}`;
    }
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: effectiveText, userImages: imagePreviews.length > 0 ? [...imagePreviews] : undefined, timestamp: new Date(), replyTo: currentReplyTo ?? undefined };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setReplyTo(null);
    setLoading(true);

    const addAssistantMessage = (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
      if (voicePendingRef.current && msg.content && !msg.isError) {
        pauseRecognitionRef.current();
        speak(msg.content, true);
      }
    };

    try {
      const themeCommand = selectedImages.length === 0 ? detectAiThemeRequest(text) : null;
      if (themeCommand) { applyAiThemeCommand(themeCommand); addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: `Changed to **${themeCommand.label}**.`, timestamp: new Date() }); return; }

      const navigationTarget = selectedImages.length === 0 ? detectAiNavigationRequest(text) : null;
      if (navigationTarget) { navigate(navigationTarget.path); addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: `Done. Brought you to **${navigationTarget.label}**. What do you need next?`, timestamp: new Date() }); return; }

      if (selectedImages.length > 0) {
        const formData = new FormData();
        selectedImages.forEach((file) => formData.append('images', file));
        formData.append('question', text.trim() || 'What is in this image?');
        if (threadId) formData.append('threadId', threadId);
        clearImages();
        const { data } = await apiClient.post('/ai/query-with-image', formData);
        if (data.threadId) { setThreadId(data.threadId); saveAiThreadId(data.threadId, threadOwner); }
        addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: data.answer, timestamp: new Date(), actionData: data.data, isError: isAiUploadErrorIntent(data.intent) || isAiVisionFailureIntent(data.intent) || isAiUnavailableIntent(data.intent) });
        return;
      }

      if (isImageGenRequest(text)) {
        const { data } = await apiClient.post('/ai/generate-image', { prompt: text.trim() });
        addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: `Here's the generated image:`, imageUrl: data.imageUrl, timestamp: new Date() });
        return;
      }

      if (voicePendingRef.current && DONE_RE.test(text.trim())) {
        voicePendingRef.current = false; stopListeningRef.current(); stopSpeech();
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: 'Alright, I\'m here if you need me. Tap the mic again anytime.', timestamp: new Date() }]);
        return;
      }

      const isConfirm = CONFIRM_RE.test(text.trim()) && pendingActionRef.current;
      const pending = pendingActionRef.current;

      // Streaming via SSE for normal text queries
      const streamMsgId = crypto.randomUUID();
      const history = messagesToAiHistory(messages);

      setMessages((prev) => [...prev, { id: streamMsgId, role: 'assistant', content: '', timestamp: new Date() }]);
      setLoading(true);

      void streamQuery(effectiveText, {
        onStart: () => {},
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === streamMsgId ? { ...m, content: m.content + token } : m)),
          );
        },
        onDone: (fullText, intent) => {
          if (intent === 'auth_required') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamMsgId
                  ? { ...m, content: 'Sign in to access school data. I can answer general questions without login.\n\nTry asking: "What is SAMS?"', isError: true }
                  : m,
              ),
            );
          } else if (intent === 'ai_error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamMsgId ? { ...m, isError: true } : m,
              ),
            );
          }
          pendingActionRef.current = null;
          setLoading(false);
          if (voicePendingRef.current && fullText) {
            speak(fullText, true);
          }
        },
        onError: () => {
          // Fallback to standard /ai/query
          console.warn('[Stream] SSE failed, falling back to standard query');
          setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
          void (async () => {
            try {
              const { data } = await apiClient.post('/ai/query', {
                question: effectiveText,
                threadId,
                history,
                ...(isConfirm && pending ? { confirmAction: true, pendingAction: pending } : pending ? { pendingAction: pending } : {}),
              });
              if (data.threadId) { setThreadId(data.threadId); saveAiThreadId(data.threadId, threadOwner); }
              appendMemoryNotice(data.memoryNotice);
              if (data.pendingAction) { pendingActionRef.current = data.pendingAction; addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: data.answer, timestamp: new Date(), pendingAction: data.pendingAction, actionData: data.data }); return; }
              pendingActionRef.current = null;
              const authHint = getAiAuthHint(data.intent);
              addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: authHint ?? data.answer, timestamp: new Date(), actionData: data.data, isError: isAiUnavailableIntent(data.intent) || isAiAuthIntent(data.intent) });
            } catch (fallbackErr) {
              const errMsg = getAiErrorMessage(fallbackErr, "I'm having trouble connecting. Please try again.");
              addAssistantMessage({ id: crypto.randomUUID(), role: 'assistant', content: errMsg, timestamp: new Date(), isError: true });
            } finally {
              setLoading(false);
            }
          })();
        },
      }, { threadId, history });
    } catch (err) {
      const errorMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: getAiErrorMessage(err, "I'm having trouble connecting. Please try again."), timestamp: new Date(), isError: true };
      setMessages((prev) => [...prev, errorMsg]);
      if (voicePendingRef.current) { speak(getAiErrorMessage(err, "I'm having trouble connecting. Please try again."), true); }
    } finally { setLoading(false); }
  }, [messages, selectedImages, imagePreviews, threadId, threadOwner, appendMemoryNotice, navigate, speak, replyTo, streamQuery, cancelStream]);

  const confirmPendingAction = useCallback(async (pending: PendingAction) => {
    if (!pending) return;
    setLoading(true);
    try {
      const history = messagesToAiHistory(messages);
      const { data } = await apiClient.post('/ai/query', { question: 'yes', threadId, history, confirmAction: true, pendingAction: pending });
      if (data.threadId) { setThreadId(data.threadId); saveAiThreadId(data.threadId, threadOwner); }
      appendMemoryNotice(data.memoryNotice);
      pendingActionRef.current = null;
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: data.answer, timestamp: new Date(), actionData: data.data, pendingAction: data.pendingAction, isError: isAiUnavailableIntent(data.intent) }]);
    } catch { setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: "I couldn't complete that action. Please try again.", timestamp: new Date(), isError: true }]); }
    finally { setLoading(false); }
  }, [messages, threadId, threadOwner, appendMemoryNotice]);

  const handleSilence = useCallback(() => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: "Are you still talking to me? I didn't hear anything for a while.", timestamp: new Date() }]);
    setAiSpeakingRef.current(true);
    setTimeout(() => { setAiSpeakingRef.current(false); }, 500);
  }, []);

  const handleAutoClose = useCallback(() => {
    voicePendingRef.current = false;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: 'I closed the mic since I didn\'t hear anything. Tap the mic button when you need me.', timestamp: new Date() }]);
  }, []);

  const voiceSubmit = useCallback((transcript: string) => {
    voicePendingRef.current = true;
    pauseRecognitionRef.current();
    submitQuery(transcript);
  }, [submitQuery]);

  const { isListening, startListening, stopListening, setAiSpeaking, pauseRecognition, error: micError } = useVoiceQuery(voiceSubmit, { onSilence: handleSilence, onAutoClose: handleAutoClose });

  isListeningRef.current = isListening;
  startListeningRef.current = startListening;
  stopListeningRef.current = stopListening;
  setAiSpeakingRef.current = setAiSpeaking;
  pauseRecognitionRef.current = pauseRecognition;

  const handleVoiceToggle = useCallback(() => {
    if (isListening) { voicePendingRef.current = false; stopListening(); }
    else { voicePendingRef.current = true; startListening(); }
  }, [isListening, startListening, stopListening]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); voicePendingRef.current = false; if (isListening) stopListening(); submitQuery(input); };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 300); }, [isOpen]);

  return (
    <>
      <div className={`ai-chat-panel transition-all duration-300 ease-in-out ${isOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-muted rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center overflow-hidden"><img src="/ai-sams-logo.svg" alt="SAMS AI" className="w-8 h-8" /></div>
            <div><h3 className="text-sm font-bold text-ink">SAMS AI</h3><p className="text-[10px] text-ink-muted">Your Human-School Assistant</p></div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => void clearConversation()} disabled={loading || (!threadId && messages.length <= 1)} className="px-2 py-1 rounded-lg text-[11px] text-ink-muted hover:bg-surface-elevated hover:text-ink disabled:opacity-40 transition-colors">Clear</button>
            <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-surface-elevated text-ink-muted hover:text-ink transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.map((msg) => {
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const isSwiped = swipedMsgId === msg.id;

            const handleTouchStart = (e: React.TouchEvent) => { touchStartXRef.current = e.touches[0].clientX; touchStartIdRef.current = msg.id; };
            const handleTouchEnd = (e: React.TouchEvent) => {
              if (touchStartIdRef.current !== msg.id) return;
              const dx = e.changedTouches[0].clientX - touchStartXRef.current;
              if (Math.abs(dx) > 60 && msg.id !== 'welcome' && msg.content.trim()) {
                setSwipedMsgId(msg.id);
                setReplyTo({ id: msg.id, content: msg.content, role: msg.role });
                setTimeout(() => setSwipedMsgId(null), 600);
              }
            };

            return (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center mr-2 mt-1 flex-shrink-0"><AISparkleIcon className="w-3 h-3 text-white" /></div>}
                <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm relative group select-none touch-pan-y ${isSwiped ? 'ring-2 ring-brand/50 scale-[0.97]' : ''} ${msg.role === 'user' ? 'bg-brand text-white' : msg.isError ? 'bg-red-950/50 border border-red-500/40 text-red-200' : msg.isSystemNotice ? 'bg-indigo-950/50 border border-indigo-500/40 text-indigo-300' : 'bg-surface-muted border border-line text-ink'}`}>
                  
                  {isSwiped && (
                    <div className="absolute inset-0 flex items-center justify-center bg-brand/10 backdrop-blur-[1px] rounded-xl z-10">
                      <span className="text-xs font-bold text-brand flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                        Reply
                      </span>
                    </div>
                  )}

                  {msg.replyTo && (
                    <div className={`mb-2 pl-2 border-l-2 ${msg.role === 'user' ? 'border-white/50' : 'border-indigo-400/60'} rounded-sm`}>
                      <p className={`text-[10px] leading-tight ${msg.role === 'user' ? 'text-white/70' : 'text-ink-muted'}`}>
                        <span className="font-semibold">{msg.replyTo.role === 'user' ? 'You' : 'AI'}</span>
                        <span className="ml-1 opacity-70">{msg.replyTo.content.length > 80 ? msg.replyTo.content.slice(0, 80) + '…' : msg.replyTo.content}</span>
                      </p>
                    </div>
                  )}

                  {msg.userImages && msg.userImages.length > 0 && (
                    <div className="flex gap-1 mb-2 flex-wrap">{msg.userImages.map((img, i) => <img key={i} src={img} alt="Uploaded" className="h-16 w-16 object-cover rounded-lg" />)}</div>
                  )}
                  <div className="flex items-start gap-1">
                    <div className="flex-1">{msg.role === 'assistant' ? <AiMessageContent content={msg.content} /> : <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>}</div>
                    {msg.role === 'assistant' && msg.content.length > 0 && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleSpeech(msg.content); }} className={`p-1 rounded-lg shrink-0 transition-all mt-0.5 ${speaking ? 'text-indigo-300 bg-indigo-500/20 animate-pulse' : 'text-ink-muted hover:text-brand hover:bg-surface-elevated'}`}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" /></svg>
                      </button>
                    )}
                  </div>
                  <div className={`flex items-center gap-2 mt-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <span className={`text-[10px] ${msg.role === 'user' ? 'text-white/60' : 'text-ink-subtle'}`}>{time}</span>
                    {msg.id !== 'welcome' && msg.content.trim() && <span className="text-[10px] text-ink-subtle/50 italic">swipe to reply</span>}
                  </div>
                  {msg.pendingAction && <button type="button" onClick={() => void confirmPendingAction(msg.pendingAction!)} disabled={loading} className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors">Confirm: {msg.pendingAction.description}</button>}
                  {msg.actionData?.download && <button type="button" onClick={() => void downloadAiFile(msg.actionData!.download!)} className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium py-1.5 px-3 rounded-lg transition-colors">{msg.actionData.download.label}</button>}
                  {msg.imageUrl && <img src={msg.imageUrl} alt="AI Generated" className="max-w-full rounded-lg mt-2 border border-white/10" loading="lazy" />}
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-brand flex items-center justify-center mr-2 mt-1 flex-shrink-0"><AISparkleIcon className="w-3 h-3 text-white" /></div>
              <div className="bg-surface-muted border border-line rounded-xl px-3 py-2 min-w-[100px]">
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="flex space-x-0.5">
                    <span className="w-1 h-1 bg-indigo-400 rounded-full animate-typewriter-pulse" />
                    <span className="w-1 h-1 bg-indigo-400 rounded-full animate-typewriter-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="w-1 h-1 bg-indigo-400 rounded-full animate-typewriter-pulse" style={{ animationDelay: '0.4s' }} />
                  </span>
                  <span>Thinking</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-line p-3 bg-surface rounded-b-2xl">
          {loading && <div className="text-[10px] text-ink-muted mb-1.5 text-center font-medium tracking-wide"><span className="inline-flex items-center gap-1"><span className="w-1 h-1 bg-indigo-400 rounded-full animate-typewriter-pulse" /> SAMS AI is thinking...</span></div>}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {imagePreviews.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="Selected" className="h-12 w-12 object-cover rounded-lg border border-line" />
                  <button type="button" onClick={() => removeImage(i)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] hover:bg-red-600">×</button>
                </div>
              ))}
              {selectedImages.length < 4 && <button type="button" onClick={() => fileInputRef.current?.click()} className="h-12 w-12 rounded-lg border border-dashed border-line flex items-center justify-center text-ink-subtle hover:text-ink hover:border-line-strong transition-colors"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg></button>}
            </div>
          )}
          {replyTo && (
            <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-surface-elevated border border-line">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-brand">Replying to <span className="capitalize">{replyTo.role}</span></p>
                <p className="text-xs text-ink-muted truncate mt-0.5">{replyTo.content.length > 100 ? replyTo.content.slice(0, 100) + '…' : replyTo.content}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="p-1 rounded text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}
          {micError && (
            <div className="mb-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-[11px] flex items-start gap-2">
              <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>{micError}</span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 bg-surface-muted text-ink-muted border border-line rounded-lg hover:bg-surface-elevated hover:text-ink transition-all">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder={selectedImages.length > 0 ? 'Ask about these images...' : 'Ask SAMS AI...'} disabled={loading} className="flex-1 bg-surface-muted border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-subtle focus:outline-none focus:ring-1 focus:ring-brand/30 disabled:opacity-50 transition-all" />
            <button type="button" onClick={handleVoiceToggle} className={`relative p-2 rounded-lg transition-all duration-200 ${isListening ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-surface-muted text-ink-muted border border-line hover:bg-surface-elevated hover:text-ink'}`}>
              {isListening && <span className="absolute inset-0 rounded-lg bg-red-500/20 animate-ping" />}
              <svg className="w-4 h-4 relative z-10" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" /></svg>
            </button>
            <button type="submit" disabled={loading || (!input.trim() && selectedImages.length === 0)} className="p-2 bg-brand text-white rounded-lg hover:bg-brand-hover hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </form>
        </div>
      </div>

      <button type="button" onClick={() => setIsOpen((prev) => !prev)} className={isOpen ? 'ai-fab ai-fab-open' : 'ai-fab'}>
        {!isOpen && <span className="absolute inset-0 rounded-full bg-indigo-400/30 animate-ping opacity-40 pointer-events-none" />}
        {isOpen ? <svg className="w-6 h-6 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> : <AISparkleIcon className="w-7 h-7 text-white" />}
      </button>

      <style>{`@keyframes typewriter-pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}.animate-typewriter-pulse{animation:typewriter-pulse 1s ease-in-out infinite}`}</style>
    </>
  );
};

export default FloatingAI;
