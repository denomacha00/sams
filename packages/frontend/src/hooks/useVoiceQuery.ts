import { useState, useRef, useCallback } from 'react';
import apiClient from '../services/apiClient';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

/**
 * Hook for voice input using Web Speech API.
 * Uses Kenyan English locale (en-KE).
 * On result, calls the provided submitQuery callback with the transcript.
 * Optionally sends the transcription to /api/v1/ai/voice for server-side processing.
 */
export function useVoiceQuery(submitQuery: (transcript: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    setError(null);

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
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        submitQuery(transcript);
      }
      setIsListening(false);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [submitQuery]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  /**
   * Send a voice transcription directly to the /api/v1/ai/voice endpoint.
   * This is an alternative to the local speech-to-text approach.
   */
  const sendVoiceQuery = useCallback(async (audioBlob: Blob): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice-query.webm');
      const { data } = await apiClient.post('/ai/voice', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data.answer || null;
    } catch {
      setError('Failed to process voice query.');
      return null;
    }
  }, []);

  return { isListening, error, startListening, stopListening, sendVoiceQuery };
}
