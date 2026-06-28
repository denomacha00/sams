import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Character-by-character typewriter animation hook.
 *
 * When `text` changes, it resets and begins revealing one character
 * at a time at the given `speed` (ms per character).
 *
 * Returns:
 *   displayText — the progressively revealed string
 *   isComplete — true once all characters have been revealed
 *   index      — current character position (0-based)
 */
export function useTypewriter(
  text: string,
  speed: number = 25,
): {
  displayText: string;
  isComplete: boolean;
  index: number;
} {
  const [index, setIndex] = useState(0);
  const textRef = useRef(text);
  const speedRef = useRef(speed);

  // Keep refs in sync without re-running effects
  textRef.current = text;
  speedRef.current = speed;

  // Reset animation when text changes
  useEffect(() => {
    setIndex(0);
  }, [text]);

  // Advance one character at a time
  useEffect(() => {
    const currentText = textRef.current;
    if (index < currentText.length) {
      const timer = setTimeout(() => {
        setIndex((prev) => prev + 1);
      }, speedRef.current);
      return () => clearTimeout(timer);
    }
  }, [index]);

  const isComplete = text.length > 0 && index >= text.length;

  return {
    displayText: text.slice(0, index),
    isComplete,
    index,
  };
}