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
const RESTART_DELAY_MS = 300; // Short delay before restarting mic after AI speaks

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
 *
 * Bluetooth headset / external mic support:
 * - When Bluetooth connects mid-session, the browser fires audio device changes.
 * - We detect this and automatically restart SpeechRecognition so the
 *   Bluetooth mic is used instead of the laptop/phone mic.
 * - SpeechRecognition must be restarted after audio output (speechSynthesis)
 *   finishes, with a small delay to let Bluetooth audio settle.
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

  /**
   * Actually create and start the SpeechRecognition instance.
   * This is extracted so we can restart it cleanly after Bluetooth
   * device changes or after AI speech synthesis finishes.
   */
  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser.');
      return null;
    }

    // Abort any existing instance first
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-KE'; // Kenyan English
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

      const result = event.results[0]?.[0];
      const transcript = result?.transcript;
      const confidence = result?.confidence ?? 0;
      if (transcript && transcript.trim()) {
        // Only submit if confidence is decent (>30%) to avoid noise triggers
        if (confidence > 0.3 || transcript.length > 3) {
          submitQuery(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Track audio device changes so we can restart
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Don't show as error — restart is handled in onend
        return;
      }
      // Audio capture errors (e.g. Bluetooth device disconnected/changed)
      if (
        event.error === 'audio-capture' ||
        event.error === 'bad-grammar' ||
        event.error === 'not-allowed'
      ) {
        setError(`Can't access mic. Check your Bluetooth headset or mic permissions.`);
        // If we should keep listening, auto-restart after a delay
        if (shouldRestartRef.current) {
          clearScheduledRestart();
          scheduledRestartRef.current = setTimeout(() => {
            if (shouldRestartRef.current) {
              const newRec = createAndStartRecognition();
              recognitionRef.current = newRec;
            }
          }, 2000);
        }
        return;
      }
      setError(`Mic error: ${event.error}. Tap the mic button to try again.`);
      if (shouldRestartRef.current) {
        // Try restarting after a short delay
        setTimeout(() => {
          if (shouldRestartRef.current) {
            const newRec = createAndStartRecognition();
            recognitionRef.current = newRec;
          }
        }, 1000);
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Re-open mic for next utterance if still in conversation mode
      if (shouldRestartRef.current) {
        resetSilenceTimer();

        // When AI is speaking (speechSynthesis active), the mic competes
        // with the speaker output — Bluetooth headsets can't do both.
        // Wait for AI to finish, then restart.
        if (isAiSpeakingRef.current) {
          // Don't restart now — wait for setAiSpeaking(false)
          return;
        }

        // Restart with small delay to let audio system settle
        // (especially important for Bluetooth where the mic needs to
        //  re-activate after the speaker stops)
        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          try {
            recognition.start();
          } catch {
            // If start fails (e.g. audio device still busy), try again later
            if (shouldRestartRef.current) {
              scheduledRestartRef.current = setTimeout(() => {
                if (shouldRestartRef.current) {
                  const newRec = createAndStartRecognition();
                  recognitionRef.current = newRec;
                }
              }, 1500);
            }
          }
        }, RESTART_DELAY_MS);
        return;
      }
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (e) {
      setError('Could not start mic. Check mic permissions or Bluetooth connection.');
      setIsListening(false);
      return null;
    }

    return recognition;
  }, [submitQuery, resetSilenceTimer, clearScheduledRestart]);

  /** Mark when AI is speaking so silence timer doesn't fire during speech */
  const setAiSpeaking = useCallback((speaking: boolean) => {
    isAiSpeakingRef.current = speaking;

    if (speaking) {
      clearSilenceTimer();
      clearScheduledRestart();
    } else {
      // AI finished speaking — restart listening after short delay
      // This gives Bluetooth audio time to switch from speaker → mic mode
      resetSilenceTimer();
      if (shouldRestartRef.current) {
        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          // First try to restart existing recognition instance
          if (recognitionRef.current) {
            try {
              recognitionRef.current.start();
              return;
            } catch {
              // Failed — create fresh instance
            }
          }
          const newRec = createAndStartRecognition();
          recognitionRef.current = newRec;
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

  return {
    isListening,
    error,
    startListening,
    stopListening,
    setAiSpeaking,
    silenceStage: silenceStageRef,
  };
}
