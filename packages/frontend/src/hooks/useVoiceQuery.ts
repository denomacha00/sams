import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

const SILENCE_TIMEOUT_MS = 20000;
const FINAL_SILENCE_TIMEOUT_MS = 10000;
const BLUETOOTH_SETTLE_MS = 1500;

/**
 * Hook for hands-free voice conversation with Bluetooth headset support.
 *
 * CRITICAL BUG FIXED: SpeechRecognition in Chrome/Edge uses the OS default
 * audio input device DIRECTLY — it does NOT use a MediaStream. This means
 * calling getUserMedia() alone doesn't change which mic SpeechRecognition uses.
 *
 * Solution:
 * 1. Force-getUserMedia() on start to "wake up" Bluetooth HFP profile
 * 2. Listen for navigator.mediaDevices.ondevicechange to auto-restart when
 *    Bluetooth connects/disconnects
 * 3. Show available mic names so user can verify Bluetooth detection
 * 4. On 'audio-capture' errors (Bluetooth profile switch), re-enumerate
 *    and restart with longer delay
 * 5. Return a reInitMic function so the UI can offer "tap twice" recovery
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
  const [availableMics, setAvailableMics] = useState<string[]>([]);
  const [batterySaving, setBatterySaving] = useState(false);
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceStageRef = useRef<'none' | 'prompted' | 'closing'>('none');
  const isAiSpeakingRef = useRef(false);
  const scheduledRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceLabelSet = useRef(new Set<string>());

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
      }, FINAL_SILENCE_TIMEOUT_MS);
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, options]);

  /**
   * Check which microphones are available. This forces the browser to
   * enumerate all audio inputs including recently connected Bluetooth headsets.
   */
  const enumerateMics = useCallback(async (): Promise<string[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      const labels = audioInputs
        .filter((d) => d.label)
        .map((d) => d.label);
      const uniqLabels = [...new Set(labels)];
      if (uniqLabels.length > 0) {
        const changed =
          uniqLabels.some((l) => !deviceLabelSet.current.has(l)) ||
          deviceLabelSet.current.size !== uniqLabels.length;
        if (changed) {
          deviceLabelSet.current = new Set(uniqLabels);
          console.log('[VoiceQuery] Mics changed:', uniqLabels);
        }
        setAvailableMics(uniqLabels);
      } else if (audioInputs.length > 0) {
        // Some browsers hide labels without getUserMedia permission
        setAvailableMics([`${audioInputs.length} mic(s) detected`]);
      } else {
        setAvailableMics([]);
      }
      return uniqLabels;
    } catch {
      return [];
    }
  }, []);

  /**
   * Force the browser to enumerate audio devices and wake up Bluetooth.
   * This sends a brief audio stream request which causes the OS to
   * activate the Bluetooth Hands-Free Profile (HFP) if a headset is connected.
   */
  const wakeBluetoothMic = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // Hold stream briefly then release — this is enough to trigger
      // the OS to set the Bluetooth mic as active/default
      await new Promise((r) => setTimeout(r, 200));
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.warn('[VoiceQuery] getUserMedia for Bluetooth wake failed:', err);
    }
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
    setIsListening(false);
  }, [clearSilenceTimer, clearScheduledRestart]);

  const createAndStartRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition is not supported.');
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

      // Bluetooth headsets cause 'audio-capture' when switching HFP↔HSP
      if (event.error === 'audio-capture' || event.error === 'not-allowed') {
        console.warn('[VoiceQuery] BT profile switch — audio-capture');
        setError('Bluetooth mic switching. Tap mic twice to re-init.');
        if (shouldRestartRef.current) {
          clearScheduledRestart();
          scheduledRestartRef.current = setTimeout(() => {
            if (shouldRestartRef.current) {
              wakeBluetoothMic().then(() => {
                enumerateMics().then(() => {
                  const nr = createAndStartRecognition();
                  recognitionRef.current = nr;
                });
              });
            }
          }, BLUETOOTH_SETTLE_MS);
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
              }, BLUETOOTH_SETTLE_MS);
            }
          }
        }, BLUETOOTH_SETTLE_MS);
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
  }, [submitQuery, resetSilenceTimer, clearScheduledRestart, wakeBluetoothMic, enumerateMics]);

  // ── Listen for device changes (Bluetooth connect/disconnect) ─────
  useEffect(() => {
    const handler = () => {
      console.log('[VoiceQuery] Audio device changed — re-enumerating');
      enumerateMics();
      // If listening, restart to pick up new Bluetooth mic
      if (shouldRestartRef.current && !isAiSpeakingRef.current) {
        stopListeningInternal();
        wakeBluetoothMic().then(() => {
          enumerateMics().then(() => {
            if (shouldRestartRef.current) {
              const nr = createAndStartRecognition();
              recognitionRef.current = nr;
            }
          });
        });
      }
    };
    navigator.mediaDevices?.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handler);
  }, [enumerateMics, wakeBluetoothMic, createAndStartRecognition, stopListeningInternal]);

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
          wakeBluetoothMic().then(() => {
            if (!shouldRestartRef.current) return;
            if (recognitionRef.current) {
              try { recognitionRef.current.start(); return; }
              catch { /* fall through */ }
            }
            const nr = createAndStartRecognition();
            recognitionRef.current = nr;
          });
        }, BLUETOOTH_SETTLE_MS);
      }
    }
  }, [resetSilenceTimer, clearScheduledRestart, createAndStartRecognition, wakeBluetoothMic]);

  const startListening = useCallback(() => {
    setError(null);
    clearSilenceTimer();
    clearScheduledRestart();
    silenceStageRef.current = 'none';
    shouldRestartRef.current = true;

    // Step 1: Wake up Bluetooth mic first
    wakeBluetoothMic().then(() => {
      // Step 2: Enumerate mics (logs available devices)
      enumerateMics().then(() => {
        // Step 3: Start recognition
        if (!shouldRestartRef.current) return;
        const recognition = createAndStartRecognition();
        recognitionRef.current = recognition;
      });
    });
  }, [clearSilenceTimer, clearScheduledRestart, wakeBluetoothMic, enumerateMics, createAndStartRecognition]);

  const stopListening = useCallback(() => {
    stopListeningInternal();
  }, [stopListeningInternal]);

  /** Re-initialize mic — called when user taps mic button twice */
  const reInitMic = useCallback(() => {
    stopListeningInternal();
    setError(null);
    setBatterySaving(true);
    setTimeout(() => {
      setBatterySaving(false);
      startListening();
    }, 300);
  }, [stopListeningInternal, startListening]);

  return {
    isListening,
    error,
    availableMics,
    batterySaving,
    startListening,
    stopListening,
    setAiSpeaking,
    reInitMic,
    silenceStage: silenceStageRef,
  };
}
