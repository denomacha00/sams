import React, { useState, useRef, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { useVoiceQuery } from '../hooks/useVoiceQuery';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hi! I'm AI-SAMS, your smart assistant. Ask me anything about SAMS or your school data.",
  timestamp: new Date(),
};

const QUICK_QUESTIONS = [
  'What is SAMS?',
  'How do I mark attendance?',
  'Show my timetable',
  'How many students?',
];

const AISAMSWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submitQuery = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await apiClient.post('/ai/query', { question: text.trim() });
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: "I'm having trouble connecting. Please try again in a moment.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }, []);

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
        className={`fixed bottom-20 right-4 z-[9999] transition-all duration-300 ease-in-out ${
          isOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        } w-[calc(100vw-2rem)] sm:w-[400px] h-[500px] max-h-[70vh] flex flex-col rounded-2xl border border-white/10 backdrop-blur-xl bg-slate-900/95 shadow-2xl shadow-cyan-500/10`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 to-teal-500/10 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.2 4.7 3 6.1V18a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.9c1.8-1.4 3-3.6 3-6.1a7 7 0 0 0-7-7z" />
                <path d="M9 22h6" />
                <path d="M10 2v1" />
                <path d="M14 2v1" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">AI-SAMS</h3>
              <p className="text-[10px] text-cyan-300/70">Smart Assistant</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
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
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-md shadow-cyan-500/20'
                    : 'bg-white/5 border border-white/10 text-gray-200'
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}

          {/* Quick questions (show only after welcome message) */}
          {messages.length === 1 && messages[0].id === 'welcome' && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => submitQuery(q)}
                  className="px-2.5 py-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-xs text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500/30 transition-all duration-200"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/10 p-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask AI-SAMS..."
              disabled={loading}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50 transition-all"
            />

            {/* Voice button */}
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className={`p-2 rounded-lg transition-all duration-200 ${
                isListening
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-white'
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
              disabled={loading || !input.trim()}
              className="p-2 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-lg shadow-md shadow-cyan-500/20 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              aria-label="Send message"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`fixed bottom-4 right-4 z-[9999] w-14 h-14 rounded-full shadow-lg shadow-cyan-500/30 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 ${
          isOpen
            ? 'bg-slate-800 border border-white/20 rotate-0'
            : 'bg-gradient-to-br from-cyan-500 to-teal-500 rotate-0'
        }`}
        aria-label={isOpen ? 'Close AI-SAMS chat' : 'Open AI-SAMS chat'}
      >
        {isOpen ? (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-7 h-7 text-white" viewBox="0 0 64 64" fill="none">
            <defs>
              <linearGradient id="widgetBrainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#e0f7fa" />
              </linearGradient>
            </defs>
            <path
              d="M32 12c-8 0-14 5-14 12 0 4 2 7 5 9l1 1v6c0 2 2 4 4 4h8c2 0 4-2 4-4v-6l1-1c3-2 5-5 5-9 0-7-6-12-14-12z"
              fill="url(#widgetBrainGrad)"
              opacity="0.95"
            />
            <path d="M26 22c2-1 4-1 6 0s4 1 6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
            <path d="M25 27c3-1 5-1 7 0s5 1 7 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
            <path d="M27 32c2-1 3-1 5 0s3 1 5 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
            <circle cx="20" cy="20" r="2" fill="white" opacity="0.6" />
            <circle cx="44" cy="20" r="2" fill="white" opacity="0.6" />
            <circle cx="16" cy="32" r="2" fill="white" opacity="0.6" />
            <circle cx="48" cy="32" r="2" fill="white" opacity="0.6" />
            <line x1="20" y1="20" x2="24" y2="18" stroke="white" strokeWidth="1" opacity="0.4" />
            <line x1="44" y1="20" x2="40" y2="18" stroke="white" strokeWidth="1" opacity="0.4" />
            <line x1="16" y1="32" x2="20" y2="28" stroke="white" strokeWidth="1" opacity="0.4" />
            <line x1="48" y1="32" x2="44" y2="28" stroke="white" strokeWidth="1" opacity="0.4" />
          </svg>
        )}
      </button>
    </>
  );
};

export default AISAMSWidget;
