import { useState, useRef, useCallback } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

const RESTART_DELAY_MS = 600;

export function useVoiceQuery(
  submitQuery: (transcript: string) => void,
  options?: {
    onSilence?: () => void;
    onAutoClose?: () => void;
  },
) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceStageRef = useRef<'none' | 'prompted' | 'closing'>('none');
  const isAiSpeakingRef = useRef(false);
  const scheduledRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearScheduledRestart = useCallback(() => {
    if (scheduledRestartRef.current) {
      clearTimeout(scheduledRestartRef.current);
      scheduledRestartRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    if (!shouldRestartRef.current) return;
    silenceStageRef.current = 'none';
    silenceTimerRef.current = setTimeout(() => {
      if (!shouldRestartRef.current || isAiSpeakingRef.current) return;
      silenceStageRef.current = 'prompted';
      options?.onSilence?.();
      silenceTimerRef.current = setTimeout(() => {
        if (!shouldRestartRef.current) return;
        silenceStageRef.current = 'closing';
        options?.onAutoClose?.();
        stopListeningInternal();
      }, 10000);
    }, 20000);
  }, [clearSilenceTimer, options]);

  const stopListeningInternal = useCallback(() => {
    shouldRestartRef.current = false;
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [clearSilenceTimer, clearScheduledRestart]);

  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser.');
      return null;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setError(null);
      setIsListening(true);
      resetSilenceTimer();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      clearSilenceTimer();
      silenceStageRef.current = 'none';
      const result = event.results[event.resultIndex];
      if (!result || !result.isFinal) return;
      const transcript = result[0]?.transcript;
      if (transcript && transcript.trim()) {
        const confidence = result[0]?.confidence ?? 0;
        if (confidence > 0.3 || transcript.length > 3) {
          submitQuery(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Check browser permissions and tap the mic again.');
        shouldRestartRef.current = false;
        stopListeningInternal();
        return;
      }
      setError(`Mic: ${event.error}. Tap mic again.`);
      if (shouldRestartRef.current) {
        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          const nr = createAndStartRecognition();
          recognitionRef.current = nr;
        }, 1500);
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (!shouldRestartRef.current) {
        setIsListening(false);
        return;
      }
      if (isAiSpeakingRef.current) return;
      if (scheduledRestartRef.current) return;
      resetSilenceTimer();
      scheduledRestartRef.current = setTimeout(() => {
        if (!shouldRestartRef.current) return;
        const nr = createAndStartRecognition();
        recognitionRef.current = nr;
      }, RESTART_DELAY_MS);
    };

    try {
      recognition.start();
      return recognition;
    } catch {
      setError('Could not start microphone. Check permissions and try again.');
      setIsListening(false);
      return null;
    }
  }, [submitQuery, clearScheduledRestart, stopListeningInternal, resetSilenceTimer]);

  const setAiSpeaking = useCallback((speaking: boolean) => {
    isAiSpeakingRef.current = speaking;
    clearSilenceTimer();
    if (!speaking) {
      resetSilenceTimer();
      if (shouldRestartRef.current) {
        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          if (recognitionRef.current) {
            try { recognitionRef.current.start(); return; }
            catch { /* fall through */ }
          }
          const nr = createAndStartRecognition();
          recognitionRef.current = nr;
        }, RESTART_DELAY_MS);
      }
    }
  }, [resetSilenceTimer, clearScheduledRestart, createAndStartRecognition]);

  const startListening = useCallback(() => {
    setError(null);
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    shouldRestartRef.current = true;
    const recognition = createAndStartRecognition();
    recognitionRef.current = recognition;
  }, [clearSilenceTimer, clearScheduledRestart, createAndStartRecognition]);

  const stopListening = useCallback(() => {
    stopListeningInternal();
  }, [stopListeningInternal]);

  return {
    isListening,
    error,
    startListening,
    stopListening,
    setAiSpeaking,
    pauseRecognition: stopListeningInternal,
  };
}
