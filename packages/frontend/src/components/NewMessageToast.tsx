import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type?: string | null;
  senderName?: string | null;
  senderRole?: string | null;
  batchId?: string | null;
  timestamp: string;
}

// ─── Global toast queue ───────────────────────────────────────────────────────

type ToastListener = (msg: ToastMessage) => void;

let toastQueue: ToastMessage[] = [];
let toastListener: ToastListener | null = null;
let lastToastKey: string | null = null;
let lastToastAt = 0;

const QUIET_NOTIFICATION_TYPES = new Set(['DAILY_SCHEDULE']);

function shouldShowToast(msg: ToastMessage): boolean {
  if (msg.type && QUIET_NOTIFICATION_TYPES.has(msg.type)) return false;
  const key = msg.id || `${msg.batchId ?? ''}:${msg.type ?? ''}:${msg.title}:${msg.message}`;
  const now = Date.now();
  if (key === lastToastKey && now - lastToastAt < 2500) return false;
  lastToastKey = key;
  lastToastAt = now;
  return true;
}

/** Called from the socket hook when a new notification arrives. */
export function enqueueNewMessageToast(msg: ToastMessage): void {
  if (!shouldShowToast(msg)) return;
  toastQueue = [...toastQueue, msg].slice(-1); // keep only the most recent
  toastListener?.(msg);
  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toastQueue = toastQueue.filter((m) => m.id !== msg.id);
  }, 5000);
}

// ─── Toast Component ──────────────────────────────────────────────────────────

/** WhatsApp/Telegram-style toast that appears at the top of the screen. */
const NewMessageToast: React.FC = () => {
  const navigate = useNavigate();
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    dismissTimerRef.current = null;
    clearTimerRef.current = null;
  }, []);

  const hideToast = useCallback(() => {
    clearTimers();
    setDismissing(true);
    clearTimerRef.current = setTimeout(() => {
      setVisible(false);
      setMessage(null);
      setDismissing(false);
      clearTimerRef.current = null;
    }, 300);
  }, [clearTimers]);

  const showToast = useCallback((msg: ToastMessage) => {
    clearTimers();
    setDismissing(false);
    setMessage(msg);
    setVisible(true);

    dismissTimerRef.current = setTimeout(() => {
      hideToast();
      dismissTimerRef.current = null;
    }, 5000);
  }, [clearTimers, hideToast]);

  useEffect(() => {
    toastListener = showToast;
    // Show any queued messages
    if (toastQueue.length > 0) {
      showToast(toastQueue[toastQueue.length - 1]);
    }
    return () => {
      toastListener = null;
      clearTimers();
    };
  }, [showToast, clearTimers]);

  const handleClick = () => {
    clearTimers();
    setVisible(false);
    setMessage(null);
    navigate('/notifications');
  };

  if (!visible || !message) return null;

  const roleBadge: Record<string, string> = {
    SCHOOL_ADMIN: 'Admin',
    HOD: 'HOD',
    TEACHER: 'Teacher',
    STUDENT: 'Student',
    SUPER_ADMIN: 'Super Admin',
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-sm px-4">
      <div
        onClick={handleClick}
        className={`
          cursor-pointer flex items-start gap-3 rounded-2xl border border-emerald-500/30
          bg-[#1a2e2e] shadow-2xl p-4 transition-all duration-300
          ${visible ? 'animate-message-slide-in opacity-100' : ''}
          ${dismissing ? 'opacity-0 translate-y-[-12px]' : ''}
          hover:bg-[#1f3333] hover:border-emerald-500/50
        `}
        style={{
          animation: visible ? 'messageSlideIn 0.3s ease-out' : 'none',
        }}
      >
        {/* Green status bar — WhatsApp-style */}
        <div className="w-2 self-stretch rounded-full bg-emerald-500 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">
              New Message
            </span>
            {message.senderRole && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600/20 text-emerald-300 border border-emerald-500/20">
                {roleBadge[message.senderRole] || message.senderRole}
              </span>
            )}
          </div>

          <p className="text-sm font-semibold text-[#e9edef] truncate">
            {message.title || 'New Message'}
            {message.senderName && (
              <span className="text-[#8696a0] font-normal">
                {' '}— {message.senderName}
              </span>
            )}
          </p>

          <p className="text-sm text-[#aebac1] truncate mt-0.5">{message.message}</p>
        </div>

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            hideToast();
          }}
          className="p-1 rounded-lg text-[#8696a0] hover:text-[#e9edef] hover:bg-white/10 transition-all shrink-0 self-start"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default NewMessageToast;
