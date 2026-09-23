import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'rhdp-flow-theme';
const DARK_CLASS = 'pf-v6-theme-dark';

export type Theme = 'dark' | 'light';

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'dark') {
    root.classList.add(DARK_CLASS);
  } else {
    root.classList.remove(DARK_CLASS);
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    // When embedded, prefer the ?theme= URL param over localStorage so
    // the host app's theme drives both apps on first load.
    const param = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    ).get('theme');
    if (param === 'dark' || param === 'light') return param;
    const stored = window.localStorage?.getItem(STORAGE_KEY) ?? null;
    return (stored === 'light' || stored === 'dark') ? stored : 'dark';
  });

  useEffect(() => {
    applyTheme(theme);
    window.localStorage?.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // When embedded, listen for postMessage theme updates from the host so
  // toggling the theme in Labagator updates Flow without a reload.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'rhdp-flow:theme') {
        const t = event.data.theme as string;
        if (t === 'dark' || t === 'light') setThemeState(t);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}
