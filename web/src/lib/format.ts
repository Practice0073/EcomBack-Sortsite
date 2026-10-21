import type { DateFormat } from '@shared/types';

let prefs: { timezone: string; dateFormat: DateFormat } = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, dateFormat: 'dd-mmm-yyyy' };
export const setFormatPrefs = (p: typeof prefs) => (prefs = p);

function parts(iso: string) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), date: d };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date in the user's timezone and chosen format (Account › Settings). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = parts(iso);
  switch (prefs.dateFormat) {
    case 'mm/dd/yyyy':
      return `${p.m}/${p.d}/${p.y}`;
    case 'dd/mm/yyyy':
      return `${p.d}/${p.m}/${p.y}`;
    case 'yyyy-mm-dd':
      return `${p.y}-${p.m}-${p.d}`;
    default:
      return `${p.d}-${MONTHS[Number(p.m) - 1]}-${p.y}`;
  }
}

export const fmtDateTime = (iso: string | null | undefined) => (iso ? `${fmtDate(iso)} ${parts(iso).h}:${parts(iso).min}` : '—');
export const fmtTime = (iso: string | null | undefined) => (iso ? `${parts(iso).h}:${parts(iso).min}` : '—');

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))} min`;
    if (f < 86400) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} days`;
  }
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return fmtDate(iso);
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const fmtPct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`);
export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
export const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
};
export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
