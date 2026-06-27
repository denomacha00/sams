import { useState, useRef, useCallback } from 'react';

/**
 * Browser SpeechSynthesis hook — reads AI responses aloud.
 * Built into Chrome, Safari, Firefox, Edge. No API key needed.
 * Kenyan voice preferred when available, falls back to default.
 */
export function useAiSpeech(options?: { onEnd?: () => void }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndRef = useRef(options?.onEnd);
  onEndRef.current = options?.onEnd;

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Cancel any current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Try to find a good voice — prefer African English or any English voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Kenya')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Africa')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('UK')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('India')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      null;

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.lang = 'en-KE';
    utterance.rate = 1.0;  // Normal speed
    utterance.pitch = 1.0; // Normal pitch
    utterance.volume = 1.0;

    utterance.onstart = () => {
      speakingRef.current = true;
      setSpeaking(true);
    };

    utterance.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
      onEndRef.current?.();
    };

    utterance.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const toggle = useCallback((text: string) => {
    if (speakingRef.current) {
      stop();
    } else {
      speak(text);
    }
  }, [speak, stop]);

  return { speaking, speak, stop, toggle };
}
