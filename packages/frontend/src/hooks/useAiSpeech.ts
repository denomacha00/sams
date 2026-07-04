import { useState, useRef, useCallback, useEffect } from 'react';

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[*_`~#|\\@<>^$+=]/g, '')
    .replace(/---+/g, ' ')
    .replace(/\.{3,}/g, '...')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Voice chat flow (man-to-man):
 * - User taps mic → SpeechRecognition listens
 * - Mic captures query → mic closes immediately
 * - AI processes query → AI speaks response aloud via speechSynthesis
 * - After AI finishes speaking → mic reopens for user to reply
 *
 * For non-voice (manual "speaker" button) the text is read aloud normally.
 * The isVoiceMode flag is tracked via ref so it can be read in callbacks.
 */
export function useAiSpeech(options?: { onEnd?: () => void; onStart?: () => void }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndRef = useRef(options?.onEnd);
  const onStartRef = useRef(options?.onStart);
  const voiceModeRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  onEndRef.current = options?.onEnd;
  onStartRef.current = options?.onStart;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const handler = () => {};
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
  }, []);

  const resolveVoice = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;
    const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const naturalVoice = englishVoices.find((v) => /natural|neural|online|premium|enhanced/i.test(v.name));
    return (
      naturalVoice ||
      englishVoices.find((v) => /Kenya|Africa/i.test(v.name)) ||
      englishVoices.find((v) => /UK|Great Britain|United Kingdom/i.test(v.name)) ||
      englishVoices.find((v) => /India/i.test(v.name)) ||
      englishVoices.find((v) => /Google|Microsoft|Samantha|Daniel|Arthur|Libby/i.test(v.name)) ||
      englishVoices[0] ||
      null
    );
  }, []);

  const playNotification = useCallback(() => {
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctor();
      const ctx = audioCtxRef.current!;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }, []);

  const speak = useCallback((text: string, isVoiceMode?: boolean) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    voiceModeRef.current = !!isVoiceMode;

    // Only play notification beep in voice mode
    if (isVoiceMode) playNotification();

    const cleanText = cleanTextForSpeech(text);
    if (!cleanText) {
      speakingRef.current = false;
      setSpeaking(false);
      voiceModeRef.current = false;
      onEndRef.current?.();
      return;
    }

    speakingRef.current = true;
    setSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const preferredVoice = resolveVoice();
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 0.94;
    utterance.pitch = 0.98;
    utterance.volume = 1.0;
    utterance.lang = 'en';

    utterance.onstart = () => {
      onStartRef.current?.();
    };
    utterance.onend = () => {
      const wasVoice = voiceModeRef.current;
      speakingRef.current = false;
      voiceModeRef.current = false;
      setSpeaking(false);
      window.speechSynthesis.cancel();
      // Only run onEnd (which reopens mic) when in voice mode
      if (wasVoice) onEndRef.current?.();
    };
    utterance.onerror = () => {
      voiceModeRef.current = false;
      speakingRef.current = false;
      setSpeaking(false);
      onEndRef.current?.();
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [resolveVoice, playNotification]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    voiceModeRef.current = false;
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const toggle = useCallback((text: string, isVoiceMode?: boolean) => {
    if (speakingRef.current) stop();
    else speak(text, isVoiceMode);
  }, [speak, stop]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  return { speaking, speak, stop, toggle, voiceModeRef };
}
