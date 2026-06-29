import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

const RESTART_DELAY_MS = 600;

/**
 * Hook for voice conversation with Bluetooth headset support.
 *
 * On Android Chrome, SpeechRecognition uses the OS communication device.
 * Bluetooth headsets use HFP (Hands-Free Profile) for mic. Unlike media
 * playback (A2DP), HFP is only active when the mic is actually being
 * used by an app.
 *
 * The approach here:
 * 1. Start SpeechRecognition directly (no HFP keepalive - that can
 *    conflict on some phones)
 * 2. When AI speaks in voice mode, pause recognition, show text
 * 3. After AI is done, restart recognition
 * 4. Console.log everything so we can diagnose
 */
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
    console.log('[VoiceQuery] stopListeningInternal');
    shouldRestartRef.current = false;
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); console.log('[VoiceQuery] recognition aborted'); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [clearSilenceTimer, clearScheduledRestart]);

  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('[VoiceQuery] Speech recognition NOT supported');
      setError('Speech recognition not supported.');
      return null;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-KE';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('[VoiceQuery] recognition.onstart fired');
      setError(null);
      setIsListening(true);
      resetSilenceTimer();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      console.log('[VoiceQuery] recognition.onresult fired', event.results.length, 'results');
      clearSilenceTimer();
      silenceStageRef.current = 'none';
      const result = event.results[0]?.[0];
      const transcript = result?.transcript;
      const confidence = result?.confidence ?? 0;
      console.log(`[VoiceQuery] transcript="${transcript}" confidence=${confidence}`);
      if (transcript && transcript.trim()) {
        if (confidence > 0.3 || transcript.length > 3) {
          submitQuery(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.log('[VoiceQuery] recognition.onerror', event.error, event.message);
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      setError(`Mic: ${event.error}. Tap mic again.`);
      if (shouldRestartRef.current) {
        setTimeout(() => {
          if (shouldRestartRef.current) {
            console.log('[VoiceQuery] retrying after error');
            const nr = createAndStartRecognition();
            recognitionRef.current = nr;
          }
        }, 1000);
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      console.log('[VoiceQuery] recognition.onend fired, shouldRestart=', shouldRestartRef.current, 'isAiSpeaking=', isAiSpeakingRef.current);
      if (shouldRestartRef.current) {
        resetSilenceTimer();
        if (isAiSpeakingRef.current) return;

        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          try {
            console.log('[VoiceQuery] restarting recognition');
            recognition.start();
          } catch (e: any) {
            console.log('[VoiceQuery] recognition.start() threw:', e?.message);
            if (shouldRestartRef.current) {
              scheduledRestartRef.current = setTimeout(() => {
                if (shouldRestartRef.current) {
                  console.log('[VoiceQuery] creating new recognition after start() failure');
                  const nr = createAndStartRecognition();
                  recognitionRef.current = nr;
                }
              }, RESTART_DELAY_MS);
            }
          }
        }, RESTART_DELAY_MS);
        return;
      }
      setIsListening(false);
    };

    try {
      console.log('[VoiceQuery] calling recognition.start()');
      recognition.start();
      console.log('[VoiceQuery] recognition.start() succeeded');
    } catch (e: any) {
      console.error('[VoiceQuery] recognition.start() threw', e?.message);
      setError('Could not start mic.');
      setIsListening(false);
      return null;
    }

    return recognition;
  }, [submitQuery, resetSilenceTimer, clearScheduledRestart]);

  // ── pauseRecognition: stop recognition WITHOUT releasing mic ─────
  const pauseRecognition = useCallback(() => {
    console.log('[VoiceQuery] pauseRecognition');
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, [clearSilenceTimer, clearScheduledRestart]);

  const setAiSpeaking = useCallback((speaking: boolean) => {
    console.log('[VoiceQuery] setAiSpeaking', speaking);
    isAiSpeakingRef.current = speaking;
    if (speaking) {
      clearSilenceTimer();
      clearScheduledRestart();
    } else {
      resetSilenceTimer();
      if (shouldRestartRef.current) {
        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          if (recognitionRef.current) {
            try { recognitionRef.current.start(); return; }
            catch { /* fall through */ }
          }
          console.log('[VoiceQuery] creating new recognition after AI done');
          const nr = createAndStartRecognition();
          recognitionRef.current = nr;
        }, RESTART_DELAY_MS);
      }
    }
  }, [resetSilenceTimer, clearScheduledRestart, createAndStartRecognition]);

  const startListening = useCallback(() => {
    console.log('[VoiceQuery] startListening');
    setError(null);
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    shouldRestartRef.current = true;

    const recognition = createAndStartRecognition();
    recognitionRef.current = recognition;
  }, [clearSilenceTimer, clearScheduledRestart, createAndStartRecognition]);

  const stopListening = useCallback(() => {
    console.log('[VoiceQuery] stopListening');
    stopListeningInternal();
  }, [stopListeningInternal]);

  const reInitMic = useCallback(() => {
    console.log('[VoiceQuery] reInitMic');
    stopListeningInternal();
    setError(null);
    setTimeout(() => {
      startListening();
    }, 300);
  }, [stopListeningInternal, startListening]);

  return {
    isListening,
    error,
    startListening,
    stopListening,
    setAiSpeaking,
    reInitMic,
    silenceStage: silenceStageRef,
    pauseRecognition,
  };
}
