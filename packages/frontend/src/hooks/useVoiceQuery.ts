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
  const hfpStreamRef = useRef<MediaStream | null>(null);
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

  // ── HFP keepalive: hold an audio stream to keep BT in HFP mode ──
  const startHfpKeepalive = useCallback(async () => {
    stopHfpKeepalive();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      hfpStreamRef.current = stream;
      hfpTimerRef.current = setInterval(async () => {
        if (!shouldRestartRef.current) return;
        try {
          const ns = await navigator.mediaDevices.getUserMedia({ audio: true });
          const os = hfpStreamRef.current;
          hfpStreamRef.current = ns;
          if (os) os.getTracks().forEach(t => t.stop());
        } catch {}
      }, 5000);
    } catch {}
  }, []);

  const stopHfpKeepalive = useCallback(() => {
    if (hfpTimerRef.current) { clearInterval(hfpTimerRef.current); hfpTimerRef.current = null; }
    if (hfpStreamRef.current) { hfpStreamRef.current.getTracks().forEach(t => t.stop()); hfpStreamRef.current = null; }
  }, []);

  const stopListeningInternal = useCallback(() => {
    shouldRestartRef.current = false;
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    stopHfpKeepalive();
    setIsListening(false);
  }, [clearSilenceTimer, clearScheduledRestart, stopHfpKeepalive]);

  const pauseRecognition = useCallback(() => {
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
    // HFP stream stays alive
  }, [clearSilenceTimer, clearScheduledRestart]);

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
        setError('Bluetooth mic switching... tap again if it fails.');
        if (shouldRestartRef.current) {
          clearScheduledRestart();
          scheduledRestartRef.current = setTimeout(() => {
            if (shouldRestartRef.current) {
              startHfpKeepalive().then(() => {
                if (!shouldRestartRef.current) return;
                const nr = createAndStartRecognition();
                recognitionRef.current = nr;
              });
            }
          }, 600);
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

  const setAiSpeaking = useCallback((speaking: boolean) => {
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

    startHfpKeepalive().then(() => {
      if (!shouldRestartRef.current) return;
      const recognition = createAndStartRecognition();
      recognitionRef.current = recognition;
    });
  }, [clearSilenceTimer, clearScheduledRestart, startHfpKeepalive, createAndStartRecognition]);

  const stopListening = useCallback(() => {
    stopListeningInternal();
  }, [stopListeningInternal]);

  const reInitMic = useCallback(() => {
    stopListeningInternal();
    setError(null);
    setTimeout(() => { startListening(); }, 300);
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
