import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Strip emojis and markdown syntax from text before speaking.
 * Preserves punctuation (commas, periods, question marks, etc.)
 * so the browser's SpeechSynthesis creates natural pauses.
 *
 * Only removes: emoji characters, markdown formatting symbols,
 * and Unicode dingbats that would be read as words.
 */
function cleanTextForSpeech(text: string): string {
  return text
    // Remove emoji characters (ranges common in Unicode)
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // transport & map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // variation selectors
    .replace(/[\u{200D}]/gu, '')            // zero-width joiner
    // Remove markdown formatting symbols ONLY — keep punctuation for pauses
    .replace(/[*_`~#|\\@<>^$+=]/g, '')      // markdown syntax
    // Remove double/triple hyphens but keep single dash
    .replace(/---+/g, ' ')
    // Remove consecutive ellipsis dots (3+)
    .replace(/\.{3,}/g, '...')
    // Collapse multiple spaces into one
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Browser SpeechSynthesis hook — reads AI responses aloud.
 * Built into Chrome, Safari, Firefox, Edge. No API key needed.
 * Kenyan voice preferred when available, falls back to default.
 *
 * Fixes the common browser bug where getVoices() returns empty on first call:
 * we trigger voices loading on mount and re-check if still empty.
 *
 * Strips emojis and markdown symbols before speaking so the voice
 * only reads clean words — no emoji names or markdown artifacts.
 * Punctuation is preserved for natural pauses.
 */
export function useAiSpeech(options?: { onEnd?: () => void }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndRef = useRef(options?.onEnd);
  onEndRef.current = options?.onEnd;
  const voicesLoadedRef = useRef(false);

  // Force browsers to load voices on mount (getVoices returns [] on first call)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Kick-start voice loading
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      voicesLoadedRef.current = true;
    }

    // Listen for the async load event
    const handler = () => {
      voicesLoadedRef.current = true;
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
  }, []);

  const resolveVoice = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;

    return (
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Kenya')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Africa')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('UK')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('India')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      null
    );
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Cancel any current speech
    window.speechSynthesis.cancel();

    // Strip emojis, punctuation, markdown so voice only reads clean words
    const cleanText = cleanTextForSpeech(text);
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Try to find a good voice — prefer African English or any English voice
    const preferredVoice = resolveVoice();
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.rate = 1.0;  // Normal speed
    utterance.pitch = 1.0; // Normal pitch
    utterance.volume = 1.0;
    // Always set a valid lang — empty string causes Chrome to silently fail
    utterance.lang = 'en';

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
  }, [resolveVoice]);

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
