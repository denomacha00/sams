import { useState, useRef, useCallback } from 'react';

const VOICEPRINT_STORAGE_KEY = 'sams-super-voiceprint';

/**
 * Audio fingerprint — average FFT magnitudes across frequency bands
 * that capture speaker-specific formant structure.
 */
export interface VoicePrint {
  /** Average FFT magnitude per frequency band (16 bands, 0-4kHz) */
  bands: number[];
  /** RMS energy profile */
  energy: number;
  /** Spectral centroid index */
  centroid: number;
  /** When this profile was enrolled */
  enrolledAt: string;
}

/**
 * Cosine similarity between two vectors.
 * 1.0 = identical, 0 = unrelated.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Read stored voiceprint from localStorage.
 */
export function loadVoicePrint(): VoicePrint | null {
  try {
    const raw = localStorage.getItem(VOICEPRINT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VoicePrint;
  } catch {
    return null;
  }
}

/**
 * Extract a voice fingerprint from raw PCM audio data.
 * Uses FFT magnitude averages across frequency bands.
 */
function extractVoicePrint(audioData: Float32Array, sampleRate: number): VoicePrint {
  const fftSize = 2048;
  const numBands = 16;
  const bands = new Array(numBands).fill(0);
  let rmsSum = 0;
  let centroidNumerator = 0;
  let centroidDenominator = 0;

  // Process in overlapping windows
  const hopSize = fftSize / 2;
  let windowCount = 0;

  // Pre-compute Blackman-Harris window
  const windowFn = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    windowFn[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (fftSize - 1));
  }

  for (let start = 0; start + fftSize <= audioData.length; start += hopSize) {
    // Apply window and compute FFT magnitudes
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = audioData[start + i] * windowFn[i];
    }

    // Simple FFT (in-place, radix-2)
    // Since we need this to work in the browser without library deps,
    // we use a naive DFT for the key bins. For production, use FFT.js.
    // We compute magnitudes at center frequencies of each band.
    const nyquist = sampleRate / 2;
    const binFreqStep = sampleRate / fftSize;

    for (let band = 0; band < numBands; band++) {
      const centerFreq = (band + 0.5) * (nyquist / numBands);
      const binIdx = Math.round(centerFreq / binFreqStep);
      if (binIdx >= fftSize / 2) continue;

      // Compute magnitude at this bin
      let re = 0, im = 0;
      for (let k = 0; k < fftSize; k++) {
        const angle = -2 * Math.PI * k * binIdx / fftSize;
        re += real[k] * Math.cos(angle) - imag[k] * Math.sin(angle);
        im += real[k] * Math.sin(angle) + imag[k] * Math.cos(angle);
      }
      const mag = Math.sqrt(re * re + im * im) / fftSize;
      bands[band] += mag;
    }

    // Compute RMS for this window
    let windowPower = 0;
    for (let i = 0; i < fftSize; i++) {
      windowPower += audioData[start + i] * audioData[start + i];
    }
    rmsSum += Math.sqrt(windowPower / fftSize);

    // Compute spectral centroid
    let centroidNum = 0, centroidDen = 0;
    for (let binIdx = 1; binIdx < fftSize / 2; binIdx++) {
      let re = 0, im = 0;
      for (let k = 0; k < fftSize; k++) {
        const angle = -2 * Math.PI * k * binIdx / fftSize;
        re += real[k] * Math.cos(angle) - imag[k] * Math.sin(angle);
        im += real[k] * Math.sin(angle) + imag[k] * Math.cos(angle);
      }
      const mag = Math.sqrt(re * re + im * im);
      const freq = binIdx * binFreqStep;
      centroidNum += freq * mag;
      centroidDen += mag;
    }
    if (centroidDen > 0) {
      centroidNumerator += centroidNum / centroidDen;
      centroidDenominator++;
    }

    windowCount++;
  }

  // Average bands across windows
  for (let i = 0; i < numBands; i++) {
    bands[i] = bands[i] / Math.max(windowCount, 1);
  }

  // Normalize band vector
  const maxBand = Math.max(...bands, 0.0001);
  for (let i = 0; i < numBands; i++) {
    bands[i] = bands[i] / maxBand;
  }

  const centroid = centroidDenominator > 0
    ? centroidNumerator / centroidDenominator
    : 0;

  return {
    bands,
    energy: rmsSum / Math.max(windowCount, 1),
    centroid: centroid / sampleRate, // normalized to 0-0.5
    enrolledAt: new Date().toISOString(),
  };
}

/**
 * Compare two voiceprints.
 * Returns a score 0-1 where >0.7 is likely same speaker.
 */
export function compareVoicePrints(a: VoicePrint, b: VoicePrint): number {
  const bandSim = cosineSimilarity(a.bands, b.bands);
  const energyDiff = 1 - Math.abs(a.energy - b.energy) / Math.max(a.energy, b.energy, 0.01);
  const centroidDiff = 1 - Math.abs(a.centroid - b.centroid) / Math.max(a.centroid, b.centroid, 0.01);

  // Weighted combination: bands are most important
  return bandSim * 0.6 + energyDiff * 0.2 + centroidDiff * 0.2;
}

/**
 * The verification threshold.
 * Commands are accepted if match score >= this value.
 */
export const VERIFICATION_THRESHOLD = 0.65;

/**
 * Hook for voice biometric enrollment and verification.
 */
export function useVoiceBiometrics() {
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [enrollmentProgress, setEnrollmentProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Record audio for a given duration and return PCM data.
   */
  const recordAudio = useCallback(async (durationMs: number): Promise<Float32Array> => {
    const constraints = {
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];

    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the microphone
        stream.getTracks().forEach((t) => t.stop());

        // Decode the audio to PCM
        const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
        try {
          const ctx = getAudioContext();
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const pcmData = audioBuffer.getChannelData(0); // Float32Array, range -1 to 1
          resolve(pcmData);
        } catch {
          reject(new Error('Failed to decode audio'));
        }
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        reject(new Error('Recording failed'));
      };

      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, durationMs);
    });
  }, [getAudioContext]);

  /**
   * Enroll a voiceprint: record the user for 3 seconds, extract fingerprint, store.
   */
  const enroll = useCallback(async (): Promise<boolean> => {
    setIsEnrolling(true);
    setError(null);
    setEnrollmentProgress(0);

    try {
      // Phase 1: Countdown / prepare
      setEnrollmentProgress(10);

      // Record 3 seconds of voice
      const audioData = await recordAudio(3000);
      setEnrollmentProgress(60);

      // Extract voiceprint
      const voiceprint = extractVoicePrint(audioData, 16000);
      setEnrollmentProgress(80);

      // Store in localStorage
      localStorage.setItem(VOICEPRINT_STORAGE_KEY, JSON.stringify(voiceprint));
      setEnrollmentProgress(100);

      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record voice';
      setError(msg);
      return false;
    } finally {
      setIsEnrolling(false);
    }
  }, [recordAudio]);

  /**
   * Enroll with 3 recordings for higher accuracy (averages the fingerprints).
   */
  const enrollMulti = useCallback(async (): Promise<boolean> => {
    setIsEnrolling(true);
    setError(null);
    setEnrollmentProgress(0);

    try {
      const prints: VoicePrint[] = [];

      for (let i = 0; i < 3; i++) {
        setEnrollmentProgress(i * 30 + 5);
        const audioData = await recordAudio(2500);
        const vp = extractVoicePrint(audioData, 16000);
        prints.push(vp);
      }

      setEnrollmentProgress(90);

      // Average the band vectors
      const numBands = prints[0].bands.length;
      const avgBands = new Array(numBands).fill(0);
      let avgEnergy = 0, avgCentroid = 0;
      for (const p of prints) {
        for (let bi = 0; bi < numBands; bi++) {
          avgBands[bi] += p.bands[bi];
        }
        avgEnergy += p.energy;
        avgCentroid += p.centroid;
      }
      for (let bi = 0; bi < numBands; bi++) {
        avgBands[bi] /= prints.length;
      }
      avgEnergy /= prints.length;
      avgCentroid /= prints.length;

      const voiceprint: VoicePrint = {
        bands: avgBands,
        energy: avgEnergy,
        centroid: avgCentroid,
        enrolledAt: new Date().toISOString(),
      };

      localStorage.setItem(VOICEPRINT_STORAGE_KEY, JSON.stringify(voiceprint));
      setEnrollmentProgress(100);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record voice';
      setError(msg);
      return false;
    } finally {
      setIsEnrolling(false);
    }
  }, [recordAudio]);

  /**
   * Verify the current speaker against the stored voiceprint.
   * Records ~2 seconds, extracts fingerprint, compares.
   * Returns { match: boolean, score: number }.
   */
  const verify = useCallback(async (): Promise<{ match: boolean; score: number }> => {
    setIsVerifying(true);
    setError(null);

    try {
      const stored = loadVoicePrint();
      if (!stored) {
        return { match: false, score: 0 };
      }

      const audioData = await recordAudio(2000);
      const currentPrint = extractVoicePrint(audioData, 16000);
      const score = compareVoicePrints(stored, currentPrint);

      return { match: score >= VERIFICATION_THRESHOLD, score };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setError(msg);
      return { match: false, score: 0 };
    } finally {
      setIsVerifying(false);
    }
  }, [recordAudio]);

  /**
   * Check if a voiceprint is already enrolled.
   */
  const isEnrolled = useCallback((): boolean => {
    return loadVoicePrint() !== null;
  }, []);

  /**
   * Delete the stored voiceprint.
   */
  const deleteVoicePrint = useCallback(() => {
    localStorage.removeItem(VOICEPRINT_STORAGE_KEY);
  }, []);

  return {
    isEnrolling,
    isVerifying,
    enrollmentProgress,
    error,
    enroll,
    enrollMulti,
    verify,
    isEnrolled,
    deleteVoicePrint,
    loadStored: loadVoicePrint,
  };
}
