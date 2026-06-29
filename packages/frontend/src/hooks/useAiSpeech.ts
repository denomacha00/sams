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
 * Bluetooth headset fix:
 * - speechSynthesis uses A2DP (media), SpeechRecognition uses HFP (mic).
 * - Most BT headsets CANNOT do both at once. When speechSynthesis plays,
 *   headset locks into A2DP → mic dies → 'audio-capture' error.
 * - In voice mode: SKIP speechSynthesis, play a phone-speaker beep instead.
 * - Manual "speaker" button tap still reads aloud normally.
 */
export function useAiSpeech(options?: { onEnd?: () => void }) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndRef = useRef(options?.onEnd);
  const audioCtxRef = useRef<AudioContext | null>(null);
  onEndRef.current = options?.onEnd;

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
    return (
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Kenya')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Africa')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('UK')) ||
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('India')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
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

    if (isVoiceMode) {
      speakingRef.current = true;
      setSpeaking(true);
      playNotification();
      setTimeout(() => {
        speakingRef.current = false;
        setSpeaking(false);
        onEndRef.current?.();
      }, 400);
      return;
    }

    const cleanText = cleanTextForSpeech(text);
    if (!cleanText) return;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const preferredVoice = resolveVoice();
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en';
    utterance.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    utterance.onend = () => { speakingRef.current = false; setSpeaking(false); onEndRef.current?.(); };
    utterance.onerror = () => { speakingRef.current = false; setSpeaking(false); };
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [resolveVoice, playNotification]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
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

  return { speaking, speak, stop, toggle };
}
