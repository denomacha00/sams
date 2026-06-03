import React, { useState, useRef, useEffect } from 'react';
import apiClient from '../services/apiClient';
import { useVoiceQuery } from '../hooks/useVoiceQuery';
import { getAiErrorMessage, isAiUnavailableIntent, loadAiThreadId, saveAiThreadId } from '../lib/aiChat';

interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  description: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  userImages?: string[];
  timestamp: Date;
  pendingAction?: PendingAction;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(() => loadAiThreadId());
  const pendingActionRef = useRef<PendingAction | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 4 - selectedImages.length;
    const toAdd = files.slice(0, remaining).filter((f) => f.size <= 5 * 1024 * 1024);
    if (toAdd.length === 0) return;
    setSelectedImages((prev) => [...prev, ...toAdd]);
    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setImagePreviews((prev) => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const clearImages = () => {
    setSelectedImages([]);
    setImagePreviews([]);
  };

  const confirmPendingAction = async (pending: PendingAction) => {
    setLoading(true);
    try {
      const { data } = await apiClient.post('/ai/query', {
        question: 'yes',
        confirmAction: true,
        pendingAction: pending,
      });
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
          isError: isAiUnavailableIntent(data.intent),
        }]);
        return;
      }

      const isConfirm = CONFIRM_RE.test(text.trim()) && pendingActionRef.current;
      const { data } = await apiClient.post('/ai/query', {
        question: text.trim(),
        threadId,
        ...(isConfirm
          ? { confirmAction: true, pendingAction: pendingActionRef.current }
          : {}),
      });
      if (data.threadId) {
        setThreadId(data.threadId);
        saveAiThreadId(data.threadId);
      }

      if (data.requiresConfirmation && data.pendingAction) {
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
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        isError: isAiUnavailableIntent(data.intent),
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header */}
      <div className="border-b border-white/10 backdrop-blur-sm bg-white/5 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">AI Assistant</h1>
            <p className="text-xs text-gray-400">Ask questions about attendance, reports, or get insights</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-white/10 mb-4">
                <svg className="w-8 h-8 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="text-white text-lg font-medium mb-1">How can I help you today?</p>
              <p className="text-gray-500 text-sm mb-8">
                Ask about attendance trends, student performance, or any school data.
              </p>

              {/* Suggested questions */}
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submitQuery(q)}
                    className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-300 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
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
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/20'
                    : msg.isError
                      ? 'bg-red-950/70 border border-red-500/50 text-red-100'
                      : 'bg-white/10 border border-white/10 text-gray-200'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
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
                    className="mt-3 w-full px-3 py-2 text-xs font-semibold rounded-xl bg-amber-600/90 hover:bg-amber-500 text-white disabled:opacity-50"
                  >
                    Confirm: {msg.pendingAction.description}
                  </button>
                )}
                <p
                  className={`text-xs mt-2 ${
                    msg.role === 'user' ? 'text-purple-200/70' : 'text-gray-500'
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/10 border border-white/10 rounded-2xl px-5 py-4">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-white/10 backdrop-blur-sm bg-white/5 px-6 py-4">
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
              className="p-3 rounded-xl bg-white/10 text-gray-400 border border-white/10 hover:bg-white/20 hover:text-white disabled:opacity-50"
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
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 transition-all duration-200"
            />

            {/* Voice input button */}
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className={`relative p-3 rounded-xl transition-all duration-200 ${
                isListening
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'bg-white/10 text-gray-400 border border-white/10 hover:bg-white/20 hover:text-white'
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
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-5 rounded-xl shadow-lg shadow-purple-500/25 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>

          <p className="text-center text-xs text-gray-600 mt-3">
            © 2025 SAMS · Developed by Denis Macharia
          </p>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPage;
