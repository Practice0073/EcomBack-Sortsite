/** Typed fetch wrapper for /api/v1 with CSRF, JSON errors and a global loading signal. */

export interface FieldError { path: string; message: string }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: FieldError[] = [],
  ) {
    super(message);
  }
  fieldError(path: string): string | undefined {
    return this.fields.find((f) => f.path === path)?.message;
  }
}

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => (csrfToken = t);

type Listener = (inFlight: number) => void;
let inFlight = 0;
const listeners = new Set<Listener>();
export const onLoading = (l: Listener) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const bump = (d: number) => {
  inFlight += d;
  for (const l of listeners) l(inFlight);
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown, opts: { quiet?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (!opts.quiet) bump(1);
  try {
    const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
      const err = (data ?? {}) as { error?: string; fields?: FieldError[] };
      throw new ApiError(res.status, err.error ?? `Request failed (${res.status})`, err.fields ?? []);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'Cannot reach the server. Check that it is running and try again.');
  } finally {
    if (!opts.quiet) bump(-1);
  }
}

export const api = {
  get: <T>(path: string, opts?: { quiet?: boolean }) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
