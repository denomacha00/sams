import { useEffect, useState } from 'react';

export type AiTypingStage = 'idle' | 'thinking' | 'writing';

export function useAiTypingStage(
  active: boolean,
  writingSignal = false,
  writingDelayMs = 1400,
): AiTypingStage {
  const [stage, setStage] = useState<AiTypingStage>('idle');

  useEffect(() => {
    if (!active) {
      setStage('idle');
      return;
    }

    setStage(writingSignal ? 'writing' : 'thinking');
    if (writingSignal) return;

    const timer = globalThis.setTimeout(() => setStage('writing'), writingDelayMs);
    return () => globalThis.clearTimeout(timer);
  }, [active, writingSignal, writingDelayMs]);

  return stage;
}
