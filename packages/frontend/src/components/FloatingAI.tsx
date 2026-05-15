import React, { useState, useRef, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { useVoiceQuery } from '../hooks/useVoiceQuery';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  userImages?: string[];
  timestamp: Date;
}

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

  const clearImages = () => { setSelectedImages([]); setImagePreviews([]); };

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

        const { data } = await apiClient.post('/ai/query-with-image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), role: 'assistant', content: data.answer, timestamp: new Date(),
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

      // Case 3: Normal text query
      const { data } = await apiClient.post('/ai/query', { question: text.trim() });
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', content: data.answer, timestamp: new Date(),
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(), role: 'assistant',
        content: "I'm having trouble connecting. Please try again.", timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [selectedImages, imagePreviews]);

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
        className={`fixed bottom-24 right-4 z-[9998] transition-all duration-300 ease-in-out ${
          isOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        } w-[calc(100vw-2rem)] sm:w-[400px] h-[520px] max-h-[70vh] flex flex-col rounded-2xl border border-white/10 backdrop-blur-xl bg-slate-900/95 shadow-2xl shadow-purple-500/10`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-purple-600/20 to-blue-600/20 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <AISparkleIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">SAMS AI Assistant</h3>
              <p className="text-[10px] text-purple-300/70">Powered by AI</p>
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
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                  <AISparkleIcon className="w-3 h-3 text-white" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md shadow-purple-500/20'
                    : 'bg-white/5 border border-white/10 text-gray-200'
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
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
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
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center mr-2 mt-1 flex-shrink-0">
                <AISparkleIcon className="w-3 h-3 text-white" />
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/10 p-3">
          {/* Image previews */}
          {imagePreviews.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {imagePreviews.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img} alt="Selected" className="h-12 w-12 object-cover rounded-lg border border-white/20" />
                  <button type="button" onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] hover:bg-red-600">×</button>
                </div>
              ))}
              {selectedImages.length < 4 && (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="h-12 w-12 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-gray-500 hover:text-white hover:border-white/40 transition-colors">
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
              className="p-2 bg-white/5 text-gray-400 border border-white/10 rounded-lg hover:bg-white/10 hover:text-white transition-all"
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
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-50 transition-all"
            />

            {/* Voice button */}
            <button
              type="button"
              onClick={isListening ? stopListening : startListening}
              className={`relative p-2 rounded-lg transition-all duration-200 ${
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
              disabled={loading || (!input.trim() && selectedImages.length === 0)}
              className="p-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg shadow-md shadow-purple-500/20 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
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
        onClick={() => setIsOpen((prev) => !prev)}
        className={`fixed bottom-6 right-6 z-[9999] w-14 h-14 rounded-full shadow-lg shadow-purple-500/40 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 ${
          isOpen
            ? 'bg-slate-800 border border-white/20'
            : 'bg-gradient-to-br from-purple-600 to-blue-600'
        }`}
        aria-label={isOpen ? 'Close SAMS AI Assistant' : 'Open SAMS AI Assistant'}
      >
        {/* Pulse ring animation when closed */}
        {!isOpen && (
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 animate-ping opacity-20" />
        )}

        {isOpen ? (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
