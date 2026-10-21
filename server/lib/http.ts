import type { ErrorRequestHandler, Request } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: { path: string; message: string }[]) => new HttpError(400, msg, fields);
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body.' });
    return;
  }
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: 'Something went wrong on our side. The error has been logged.' });
};

// ── Input readers: narrow unknown request data without trusting it ────────────
type Body = Record<string, unknown>;
const body = (req: Request): Body => (typeof req.body === 'object' && req.body !== null ? (req.body as Body) : {});

export function str(req: Request, key: string, opts: { required?: boolean; max?: number; trim?: boolean } = {}): string {
  const raw = body(req)[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) throw badRequest(`${key} is required.`, [{ path: key, message: 'This field is required.' }]);
    return '';
  }
  if (typeof raw !== 'string') throw badRequest(`${key} must be text.`);
  const v = opts.trim === false ? raw : raw.trim();
  if (opts.max && v.length > opts.max) throw badRequest(`${key} is too long (max ${opts.max}).`);
  return v;
}

export function oneOf<T extends string>(req: Request, key: string, allowed: readonly T[], fallback?: T): T {
  const raw = body(req)[key];
  if ((raw === undefined || raw === '') && fallback !== undefined) return fallback;
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) return raw as T;
  throw badRequest(`${key} must be one of: ${allowed.join(', ')}.`);
}

export function bool(req: Request, key: string, fallback = false): boolean {
  const raw = body(req)[key];
  return typeof raw === 'boolean' ? raw : fallback;
}

export function intParam(value: unknown, name = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}.`);
  return n;
}

export function rawBody(req: Request): Body {
  return body(req);
}

export const clientIp = (req: Request) => (req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.socket.remoteAddress ?? '').trim();
