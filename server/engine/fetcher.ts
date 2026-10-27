import { config } from '../config.js';
import type { ScanOptions } from '../../shared/options.js';

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number | null;
  headers: Record<string, string>;
  contentType: string | null;
  body: Buffer | null;
  bytes: number;
  redirects: { url: string; status: number }[];
  elapsedMs: number;
  error: string | null;
  timedOut: boolean;
}

/**
 * Adaptive politeness: concurrency and spacing shrink when a server pushes back (429/503) and recover
 * gradually after successful responses, so one slow burst never throttles the rest of the scan.
 */
export class Throttle {
  private active = 0;
  private waiters: (() => void)[] = [];
  private lastStart = 0;
  private okStreak = 0;
  private readonly baseLimit: number;
  private readonly baseDelay: number;
  private readonly maxDelayMs: number;
  limit: number;
  delayMs: number;
  rateLimitedHits = 0;

  constructor(mode: ScanOptions['crawler']['throttle'] | { limit: number; delayMs: number; maxDelayMs?: number }) {
    const presets = { slow: [1, 1000], normal: [2, 250], fast: [config.pageConcurrency + 2, 0], auto: [config.pageConcurrency, 100] } as const;
    const [limit, delay] = typeof mode === 'string' ? presets[mode] : [mode.limit, mode.delayMs];
    this.limit = this.baseLimit = limit;
    this.delayMs = this.baseDelay = delay;
    this.maxDelayMs = typeof mode === 'string' ? 5000 : (mode.maxDelayMs ?? 5000);
  }

  async acquire(): Promise<void> {
    while (this.active >= this.limit) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    const now = Date.now();
    const start = Math.max(now, this.lastStart + this.delayMs);
    this.lastStart = start;
    if (start > now) await sleep(start - now);
  }

  release() {
    this.active--;
    // Wake everyone: each re-checks the limit, so a lowered limit can never strand a waiter.
    const waiting = this.waiters.splice(0);
    for (const w of waiting) w();
  }

  /** Called on 429/503: back off (halve concurrency, grow the spacing, honour Retry-After up to the cap). */
  pushback(retryAfterSec: number | null) {
    this.rateLimitedHits++;
    this.okStreak = 0;
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.delayMs = Math.min(this.maxDelayMs, Math.max(this.delayMs * 2, 500, (retryAfterSec ?? 1) * 1000));
  }

  /** Called after a normal response: every 5 in a row restores some speed towards the preset. */
  success() {
    if (this.limit === this.baseLimit && this.delayMs === this.baseDelay) return;
    if (++this.okStreak < 5) return;
    this.okStreak = 0;
    this.limit = Math.min(this.baseLimit, this.limit + 1);
    this.delayMs = Math.max(this.baseDelay, Math.floor(this.delayMs / 2));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Builds request headers/cookies for the configured authorisation mode (Plan.md §2.6 Crawler). */
export function authHeaders(opts: ScanOptions['crawler']): Record<string, string> {
  const h: Record<string, string> = {};
  const parseLines = (text: string) => {
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  };
  switch (opts.authMode) {
    case 'basic':
      h.Authorization = `Basic ${Buffer.from(`${opts.basicUser}:${opts.basicPassword}`).toString('base64')}`;
      break;
    case 'headers':
    case 'shopify-web-bot-auth': // Signature-Input / Signature / Signature-Agent generated in Shopify admin
      parseLines(opts.headers);
      break;
    case 'cookies':
      break;
    case 'none':
      break;
  }
  return h;
}

export class CookieJar {
  private jar = new Map<string, string>();
  constructor(initial = '') {
    for (const line of initial.split(/[\r\n;]+/)) {
      const i = line.indexOf('=');
      if (i > 0) this.jar.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
  }
  absorb(setCookie: string[]) {
    for (const sc of setCookie) {
      const [pair] = sc.split(';');
      const i = pair?.indexOf('=') ?? -1;
      if (pair && i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  entries() {
    return [...this.jar];
  }
}

export interface FetcherOptions {
  timeoutMs: number;
  retries: number;
  headers: Record<string, string>;
  jar: CookieJar;
  throttle: Throttle;
  maxBodyBytes?: number;
  /** Hosts that receive the auth headers/cookies (never leak credentials to third parties). */
  authHosts: Set<string>;
  /** Aborts in-flight requests when the scan is stopped. */
  signal?: AbortSignal;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchUrl(url: string, fo: FetcherOptions, method: 'GET' | 'HEAD' = 'GET', wantBody = true): Promise<FetchResult> {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    const res = await fetchOnce(url, fo, method, wantBody);
    if (res.status && (res.status === 429 || res.status === 503)) {
      const ra = Number(res.headers['retry-after']);
      fo.throttle.pushback(Number.isFinite(ra) ? ra : null);
    } else if (res.status) {
      fo.throttle.success();
    }
    const retryable = res.error !== null ? !res.timedOut : res.status !== null && RETRYABLE.has(res.status);
    if (!retryable || attempt >= fo.retries || fo.signal?.aborted) return { ...res, elapsedMs: Date.now() - started };
    attempt++;
    await sleep(500 * 2 ** attempt);
  }
}

async function fetchOnce(url: string, fo: FetcherOptions, method: 'GET' | 'HEAD', wantBody: boolean): Promise<FetchResult> {
  const redirects: { url: string; status: number }[] = [];
  let current = url;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), fo.timeoutMs);
  const onStop = () => ac.abort();
  fo.signal?.addEventListener('abort', onStop, { once: true });
  if (fo.signal?.aborted) ac.abort();
  await fo.throttle.acquire();
  try {
    for (let hop = 0; hop < 10; hop++) {
      const host = new URL(current).hostname.replace(/^www\./, '');
      const withAuth = fo.authHosts.has(host);
      const headers: Record<string, string> = {
        'User-Agent': config.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(withAuth ? fo.headers : {}),
      };
      const cookie = withAuth ? fo.jar.header() : '';
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(current, { method, headers, redirect: 'manual', signal: ac.signal });
      if (withAuth) fo.jar.absorb(res.headers.getSetCookie());
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        redirects.push({ url: current, status: res.status });
        await res.body?.cancel();
        const next = new URL(location, current).toString();
        if (redirects.some((r) => r.url === next)) {
          return result(url, next, res, null, redirects, 'Redirect loop', false);
        }
        current = next;
        continue;
      }
      let body: Buffer | null = null;
      if (wantBody && method === 'GET') body = await readCapped(res, fo.maxBodyBytes ?? 15 * 1024 * 1024);
      else await res.body?.cancel();
      return result(url, current, res, body, redirects, null, false);
    }
    return { ...empty(url, current, redirects), error: 'Too many redirects' };
  } catch (e) {
    const timedOut = ac.signal.aborted;
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const reason = timedOut ? `Timed out after ${Math.round(fo.timeoutMs / 1000)}s` : (err.cause?.code ?? err.cause?.message ?? err.message);
    return { ...empty(url, current, redirects), error: reason, timedOut };
  } finally {
    clearTimeout(timer);
    fo.signal?.removeEventListener('abort', onStop);
    fo.throttle.release();
  }
}

async function readCapped(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel();
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function result(url: string, finalUrl: string, res: Response, body: Buffer | null, redirects: FetchResult['redirects'], error: string | null, timedOut: boolean): FetchResult {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  const len = Number(headers['content-length']);
  return {
    url,
    finalUrl,
    status: res.status,
    headers,
    contentType: headers['content-type'] ?? null,
    body,
    bytes: body ? body.length : Number.isFinite(len) ? len : 0,
    redirects,
    elapsedMs: 0,
    error,
    timedOut,
  };
}

const empty = (url: string, finalUrl: string, redirects: FetchResult['redirects']): FetchResult => ({
  url,
  finalUrl,
  status: null,
  headers: {},
  contentType: null,
  body: null,
  bytes: 0,
  redirects,
  elapsedMs: 0,
  error: null,
  timedOut: false,
});

/** Shopify password-protected storefront: POST /password to obtain the storefront_digest cookie. */
export async function unlockShopifyStorefront(origin: string, password: string, fo: FetcherOptions): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/password`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'User-Agent': config.userAgent, 'Content-Type': 'application/x-www-form-urlencoded', ...fo.headers },
      body: new URLSearchParams({ form_type: 'storefront_password', utf8: '✓', password }).toString(),
    });
    fo.jar.absorb(res.headers.getSetCookie());
    return fo.jar.entries().some(([k]) => k === 'storefront_digest');
  } catch {
    return false;
  }
}
