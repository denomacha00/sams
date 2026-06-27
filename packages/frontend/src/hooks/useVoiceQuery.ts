import { useState, useRef, useCallback } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

const SILENCE_TIMEOUT_MS = 20000; // 20 seconds of silence → ask if done
const FINAL_SILENCE_TIMEOUT_MS = 10000; // 10 more seconds → auto-close

/**
 * Hook for natural hands-free voice conversation with silence detection.
 *
 * Flow:
 * 1. Tap mic once → continuous listening starts
 * 2. Speak a command → it submits → AI speaks response → mic RE-OPENS
 * 3. Speak the next command → no re-tapping needed
 * 4. If silent for 20s → onSilence callback fires (AI asks "are you done?")
 * 5. Say "yes/im done" → submitQuery sends done → mic closes
 * 6. If silent for another 10s after prompt → auto-closes
 * 7. Tap mic again to stop anytime
 */
export function useVoiceQuery(
  submitQuery: (transcript: string) => void,
  options?: {
    onSilence?: () => void;        // Called after 20s silence
    onAutoClose?: () => void;      // Called when auto-closing after prolonged silence
  },
) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceStageRef = useRef<'none' | 'prompted' | 'closing'>('none');
  const isAiSpeakingRef = useRef(false);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    if (!shouldRestartRef.current) return;

    // Stage 1: After 20s silence → prompt
    silenceStageRef.current = 'none';
    silenceTimerRef.current = setTimeout(() => {
      if (!shouldRestartRef.current || isAiSpeakingRef.current) return;
      silenceStageRef.current = 'prompted';
      options?.onSilence?.();

      // Stage 2: After another 10s → auto-close
      silenceTimerRef.current = setTimeout(() => {
        if (!shouldRestartRef.current) return;
        silenceStageRef.current = 'closing';
        options?.onAutoClose?.();
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch { /* ignore */ }
          recognitionRef.current = null;
        }
        shouldRestartRef.current = false;
        setIsListening(false);
      }, FINAL_SILENCE_TIMEOUT_MS);
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, options]);

  /** Mark when AI is speaking so silence timer doesn't fire during speech */
  const setAiSpeaking = useCallback((speaking: boolean) => {
    isAiSpeakingRef.current = speaking;
    if (speaking) {
      clearSilenceTimer();
    } else {
      resetSilenceTimer();
    }
  }, [clearSilenceTimer, resetSilenceTimer]);

  const startListening = useCallback(() => {
    setError(null);
    clearSilenceTimer();
    silenceStageRef.current = 'none';

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-KE';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      resetSilenceTimer();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // User spoke — clear silence timer
      clearSilenceTimer();
      silenceStageRef.current = 'none';

      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        submitQuery(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Don't restart on error — silence timer handles it
        return;
      }
      setError(`Speech recognition error: ${event.error}`);
      // Re-open mic if we should keep listening
      if (shouldRestartRef.current) {
        try { recognition.start(); } catch { /* ignore */ }
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Re-open mic for next utterance if still in conversation mode
      if (shouldRestartRef.current) {
        resetSilenceTimer();
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
        return;
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    recognition.start();
  }, [submitQuery, clearSilenceTimer, resetSilenceTimer]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    clearSilenceTimer();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [clearSilenceTimer]);

  return {
    isListening,
    error,
    startListening,
    stopListening,
    setAiSpeaking,
    silenceStage: silenceStageRef,
  };
}
