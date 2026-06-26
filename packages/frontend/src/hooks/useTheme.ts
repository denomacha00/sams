import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'sams-theme';
const THEME_EVENT = 'sams-theme-change';

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable
  }
  // Default to dark — SAMS ships dark-first
  return 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function setSamsTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent<{ theme: Theme }>(THEME_EVENT, { detail: { theme } }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const next = (event as CustomEvent<{ theme?: Theme }>).detail?.theme;
      if (next === 'dark' || next === 'light') {
        setThemeState(next);
      }
    };

    window.addEventListener(THEME_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_EVENT, handleThemeChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setSamsTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      setSamsTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme, setTheme };
}
