import { useState, useRef, useCallback, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useAiSpeech } from './useAiSpeech';
import { useVoiceQuery } from './useVoiceQuery';
import {
  loadAiThreadId,
  saveAiThreadId,
  threadRecordsToMessages,
  messagesToAiHistory,
  buildMemoryNoticeMessage,
  getAiAuthHint,
  getAiErrorMessage,
  isAiUnavailableIntent,
  isAiAuthIntent,
  isAiUploadErrorIntent,
  isAiVisionFailureIntent,
  type AiChatMessage,
  type AiActionData,
  type AiThreadOwner,
} from '../lib/aiChat';

// ─── Types ────────────────────────────────────────────────────────────────

export interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
  awaitingSlot?: string;
}

export interface Message extends AiChatMessage {
  imageUrl?: string;
  userImages?: string[];
  pendingAction?: PendingAction;
  actionData?: AiActionData;
  isError?: boolean;
  suggestions?: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
}

export interface AiChatOptions {
  welcomeMessage?: string;
  onNavigate?: (path: string) => void;
  onSpeak?: (text: string) => void;
}

const CONFIRM_RE = /^(yes|y|confirm|proceed|ok|do it|go ahead)\.?$/i;
const DONE_RE = /^(?:i'?m\s+)?done|no|stop|bye|enough|thats?\s+all|finish|end/i;

const DEFAULT_WELCOME = "Hello! I'm the SAMS AI Assistant. Ask me about attendance, timetables, risk scores, or anything about the system.";

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useAiChat(options?: AiChatOptions) {
  const user = useAuthStore((s) => s.user);
  const threadOwner = user ? { userId: user.id, schoolId: user.schoolId, role: user.role } : null;

  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: options?.welcomeMessage ?? DEFAULT_WELCOME, timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(() => loadAiThreadId(threadOwner));
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

  const pendingActionRef = useRef<PendingAction | null>(null);
  const voicePendingRef = useRef(false);

  // Speech
  const { speaking, speak, toggle: toggleSpeech, stop: stopSpeech } = useAiSpeech();
  const onNavigateRef = useRef(options?.onNavigate);
  onNavigateRef.current = options?.onNavigate;

  // Voice
  const handleSilence = useCallback(() => {
    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: "Are you still there? I didn't hear anything for a while.",
      timestamp: new Date(),
    });
  }, []);

  const handleAutoClose = useCallback(() => {
    voicePendingRef.current = false;
    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'I closed the mic since I didn\'t hear anything. Tap the mic button when you need me.',
      timestamp: new Date(),
    });
  }, []);

  const voiceSubmit = useCallback((transcript: string) => {
    voicePendingRef.current = true;
    submitQuery(transcript);
  }, []);

  const {
    isListening,
    startListening,
    stopListening,
    setAiSpeaking,
  } = useVoiceQuery(voiceSubmit, {
    onSilence: handleSilence,
    onAutoClose: handleAutoClose,
  });

  // Load history
  useEffect(() => {
    setThreadId(loadAiThreadId(threadOwner));
    setHistoryLoaded(false);
    pendingActionRef.current = null;
    setMessages([
      { id: 'welcome', role: 'assistant', content: options?.welcomeMessage ?? DEFAULT_WELCOME, timestamp: new Date() },
    ]);
  }, [threadOwner?.userId, threadOwner?.schoolId]);

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
          next.push(buildMemoryNoticeMessage(data.memoryNotice) as Message);
        }
        if (restored.length > 0) {
          next.push(...restored);
        } else if (next.length === 0) {
          next.push({ id: 'welcome', role: 'assistant', content: options?.welcomeMessage ?? DEFAULT_WELCOME, timestamp: new Date() });
        }
        setMessages(next);
      } catch {
        if (!cancelled) setMessages([
          { id: 'welcome', role: 'assistant', content: options?.welcomeMessage ?? DEFAULT_WELCOME, timestamp: new Date() },
        ]);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [threadId, historyLoaded]);

  // ── Helpers ────────────────────────────────────────────────────────

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const getThreadOwner = useCallback((): AiThreadOwner | null => threadOwner, [threadOwner]);

  const clearConversation = useCallback(async () => {
    setLoading(true);
    try {
      if (threadId) {
        await apiClient.delete(`/ai/conversations/${threadId}`);
      }
    } catch {
      // Ignore — clear locally regardless
    } finally {
      pendingActionRef.current = null;
      voicePendingRef.current = false;
      stopListening();
      setThreadId(null);
      saveAiThreadId(null, threadOwner);
      setSelectedImages([]);
      setImagePreviews([]);
      setMessages([
        { id: 'welcome', role: 'assistant', content: options?.welcomeMessage ?? DEFAULT_WELCOME, timestamp: new Date() },
      ]);
      setHistoryLoaded(true);
      setLoading(false);
    }
  }, [threadId, threadOwner, stopListening]);

  const doQuery = useCallback(async (question: string, extra: Record<string, unknown> = {}) => {
    const history = messagesToAiHistory(messages);
    const { data } = await apiClient.post('/ai/query', {
      question,
      threadId,
      history,
      ...extra,
    });
    if (data.threadId) {
      setThreadId(data.threadId);
      saveAiThreadId(data.threadId, threadOwner);
    }
    return data;
  }, [messages, threadId, threadOwner]);

  const submitQuery = useCallback(async (text: string) => {
    if (!text.trim() && selectedImages.length === 0) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim() || 'What is in this image?',
      userImages: imagePreviews.length > 0 ? [...imagePreviews] : undefined,
      timestamp: new Date(),
    };
    appendMessage(userMessage);
    setInput('');
    setLoading(true);

    try {
      // Image query
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
        addMsg(data.answer, undefined, isAiUploadErrorIntent(data.intent) || isAiVisionFailureIntent(data.intent));
        return;
      }

      // Image generation
      if (/^generate\s+(?:an?\s+)?image/i.test(text.trim())) {
        const { data } = await apiClient.post('/ai/generate-image', { prompt: text.trim() });
        const imgMsg: Message = {
          id: crypto.randomUUID(), role: 'assistant',
          content: `Here's the generated image:`, imageUrl: data.imageUrl, timestamp: new Date(),
        };
        appendMessage(imgMsg);
        return;
      }

      // Done voice mode
      if (voicePendingRef.current && DONE_RE.test(text.trim())) {
        voicePendingRef.current = false;
        stopListening();
        stopSpeech();
        appendMessage({ id: crypto.randomUUID(), role: 'assistant', content: 'Alright, I\'m here if you need me. Tap the mic again anytime.', timestamp: new Date() });
        return;
      }

      // Navigation request
      if (onNavigateRef.current && !selectedImages.length) {
        // Try navigation (handled by parent)
      }

      // Normal query
      const isConfirm = CONFIRM_RE.test(text.trim()) && pendingActionRef.current;
      const pending = pendingActionRef.current;
      const data = await doQuery(text.trim(), {
        ...(isConfirm && pending ? { confirmAction: true, pendingAction: pending } : pending ? { pendingAction: pending } : {}),
      });

      if (data.pendingAction) {
        pendingActionRef.current = data.pendingAction;
        addMsg(data.answer, data.pendingAction, isAiUnavailableIntent(data.intent));
        return;
      }

      pendingActionRef.current = null;
      addMsg(data.answer, undefined, isAiUnavailableIntent(data.intent) || isAiAuthIntent(data.intent));
    } catch (err) {
      addMsg(getAiErrorMessage(err, "I'm having trouble connecting. Please try again."), undefined, true);
    } finally {
      setLoading(false);
    }
  }, [messages, selectedImages, imagePreviews, threadId, threadOwner]);

  const confirmPendingAction = useCallback(async (pending: PendingAction) => {
    setLoading(true);
    try {
      const data = await doQuery('yes', { confirmAction: true, pendingAction: pending });
      pendingActionRef.current = null;
      addMsg(data.answer, data.pendingAction, isAiUnavailableIntent(data.intent));
    } catch {
      addMsg("I couldn't complete that action. Please try again.", undefined, true);
    } finally {
      setLoading(false);
    }
  }, [doQuery]);

  const addMsg = useCallback((content: string, pendingAction?: PendingAction, isError?: boolean) => {
    // Parse suggestions from response (backend may include them as JSON at end)
    let cleanContent = content;
    let suggestions: Message['suggestions'] = [];

    // Check if response has embedded suggestions
    const suggestionMatch = content.match(/__SUGGESTIONS__(\[.*?\])$/);
    if (suggestionMatch) {
      try {
        suggestions = JSON.parse(suggestionMatch[1]);
        cleanContent = content.replace(/__SUGGESTIONS__\[.*?\]$/, '');
      } catch {
        // ignore
      }
    }

    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: cleanContent,
      timestamp: new Date(),
      pendingAction,
      isError,
      suggestions,
    });
  }, [appendMessage]);

  const handleSuggestionClick = useCallback((suggestion: { label: string; action: string; params?: Record<string, unknown> }) => {
    const text = suggestion.params?.message
      ? `${suggestion.action}: ${suggestion.params.message}`
      : suggestion.action;
    submitQuery(text);
  }, [submitQuery]);

  const clearImages = useCallback(() => { setSelectedImages([]); setImagePreviews([]); }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 4 - selectedImages.length;
    const slice = files.slice(0, remaining);
    if (slice.length === 0) return;

    try {
      const { prepareImagesForAiUpload } = await import('../lib/aiImageUpload');
      const toAdd = await prepareImagesForAiUpload(slice);
      if (toAdd.length === 0) return;

      setSelectedImages((prev) => [...prev, ...toAdd]);
      toAdd.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => setImagePreviews((prev) => [...prev, reader.result as string]);
        reader.readAsDataURL(file);
      });
    } catch {
      addMsg('Could not prepare that photo. Try another image.', undefined, true);
    } finally {
      if (e.target) e.target.value = '';
    }
  }, [selectedImages, addMsg]);

  const removeImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      voicePendingRef.current = false;
      stopListening();
    } else {
      voicePendingRef.current = true;
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    // State
    messages,
    input,
    loading,
    threadId,
    isListening,
    speaking,
    selectedImages,
    imagePreviews,
    pendingAction: pendingActionRef.current,

    // Setters
    setInput,
    setMessages,

    // Actions
    submitQuery: useCallback((text: string) => submitQuery(text), [submitQuery]),
    confirmPendingAction,
    clearConversation,
    handleVoiceToggle,
    handleImageSelect,
    removeImage,
    clearImages,
    speak,
    toggleSpeech,
    stopSpeech,
    handleSuggestionClick,
  };
}
