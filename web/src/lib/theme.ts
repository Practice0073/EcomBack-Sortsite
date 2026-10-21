import { useCallback, useEffect, useState } from 'react';

/** Light/dark theme: stored choice wins, otherwise the OS preference (applied before paint in index.html). */
export type Theme = 'light' | 'dark';
const KEY = 'ss.theme';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode / storage blocked: the choice lasts for this page only */
  }
  window.dispatchEvent(new CustomEvent('ss-theme', { detail: theme }));
}

/** React hook: the active theme, re-rendering when it changes (toggle or OS switch while unset). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setState] = useState<Theme>(currentTheme);
  useEffect(() => {
    const onChange = () => setState(currentTheme());
    window.addEventListener('ss-theme', onChange);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onOs = (e: MediaQueryListEvent) => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        /* ignore */
      }
      if (!stored) {
        document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
        onChange();
      }
    };
    mq.addEventListener('change', onOs);
    return () => {
      window.removeEventListener('ss-theme', onChange);
      mq.removeEventListener('change', onOs);
    };
  }, []);
  const set = useCallback((t: Theme) => setTheme(t), []);
  return [theme, set];
}

/** Read a design token for canvas/SVG drawing code (charts, 3D site map). */
export function cssVar(name: string, fallback = '#000'): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
