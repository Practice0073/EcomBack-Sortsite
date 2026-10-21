/**
 * OAuth 2.0 authorization server for "Connected apps" (RFC 6749 authorization-code grant + RFC 7636 PKCE,
 * RFC 7009 revocation, RFC 8414 metadata). Lets other Ecomback tools — first the Remediation Platform —
 * act on a signed-in user's behalf with a scoped, revocable token, without ever seeing their password.
 *
 * Flow: client → GET /oauth/authorize (our SPA: sign-in + consent) → redirect_uri?code&state
 *       client → POST /oauth/token (code + code_verifier + client secret) → { access_token }
 */
import crypto from 'node:crypto';
import express, { Router, type Request } from 'express';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { authed, actorOf, requirePerm } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, intParam, notFound, rawBody, str } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export const SCOPES = {
  'scans:read': 'View sites, scan results, issues and reports',
  'scans:write': 'Start and stop scans, and create report downloads',
} as const;
export type Scope = keyof typeof SCOPES;
const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

interface AppRow { id: number; account_id: number; client_id: string; secret_hash: string; name: string; redirect_uris: string; created_at: string }

const parseScope = (raw: unknown): Scope[] => {
  const asked = String(raw ?? '').split(/[\s,]+/).filter(Boolean);
  const scopes = asked.length ? asked : ['scans:read'];
  const bad = scopes.filter((s) => !(ALL_SCOPES as string[]).includes(s));
  if (bad.length) throw badRequest(`Unknown scope: ${bad.join(', ')}`);
  return [...new Set(scopes)] as Scope[];
};

/** Exact-match redirect URIs only (no wildcards or prefix matching — the classic open-redirect hole). */
function appFor(clientId: unknown, redirectUri: unknown): AppRow {
  const app = q.get<AppRow>('SELECT * FROM oauth_apps WHERE client_id = ?', [String(clientId ?? '')]);
  if (!app) throw badRequest('Unknown client_id. Register the app under Settings › Connected apps.');
  if (redirectUri !== undefined && !(JSON.parse(app.redirect_uris) as string[]).includes(String(redirectUri))) {
    throw badRequest('redirect_uri does not match the one registered for this app.');
  }
  return app;
}

// ── Public endpoints (called by the client app's server) ───────────────────────
export const oauthPublicRouter = Router();

oauthPublicRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
    token_endpoint: `${config.baseUrl}/oauth/token`,
    revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ALL_SCOPES,
    service_documentation: `${config.baseUrl}/account/settings#connected-apps`,
  });
});

/** Client authentication: HTTP Basic (preferred) or client_id/client_secret in the body. */
function authenticateClient(req: Request): AppRow {
  let id: string | undefined;
  let secret: string | undefined;
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (basic) {
    const [u, p] = Buffer.from(basic, 'base64').toString('utf8').split(':');
    id = decodeURIComponent(u ?? '');
    secret = decodeURIComponent(p ?? '');
  } else {
    const b = rawBody(req);
    id = typeof b.client_id === 'string' ? b.client_id : undefined;
    secret = typeof b.client_secret === 'string' ? b.client_secret : undefined;
  }
  const app = id ? q.get<AppRow>('SELECT * FROM oauth_apps WHERE client_id = ?', [id]) : undefined;
  const ok = !!app && !!secret && crypto.timingSafeEqual(Buffer.from(sha256(secret)), Buffer.from(app.secret_hash));
  if (!ok) throw Object.assign(new HttpError(401, 'Client authentication failed.'), { oauthError: 'invalid_client' });
  return app!;
}

const oauthError = (res: express.Response, status: number, error: string, description: string) => res.status(status).json({ error, error_description: description });

oauthPublicRouter.post('/oauth/token', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let app: AppRow;
  try {
    app = authenticateClient(req);
  } catch {
    return void oauthError(res, 401, 'invalid_client', 'Client authentication failed.');
  }
  const b = rawBody(req);
  if (b.grant_type !== 'authorization_code') return void oauthError(res, 400, 'unsupported_grant_type', 'Only authorization_code is supported.');
  const code = String(b.code ?? '');
  const row = q.get<{ code_hash: string; app_id: number; user_id: number; redirect_uri: string; scope: string; code_challenge: string; expires_at: string; used: number }>('SELECT * FROM oauth_codes WHERE code_hash = ?', [sha256(code)]);
  // Codes are single-use: mark used before anything else so a replay can never succeed.
  if (row) q.run('UPDATE oauth_codes SET used = 1 WHERE code_hash = ?', [row.code_hash]);
  if (!row || row.used || row.app_id !== app.id || row.expires_at < nowIso()) {
    // RFC 6749 §4.1.2: a replayed code revokes the token previously issued from it.
    if (row?.used) q.run('DELETE FROM api_tokens WHERE code_hash = ?', [row.code_hash]);
    return void oauthError(res, 400, 'invalid_grant', 'The authorization code is invalid, expired or already used.');
  }
  if (String(b.redirect_uri ?? '') !== row.redirect_uri) return void oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
  const verifier = String(b.code_verifier ?? '');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || challenge !== row.code_challenge) return void oauthError(res, 400, 'invalid_grant', 'PKCE verification failed.');

  const user = q.get<{ id: number; email: string; name: string; account_id: number; status: string }>('SELECT id, email, name, account_id, status FROM users WHERE id = ?', [row.user_id]);
  if (!user || user.status !== 'active') return void oauthError(res, 400, 'invalid_grant', 'The user who approved this app is no longer active.');
  const token = `sst_${randomToken(30)}`;
  q.run('INSERT INTO api_tokens (user_id, name, token_hash, prefix, app_id, scope, code_hash) VALUES (?,?,?,?,?,?,?)', [user.id, app.name, sha256(token), token.slice(0, 10), app.id, row.scope, row.code_hash]);
  audit({ accountId: user.account_id, userId: user.id, label: `${user.name} <${user.email}>`, ip: null }, 'api-token', `Connected app "${app.name}" received an access token (${row.scope})`);
  res.json({ access_token: token, token_type: 'Bearer', scope: row.scope, user: { email: user.email, name: user.name } });
});

oauthPublicRouter.post('/oauth/revoke', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  let app: AppRow;
  try {
    app = authenticateClient(req);
  } catch {
    return void oauthError(res, 401, 'invalid_client', 'Client authentication failed.');
  }
  const token = String(rawBody(req).token ?? '');
  // RFC 7009: respond 200 even for unknown tokens.
  if (token) q.run('DELETE FROM api_tokens WHERE token_hash = ? AND app_id = ?', [sha256(token), app.id]);
  res.json({ ok: true });
});

// ── Signed-in endpoints (consent screen and app management) ────────────────────
export const oauthApiRouter = Router();

/** What the consent screen shows; validates every parameter before the user decides. */
oauthApiRouter.get('/oauth/authorize/info', (req, res) => {
  const p = req.query;
  if (p.response_type !== 'code') throw badRequest('response_type must be "code".');
  const app = appFor(p.client_id, p.redirect_uri);
  if (p.code_challenge_method !== 'S256' || typeof p.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) throw badRequest('PKCE is required: send code_challenge with code_challenge_method=S256.');
  const scopes = parseScope(p.scope);
  const me = authed(req);
  if (app.account_id !== me.account_id) throw badRequest('This app belongs to a different SortSite Tools account.');
  res.json({ app: { name: app.name, clientId: app.client_id, redirectHost: new URL(String(p.redirect_uri)).host }, scopes: scopes.map((s) => ({ id: s, label: SCOPES[s] })), user: { name: me.name, email: me.email } });
});

oauthApiRouter.post('/oauth/authorize', (req, res) => {
  const b = rawBody(req);
  const app = appFor(b.client_id, b.redirect_uri);
  const me = authed(req);
  if (app.account_id !== me.account_id) throw badRequest('This app belongs to a different account.');
  const redirect = new URL(String(b.redirect_uri));
  if (typeof b.state === 'string') redirect.searchParams.set('state', b.state);
  if (b.decision !== 'allow') {
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'The user declined to connect.');
    audit(actorOf(req), 'api-token', `Declined connection request from "${app.name}"`);
    res.json({ redirect: redirect.toString() });
    return;
  }
  const challenge = String(b.code_challenge ?? '');
  if (b.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw badRequest('PKCE (S256) is required.');
  const scopes = parseScope(b.scope);
  const code = randomToken(32);
  q.run('INSERT INTO oauth_codes (code_hash, app_id, user_id, redirect_uri, scope, code_challenge, expires_at) VALUES (?,?,?,?,?,?,?)', [sha256(code), app.id, me.id, String(b.redirect_uri), scopes.join(' '), challenge, new Date(Date.now() + 5 * 60_000).toISOString()]);
  q.run('DELETE FROM oauth_codes WHERE expires_at < ?', [new Date(Date.now() - 3600_000).toISOString()]);
  redirect.searchParams.set('code', code);
  audit(actorOf(req), 'api-token', `Approved connection for "${app.name}" (${scopes.join(' ')})`);
  res.json({ redirect: redirect.toString() });
});

const appDto = (a: AppRow) => ({
  id: a.id,
  name: a.name,
  clientId: a.client_id,
  redirectUris: JSON.parse(a.redirect_uris) as string[],
  createdAt: a.created_at,
  connections: Number(q.value('SELECT COUNT(*) FROM api_tokens WHERE app_id = ?', [a.id])),
});

oauthApiRouter.get('/oauth/apps', (req, res) => {
  const me = authed(req);
  const apps = q.all<AppRow>('SELECT * FROM oauth_apps WHERE account_id = ? ORDER BY name', [me.account_id]).map(appDto);
  const connections = q.all<{ id: number; name: string; prefix: string; scope: string; last_used_at: string | null; created_at: string; user_name: string; user_email: string }>(
    `SELECT t.id, t.name, t.prefix, t.scope, t.last_used_at, t.created_at, u.name AS user_name, u.email AS user_email
       FROM api_tokens t JOIN users u ON u.id = t.user_id JOIN oauth_apps a ON a.id = t.app_id WHERE a.account_id = ? ORDER BY t.id DESC`,
    [me.account_id],
  );
  res.json({
    apps,
    connections: connections.map((c) => ({ id: c.id, app: c.name, prefix: c.prefix, scope: c.scope, lastUsedAt: c.last_used_at, createdAt: c.created_at, user: `${c.user_name} <${c.user_email}>` })),
    scopes: ALL_SCOPES.map((s) => ({ id: s, label: SCOPES[s] })),
    endpoints: { authorize: `${config.baseUrl}/oauth/authorize`, token: `${config.baseUrl}/oauth/token`, revoke: `${config.baseUrl}/oauth/revoke`, metadata: `${config.baseUrl}/.well-known/oauth-authorization-server`, api: `${config.baseUrl}/api/v1` },
  });
});

oauthApiRouter.post('/oauth/apps', requirePerm('users.manage'), (req, res) => {
  const me = authed(req);
  const name = str(req, 'name', { required: true, max: 80 });
  const uris = (Array.isArray(rawBody(req).redirectUris) ? (rawBody(req).redirectUris as unknown[]) : [rawBody(req).redirectUri]).map((u) => String(u ?? '').trim()).filter(Boolean);
  if (!uris.length) throw badRequest('Add the redirect URI the app sends users back to.', [{ path: 'redirectUri', message: 'Required.' }]);
  for (const u of uris) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw badRequest(`Not a valid URL: ${u}`, [{ path: 'redirectUri', message: 'Enter a full URL.' }]);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw badRequest('Redirect URIs must use https (http is allowed for localhost only).', [{ path: 'redirectUri', message: 'Use https.' }]);
    if (parsed.hash) throw badRequest('Redirect URIs cannot contain a #fragment.', [{ path: 'redirectUri', message: 'Remove the #fragment.' }]);
  }
  const clientId = `ssa_${randomToken(12)}`;
  const secret = `sss_${randomToken(32)}`;
  q.run('INSERT INTO oauth_apps (account_id, client_id, secret_hash, name, redirect_uris, created_by) VALUES (?,?,?,?,?,?)', [me.account_id, clientId, sha256(secret), name, JSON.stringify(uris), me.id]);
  audit(actorOf(req), 'api-token', `Registered connected app "${name}"`);
  res.status(201).json({ clientId, clientSecret: secret });
});

oauthApiRouter.post('/oauth/apps/:id/secret', requirePerm('users.manage'), (req, res) => {
  const me = authed(req);
  const app = q.get<AppRow>('SELECT * FROM oauth_apps WHERE id = ? AND account_id = ?', [intParam(req.params.id), me.account_id]);
  if (!app) throw notFound('App not found.');
  const secret = `sss_${randomToken(32)}`;
  q.run('UPDATE oauth_apps SET secret_hash = ? WHERE id = ?', [sha256(secret), app.id]);
  audit(actorOf(req), 'api-token', `Rotated the client secret of "${app.name}"`);
  res.json({ clientId: app.client_id, clientSecret: secret });
});

oauthApiRouter.delete('/oauth/apps/:id', requirePerm('users.manage'), (req, res) => {
  const me = authed(req);
  const app = q.get<AppRow>('SELECT * FROM oauth_apps WHERE id = ? AND account_id = ?', [intParam(req.params.id), me.account_id]);
  if (!app) throw notFound('App not found.');
  q.run('DELETE FROM oauth_apps WHERE id = ?', [app.id]); // cascades to its codes and tokens
  audit(actorOf(req), 'api-token', `Removed connected app "${app.name}" and all its access`);
  res.json({ ok: true });
});

oauthApiRouter.delete('/oauth/connections/:id', (req, res) => {
  const me = authed(req);
  const row = q.get<{ id: number; name: string; user_id: number }>(
    'SELECT t.id, t.name, t.user_id FROM api_tokens t JOIN oauth_apps a ON a.id = t.app_id WHERE t.id = ? AND a.account_id = ?',
    [intParam(req.params.id), me.account_id],
  );
  if (!row) throw notFound('Connection not found.');
  if (row.user_id !== me.id && me.role !== 'admin') throw new HttpError(403, 'Only the user who connected it, or an administrator, can disconnect it.');
  q.run('DELETE FROM api_tokens WHERE id = ?', [row.id]);
  audit(actorOf(req), 'api-token', `Disconnected "${row.name}"`);
  res.json({ ok: true });
});
