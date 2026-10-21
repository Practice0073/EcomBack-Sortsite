import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, setCsrf, setUnauthorizedHandler } from './api';
import { setFormatPrefs } from './format';
import type { Me, Permission, ScanProgress } from '@shared/types';

// ── Auth ──────────────────────────────────────────────────────────────────────
interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  setMe: (me: Me) => void;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}
const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const setMe = useCallback((m: Me) => {
    setFormatPrefs({ timezone: m.timezone, dateFormat: m.dateFormat });
    setMeState(m);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ me: Me; csrf: string }>('/auth/me', { quiet: true });
      setCsrf(r.csrf);
      setMe(r.me);
      return r.me;
    } catch {
      setMeState(null);
      setCsrf(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setMe]);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => {
      setMeState(null);
      setCsrf(null);
    });
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setMeState(null);
    setCsrf(null);
  }, []);

  const value = useMemo<AuthState>(() => ({ me, loading, refresh, setMe, logout, can: (p) => !!me?.permissions.includes(p) }), [me, loading, refresh, setMe, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

// ── Toasts ────────────────────────────────────────────────────────────────────
export interface Toast { id: number; kind: 'success' | 'error' | 'info'; title: string; body?: string; link?: { to: string; label: string } }
interface ToastState { toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }
const ToastCtx = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.kind === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}

// ── Live events (SSE) ─────────────────────────────────────────────────────────
export type LiveEvent =
  | { type: 'scan.progress'; progress: ScanProgress }
  | { type: 'scan.finished'; scanId: number; siteId: number; status: string }
  | { type: 'sitemap.progress'; sitemapId: number; runId: number; status: string; pagesFound: number; pagesDone: number; currentUrl: string | null }
  | { type: 'notification'; title: string; body: string; kind: string; link: string | null };

type EventListener = (e: LiveEvent) => void;
const EventsCtx = createContext<{ subscribe: (l: EventListener) => () => void } | null>(null);

/**
 * Live events over SSE, shared across tabs: browsers allow only 6 connections per host on HTTP/1.1,
 * so one tab (elected with the Web Locks API) holds the EventSource and relays events to the other tabs
 * through a BroadcastChannel. When that tab closes, the lock passes to another tab automatically.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const listeners = useRef(new Set<EventListener>());
  useEffect(() => {
    if (!me) return;
    const deliver = (e: LiveEvent) => {
      for (const l of listeners.current) l(e);
    };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`sortsite-events-${me.id}`) : null;
    channel?.addEventListener('message', (m: MessageEvent<LiveEvent>) => deliver(m.data));

    let source: EventSource | null = null;
    let releaseLock: (() => void) | null = null;
    let disposed = false;
    const abort = new AbortController();
    const open = () => {
      source = new EventSource('/api/v1/events');
      const handler = (ev: MessageEvent<string>) => {
        if (disposed) return;
        const data = JSON.parse(ev.data) as LiveEvent;
        deliver(data);
        channel?.postMessage(data);
      };
      for (const t of ['scan.progress', 'scan.finished', 'sitemap.progress', 'notification']) source.addEventListener(t, handler as (ev: Event) => void);
    };
    const close = () => {
      source?.close();
      source = null;
    };
    window.addEventListener('pagehide', close);

    if (navigator.locks && channel) {
      void navigator.locks
        // The signal withdraws a still-queued request on unmount; a lock granted after unmount is released at once.
        .request(`sortsite-events-leader-${me.id}`, { signal: abort.signal }, () => {
          if (disposed) return;
          open();
          return new Promise<void>((resolve) => (releaseLock = resolve));
        })
        .catch(() => undefined);
    } else {
      open(); // older browsers: one stream per tab
    }
    return () => {
      disposed = true;
      abort.abort();
      window.removeEventListener('pagehide', close);
      close();
      releaseLock?.();
      channel?.close();
    };
  }, [me]);
  const value = useMemo(
    () => ({
      subscribe: (l: EventListener) => {
        listeners.current.add(l);
        return () => void listeners.current.delete(l);
      },
    }),
    [],
  );
  return <EventsCtx.Provider value={value}>{children}</EventsCtx.Provider>;
}

/** Subscribe to live events; the latest handler is always used without resubscribing. */
export function useLiveEvents(handler: EventListener) {
  const ctx = useContext(EventsCtx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => ctx?.subscribe((e) => ref.current(e)), [ctx]);
}

// ── Data loading hook ─────────────────────────────────────────────────────────
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      const id = ++seq.current;
      if (!quiet) setLoading(true);
      try {
        const d = await api.get<T>(path, { quiet });
        if (id === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (id === seq.current) setError((e as Error).message);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Page title + a portal slot so each screen can place contextual buttons in the top bar. */
const TitleCtx = createContext<{ title: string; setTitle: (t: string) => void; slot: HTMLElement | null; setSlot: (el: HTMLElement | null) => void } | null>(null);
export function TitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ title, setTitle, slot, setSlot }), [title, slot]);
  return <TitleCtx.Provider value={value}>{children}</TitleCtx.Provider>;
}
export function usePageChrome() {
  const ctx = useContext(TitleCtx);
  if (!ctx) throw new Error('usePageChrome outside TitleProvider');
  return ctx;
}
/** Set the page title shown in the top bar and the document title. */
export function usePage(title: string) {
  const { setTitle } = usePageChrome();
  useEffect(() => {
    setTitle(title);
    document.title = title ? `${title} · SortSite Tools by Ecomback` : 'SortSite Tools by Ecomback';
  }, [title, setTitle]);
}
/** Contextual top-bar buttons (Options…, Scan Now, Download …) rendered through a portal. */
export function TopbarActions({ children }: { children: ReactNode }) {
  const { slot } = usePageChrome();
  return slot ? createPortal(children, slot) : null;
}
