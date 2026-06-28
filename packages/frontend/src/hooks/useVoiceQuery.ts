import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

const HFP_KEEPALIVE_MS = 5000;  // Renew the HFP keepalive stream every 5s
const RESTART_DELAY_MS = 500;   // Brief pause before restarting recognition

/**
 * Hook for hands-free voice conversation with Bluetooth headset support.
 *
 * CRITICAL: On Android Chrome, SpeechRecognition uses the OS default
 * communication device. Bluetooth headsets use HFP (Hands-Free Profile)
 * for mic and A2DP for audio playback — they are mutually exclusive.
 *
 * To keep the BT headset in HFP mic mode:
 * 1. A persistent getUserMedia audio stream MUST be held open at ALL times
 * 2. NEVER release the HFP stream — even during AI response beep
 * 3. Only stop the SpeechRecognition object, keep the MediaStream alive
 * 4. After AI beep, restart SpeechRecognition (uses existing stream,
 *    no new permission prompt needed)
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
  const hfpStreamRef = useRef<MediaStream | null>(null); // Persistent BT HFP stream
  const hfpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /**
   * Open and HOLD a persistent getUserMedia audio stream.
   * This is the KEY to forcing Android to keep the Bluetooth HFP mic active.
   * Without this, Chrome's SpeechRecognition silently reverts to the
   * phone's internal mic after a few seconds.
   *
   * Works on all browsers — the catch block handles browsers that don't
   * support getUserMedia or reject the permission.
   *
   * CRITICAL: This stream must NEVER be released during voice mode.
   * Once opened, only close it when the user explicitly stops voice mode.
   */
  const startHfpKeepalive = useCallback(async (): Promise<void> => {
    // Release any existing HFP stream
    stopHfpKeepalive();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      hfpStreamRef.current = stream;

      // Renew the stream periodically to keep BT HFP alive
      // (some Android phones drop the HFP channel after ~5s of silence)
      hfpTimerRef.current = setInterval(async () => {
        if (!shouldRestartRef.current) return;
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Atomically replace the old stream with the new one
          const oldStream = hfpStreamRef.current;
          hfpStreamRef.current = newStream;
          if (oldStream) {
            oldStream.getTracks().forEach((t) => t.stop());
          }
        } catch {
          // Keep the existing stream — renewal is best-effort
        }
      }, HFP_KEEPALIVE_MS);
    } catch {
      // getUserMedia not available — BT fix not possible, fallback to internal mic
    }
  }, []);

  const stopHfpKeepalive = useCallback(() => {
    if (hfpTimerRef.current) {
      clearInterval(hfpTimerRef.current);
      hfpTimerRef.current = null;
    }
    if (hfpStreamRef.current) {
      hfpStreamRef.current.getTracks().forEach((t) => t.stop());
      hfpStreamRef.current = null;
    }
  }, []);

  // ── Pause recognition WITHOUT releasing HFP stream ────────────────────
  // This is called when AI is about to respond. We stop recognition and
  // silence timers, but KEEP the getUserMedia stream alive so the BT headset
  // stays in HFP mic mode. When AI finishes, we just restart recognition.
  const pauseRecognition = useCallback(() => {
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
    // DO NOT call stopHfpKeepalive() here — the stream stays alive
  }, [clearSilenceTimer, clearScheduledRestart]);

  const stopListeningInternal = useCallback(() => {
    shouldRestartRef.current = false;
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    stopHfpKeepalive();  // Full stop — kill everything
    setIsListening(false);
  }, [clearSilenceTimer, clearScheduledRestart, stopHfpKeepalive]);

  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
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
      setError(null);
      setIsListening(true);
      resetSilenceTimer();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      clearSilenceTimer();
      silenceStageRef.current = 'none';
      const result = event.results[0]?.[0];
      const transcript = result?.transcript;
      const confidence = result?.confidence ?? 0;
      if (transcript && transcript.trim()) {
        if (confidence > 0.3 || transcript.length > 3) {
          submitQuery(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      if (event.error === 'audio-capture' || event.error === 'not-allowed') {
        console.warn('[VoiceQuery] BT audio-capture error — re-opening HFP stream');
        setError('Bluetooth mic switching... tap again if it fails.');

        if (shouldRestartRef.current) {
          clearScheduledRestart();
          scheduledRestartRef.current = setTimeout(() => {
            if (shouldRestartRef.current) {
              // Re-create HFP keepalive, then restart
              startHfpKeepalive().then(() => {
                if (!shouldRestartRef.current) return;
                const nr = createAndStartRecognition();
                recognitionRef.current = nr;
              });
            }
          }, RESTART_DELAY_MS);
        }
        return;
      }

      setError(`Mic: ${event.error}. Tap mic again.`);
      if (shouldRestartRef.current) {
        setTimeout(() => {
          if (shouldRestartRef.current) {
            const nr = createAndStartRecognition();
            recognitionRef.current = nr;
          }
        }, 1000);
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (shouldRestartRef.current) {
        resetSilenceTimer();
        if (isAiSpeakingRef.current) return;

        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          try { recognition.start(); }
          catch {
            if (shouldRestartRef.current) {
              scheduledRestartRef.current = setTimeout(() => {
                if (shouldRestartRef.current) {
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

    try { recognition.start(); }
    catch {
      setError('Could not start mic.');
      setIsListening(false);
      return null;
    }

    return recognition;
  }, [submitQuery, resetSilenceTimer, clearScheduledRestart, startHfpKeepalive]);

  // Listen for BT connect/disconnect
  useEffect(() => {
    const handler = () => {
      console.log('[VoiceQuery] Audio device change detected');
      if (shouldRestartRef.current && !isAiSpeakingRef.current) {
        stopListeningInternal();
        startHfpKeepalive().then(() => {
          if (shouldRestartRef.current) {
            const nr = createAndStartRecognition();
            recognitionRef.current = nr;
          }
        });
      }
    };
    navigator.mediaDevices?.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handler);
  }, [createAndStartRecognition, startHfpKeepalive, stopListeningInternal]);

  const setAiSpeaking = useCallback((speaking: boolean) => {
    isAiSpeakingRef.current = speaking;
    if (speaking) {
      clearSilenceTimer();
      clearScheduledRestart();
      // HFP stream stays alive — the BT headset remains in HFP mic mode.
      // The AI response beep plays through AudioContext; on most Android
      // phones this routes through the PHONE SPEAKER, not the BT headset,
      // because we hold an open getUserMedia stream that keeps the audio
      // path locked to HFP.
    } else {
      resetSilenceTimer();
      if (shouldRestartRef.current) {
        clearScheduledRestart();
        // HFP stream is still alive (was never released), so restart
        // recognition with a short delay — no BT profile switch needed.
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

    // Step 1: Force BT HFP keepalive stream (CRITICAL for Android/Chrome)
    startHfpKeepalive().then(() => {
      // Step 2: Start recognition
      if (!shouldRestartRef.current) return;
      const recognition = createAndStartRecognition();
      recognitionRef.current = recognition;
    });
  }, [clearSilenceTimer, clearScheduledRestart, startHfpKeepalive, createAndStartRecognition]);

  const stopListening = useCallback(() => {
    stopListeningInternal();
  }, [stopListeningInternal]);

  /** Re-initialize mic — for "tap twice" recovery */
  const reInitMic = useCallback(() => {
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
    // EXPORT pauseRecognition so FloatingAI can stop recognition WITHOUT
    // releasing the HFP keepalive stream. This is the KEY to BT working —
    // the getUserMedia stream MUST stay open continuously.
    pauseRecognition,
  };
}
