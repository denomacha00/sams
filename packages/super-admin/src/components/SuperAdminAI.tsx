import React, { useState, useRef, useEffect } from 'react';
import apiClient from '../services/apiClient';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actionAvailable?: {
    action: string;
    params: Record<string, unknown>;
    label: string;
  };
}

const SuperAdminAI: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '👋 Hello, Super Admin! I\'m your AI system assistant. I can help you with:\n\n' +
        '• **System stats** — "how many schools", "total revenue", "platform overview"\n' +
        '• **Troubleshooting** — "why is a school not working", "common problems"\n' +
        '• **How-to guides** — "how to generate a license", "how to suspend a school"\n' +
        '• **System architecture** — "what tech stack does SAMS use"\n' +
        '• **Admin actions** — "suspend school X", "extend license for school Y"\n\n' +
        'Ask me anything!',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const generateId = () => Math.random().toString(36).substring(2, 10);

  const detectActionIntent = (
    question: string,
  ): { action: string; params: Record<string, unknown>; label: string } | null => {
    const q = question.toLowerCase().trim();

    // Suspend school
    const suspendMatch = q.match(/suspend\s+(?:school\s+)?(.+)/i);
    if (suspendMatch && !q.includes('unsuspend') && !q.includes('how to')) {
      return {
        action: 'suspend_school',
        params: { schoolName: suspendMatch[1].trim() },
        label: `Suspend school "${suspendMatch[1].trim()}"`,
      };
    }

    // Unsuspend school
    const unsuspendMatch = q.match(/unsuspend\s+(?:school\s+)?(.+)/i);
    if (unsuspendMatch) {
      return {
        action: 'unsuspend_school',
        params: { schoolName: unsuspendMatch[1].trim() },
        label: `Unsuspend school "${unsuspendMatch[1].trim()}"`,
      };
    }

    // Extend license
    const extendMatch = q.match(/extend\s+(?:license\s+(?:for\s+)?)?(?:school\s+)?(.+?)(?:\s+(?:by|to|for)\s+(\d+)\s*(days?|months?|years?))?$/i);
    if (extendMatch && !q.includes('how to')) {
      const days = extendMatch[2] ? parseInt(extendMatch[2]) : 30;
      const unit = extendMatch[3] || 'days';
      let daysToAdd = days;
      if (unit.startsWith('month')) daysToAdd = days * 30;
      if (unit.startsWith('year')) daysToAdd = days * 365;
      return {
        action: 'extend_license',
        params: { schoolName: extendMatch[1].trim(), daysToAdd },
        label: `Extend license for "${extendMatch[1].trim()}" by ${daysToAdd} days`,
      };
    }

    // Generate license
    const genMatch = q.match(/generate\s+(?:a\s+)?license\s+(?:for\s+)?(?:the\s+)?(\w+)\s*(?:plan|tier)?/i);
    if (genMatch && !q.includes('how to')) {
      return {
        action: 'generate_license',
        params: { planTier: genMatch[1].toUpperCase() },
        label: `Generate a ${genMatch[1].toUpperCase()} license`,
      };
    }

    // Get system stats
    if (/^(?:get\s+)?(?:system\s+)?stats$/i.test(q) || /^platform\s+overview$/i.test(q)) {
      return {
        action: 'get_system_stats',
        params: {},
        label: 'Get system statistics',
      };
    }

    return null;
  };

  const executeAction = async (action: string, params: Record<string, unknown>) => {
    try {
      const { data } = await apiClient.post('/super/ai-action', { action, params });
      const resultMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.message || `✅ Action "${action}" executed successfully.\n\n${JSON.stringify(data.result, null, 2)}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, resultMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `❌ Action failed: ${err.response?.data?.error || err.message || 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Check if this is an action intent
      const actionIntent = detectActionIntent(question);

      // Query the AI endpoint
      const { data } = await apiClient.post('/ai/query', { question });

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        actionAvailable: actionIntent || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${err.response?.data?.error || err.message || 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
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
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110"
        aria-label="Open Super Admin AI Assistant"
      >
        <span className="relative">
          {/* Sparkle icon */}
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
          {/* Pulse animation */}
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
        </span>
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[420px] h-[600px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-purple-700 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5 text-yellow-300"
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-200 border border-gray-700'
                  }`}
                >
                  {msg.content}
                  {msg.actionAvailable && (
                    <button
                      onClick={() => void executeAction(msg.actionAvailable!.action, msg.actionAvailable!.params)}
                      className="mt-2 w-full bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-medium py-1.5 px-3 rounded transition-colors"
                    >
                      ⚡ Execute: {msg.actionAvailable.label}
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

          {/* Input */}
          <div className="border-t border-gray-700 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about the system..."
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                disabled={loading}
              />
              <button
                onClick={() => void handleSend()}
                disabled={loading || !input.trim()}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-2 rounded-lg transition-colors"
                aria-label="Send message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Try: "how many schools" • "suspend school X" • "system architecture"
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default SuperAdminAI;
