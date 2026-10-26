import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

/** Light/dark switch used in the app top bar and on the public sign-in pages. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === 'dark';
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label="Dark theme" aria-pressed={dark} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
