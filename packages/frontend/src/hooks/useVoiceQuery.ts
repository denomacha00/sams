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
const MAX_AUDIO_CAPTURE_RETRIES = 3;

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
  const hfpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCaptureRetriesRef = useRef(0);

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
    } catch {
      // Mic unavailable — recognition will fail with audio-capture, handled below
    }
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
    audioCaptureRetriesRef.current = 0;
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
    // Prevent onend from auto-restarting while AI is speaking
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setIsListening(false);
    // HFP stream stays alive for quick resume
  }, [clearSilenceTimer, clearScheduledRestart]);

  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser.');
      return null;
    }

    // Clean up any previous instance before creating a new one
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-KE';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let endedNormally = false;

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
        // Reset audio-capture retries on successful result
        audioCaptureRetriesRef.current = 0;
        if (confidence > 0.3 || transcript.length > 3) {
          submitQuery(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      if (event.error === 'audio-capture' || event.error === 'not-allowed') {
        endedNormally = true;

        if (event.error === 'not-allowed') {
          setError('Microphone access denied. Check browser permissions and tap the mic again.');
          shouldRestartRef.current = false;
          stopListeningInternal();
          return;
        }

        // audio-capture: BT headset switching — retry with backoff
        audioCaptureRetriesRef.current += 1;
        if (audioCaptureRetriesRef.current > MAX_AUDIO_CAPTURE_RETRIES) {
          setError('Mic keeps disconnecting. Try a different headset or use the text box.');
          shouldRestartRef.current = false;
          stopListeningInternal();
          return;
        }

        setError(`Bluetooth mic switching… (${audioCaptureRetriesRef.current}/${MAX_AUDIO_CAPTURE_RETRIES})`);
        if (shouldRestartRef.current) {
          clearScheduledRestart();
          scheduledRestartRef.current = setTimeout(() => {
            if (!shouldRestartRef.current) return;
            // Refresh HFP stream then create new recognition
            startHfpKeepalive().then(() => {
              if (!shouldRestartRef.current) return;
              const nr = createAndStartRecognition();
              recognitionRef.current = nr;
            });
          }, RESTART_DELAY_MS * audioCaptureRetriesRef.current);
        }
        return;
      }

      setError(`Mic: ${event.error}. Tap mic again.`);
      if (shouldRestartRef.current) {
        clearScheduledRestart();
        scheduledRestartRef.current = setTimeout(() => {
          if (!shouldRestartRef.current) return;
          const nr = createAndStartRecognition();
          recognitionRef.current = nr;
        }, 1000);
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (!shouldRestartRef.current) {
        setIsListening(false);
        return;
      }

      // AI is speaking — don't restart yet; onEnd from speak() will call startListening()
      if (isAiSpeakingRef.current) return;

      // If we already have a restart scheduled, don't double-schedule
      if (scheduledRestartRef.current) return;

      resetSilenceTimer();
      scheduledRestartRef.current = setTimeout(() => {
        if (!shouldRestartRef.current) return;
        // Always create a new instance — cannot restart an ended recognition on most browsers
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
  }, [submitQuery, resetSilenceTimer, clearScheduledRestart, startHfpKeepalive, stopListeningInternal]);

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
            catch { /* fall through — create new instance */ }
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
    audioCaptureRetriesRef.current = 0;
    shouldRestartRef.current = true;

    // First refresh the HFP stream to ensure mic is available
    startHfpKeepalive().then(() => {
      if (!shouldRestartRef.current) return;
      const recognition = createAndStartRecognition();
      recognitionRef.current = recognition;
    });
  }, [clearSilenceTimer, clearScheduledRestart, startHfpKeepalive, createAndStartRecognition]);

  const stopListening = useCallback(() => {
    audioCaptureRetriesRef.current = 0;
    stopListeningInternal();
  }, [stopListeningInternal]);

  const reInitMic = useCallback(() => {
    audioCaptureRetriesRef.current = 0;
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
