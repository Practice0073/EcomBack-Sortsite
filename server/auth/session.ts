import type { NextFunction, Request, Response } from 'express';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, clientIp, forbidden } from '../lib/http.js';
import { can, PERMISSIONS, type Me, type Permission, type Role, type DateFormat } from '../../shared/types.js';
import type { Actor } from '../lib/audit.js';

export interface UserRow {
  id: number;
  account_id: number;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  client_id: number | null;
  status: 'active' | 'invited' | 'disabled';
  timezone: string;
  date_format: DateFormat;
  sidebar_theme: 'dark' | 'light';
  totp_secret: string | null;
  totp_enabled: number;
  recovery_codes: string | null;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
}

interface SessionRow { id: string; user_id: number; stage: '2fa' | 'full'; remember: number; csrf: string; last_seen_at: string; expires_at: string }

export interface AuthContext {
  user: UserRow;
  sessionId: string | null;
  csrf: string | null;
  viaToken: boolean;
  /** 'full' for personal API tokens; space-separated OAuth scopes for connected apps. */
  tokenScope: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    pending2fa?: { sessionId: string; user: UserRow };
  }
}

const cookieOpts = (maxAge?: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.isProd,
  path: '/',
  ...(maxAge ? { maxAge } : {}),
});

export function createSession(res: Response, req: Request, userId: number, stage: '2fa' | 'full', remember: boolean): string {
  const id = randomToken(32);
  const now = Date.now();
  const ttl = stage === '2fa' ? 10 * 60_000 : remember ? config.session.rememberMs : config.session.idleTimeoutMs;
  q.run('INSERT INTO sessions (id, user_id, stage, remember, csrf, ip, user_agent, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
    sha256(id),
    userId,
    stage,
    remember ? 1 : 0,
    randomToken(18),
    clientIp(req),
    String(req.headers['user-agent'] ?? '').slice(0, 300),
    new Date(now).toISOString(),
    new Date(now).toISOString(),
    new Date(now + ttl).toISOString(),
  ]);
  res.cookie(config.session.cookie, id, cookieOpts(remember && stage === 'full' ? config.session.rememberMs : undefined));
  return id;
}

export function upgradeSession(sessionId: string) {
  const now = Date.now();
  const row = q.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sha256(sessionId)]);
  const ttl = row?.remember ? config.session.rememberMs : config.session.idleTimeoutMs;
  q.run("UPDATE sessions SET stage = 'full', last_seen_at = ?, expires_at = ? WHERE id = ?", [new Date(now).toISOString(), new Date(now + ttl).toISOString(), sha256(sessionId)]);
}

export function destroySession(res: Response, sessionId: string | null) {
  if (sessionId) q.run('DELETE FROM sessions WHERE id = ?', [sha256(sessionId)]);
  res.clearCookie(config.session.cookie, cookieOpts());
}

export const destroyUserSessions = (userId: number, exceptSessionId?: string | null) =>
  q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [userId, exceptSessionId ? sha256(exceptSessionId) : '']);

/** Loads the session (cookie) or API token (Bearer) — never throws; guards decide. */
export function loadAuth(req: Request, _res: Response, next: NextFunction) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) {
    const tok = q.get<{ id: number; user_id: number; scope: string }>('SELECT id, user_id, scope FROM api_tokens WHERE token_hash = ?', [sha256(bearer)]);
    const user = tok && q.get<UserRow>("SELECT * FROM users WHERE id = ? AND status = 'active'", [tok.user_id]);
    if (tok && user) {
      q.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', [nowIso(), tok.id]);
      req.auth = { user, sessionId: null, csrf: null, viaToken: true, tokenScope: tok.scope };
    }
    return next();
  }
  const sid = req.cookies?.[config.session.cookie] as string | undefined;
  if (!sid) return next();
  const row = q.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sha256(sid)]);
  if (!row || row.expires_at < nowIso()) {
    if (row) q.run('DELETE FROM sessions WHERE id = ?', [row.id]);
    return next();
  }
  const user = q.get<UserRow>("SELECT * FROM users WHERE id = ? AND status = 'active'", [row.user_id]);
  if (!user) return next();
  if (row.stage === '2fa') {
    req.pending2fa = { sessionId: sid, user };
    return next();
  }
  // Sliding idle timeout (remembered sessions keep their long expiry).
  if (!row.remember) {
    q.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [nowIso(), new Date(Date.now() + config.session.idleTimeoutMs).toISOString(), row.id]);
  }
  req.auth = { user, sessionId: sid, csrf: row.csrf, viaToken: false, tokenScope: null };
  next();
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Endpoints a connected app (OAuth token) may call; account administration is never exposed to apps. */
const APP_PATHS = /^\/(auth\/me|sites|scans|exports|sitemaps|rules|events)(\/|$|\?)/;

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Please sign in.'));
  const scope = req.auth.tokenScope;
  if (req.auth.viaToken && scope && scope !== 'full') {
    const scopes = scope.split(' ');
    if (!APP_PATHS.test(req.path)) return next(new HttpError(403, 'Connected apps cannot use this endpoint.'));
    if (!SAFE.has(req.method) && !scopes.includes('scans:write')) return next(new HttpError(403, 'This connection only has read access (scans:read). Reconnect with scans:write to start scans or downloads.'));
  }
  if (!SAFE.has(req.method) && !req.auth.viaToken && req.headers['x-csrf-token'] !== req.auth.csrf) {
    return next(new HttpError(403, 'Security token expired. Refresh the page and try again.'));
  }
  next();
}

export const requirePerm = (perm: Permission) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(new HttpError(401, 'Please sign in.'));
  if (!can(req.auth.user.role, perm)) return next(forbidden());
  next();
};

export function actorOf(req: Request): Actor {
  const u = req.auth?.user;
  return { accountId: u?.account_id ?? 0, userId: u?.id ?? null, label: u ? `${u.name} <${u.email}>` : 'anonymous', ip: clientIp(req) };
}

export const authed = (req: Request): UserRow => {
  if (!req.auth) throw new HttpError(401, 'Please sign in.');
  return req.auth.user;
};

export function toMe(user: UserRow): Me {
  const account = q.get<{ name: string }>('SELECT name FROM accounts WHERE id = ?', [user.account_id]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.client_id,
    timezone: user.timezone,
    dateFormat: user.date_format,
    sidebarTheme: user.sidebar_theme,
    twoFactorEnabled: !!user.totp_enabled,
    accountName: account?.name ?? '',
    permissions: [...PERMISSIONS[user.role]],
  };
}

/**
 * Site visibility: viewers bound to a client workspace see only that client's sites.
 * Returns an SQL fragment + params to AND into site queries (alias `s`).
 */
export function siteScope(user: UserRow): { sql: string; params: number[] } {
  if (user.client_id) return { sql: 's.account_id = ? AND s.client_id = ?', params: [user.account_id, user.client_id] };
  return { sql: 's.account_id = ?', params: [user.account_id] };
}

// ── Login rate limiting (per IP, in-memory sliding window) ────────────────────
const attempts = new Map<string, number[]>();
export function ipRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < config.login.ipWindowMs);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > config.login.ipMaxAttempts;
}

export function purgeExpiredSessions() {
  q.run('DELETE FROM sessions WHERE expires_at < ?', [nowIso()]);
  q.run('DELETE FROM password_resets WHERE expires_at < ? OR used = 1', [nowIso()]);
}
