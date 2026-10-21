import fs from 'node:fs';
import { Router } from 'express';
import { q } from '../db/index.js';
import { authed, actorOf, requirePerm, toMe } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, bool, intParam, notFound, oneOf, rawBody, str } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { config } from '../config.js';
import type { DateFormat } from '../../shared/types.js';

export const accountRouter = Router();

const DATE_FORMATS = ['dd-mmm-yyyy', 'mm/dd/yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd'] as const satisfies readonly DateFormat[];
const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ── Settings ──────────────────────────────────────────────────────────────────
accountRouter.get('/account/settings', (req, res) => {
  const u = authed(req);
  res.json({ timezone: u.timezone, dateFormat: u.date_format, sidebarTheme: u.sidebar_theme, name: u.name, email: u.email, timezones: Intl.supportedValuesOf('timeZone') });
});

accountRouter.put('/account/settings', (req, res) => {
  const u = authed(req);
  const timezone = str(req, 'timezone', { required: true, max: 64 });
  if (!validTimezone(timezone)) throw badRequest('Choose a timezone from the list.', [{ path: 'timezone', message: 'Unknown timezone.' }]);
  const dateFormat = oneOf(req, 'dateFormat', DATE_FORMATS);
  const sidebarTheme = oneOf(req, 'sidebarTheme', ['dark', 'light'] as const, u.sidebar_theme);
  const name = str(req, 'name', { max: 120 }) || u.name;
  q.run('UPDATE users SET timezone = ?, date_format = ?, sidebar_theme = ?, name = ? WHERE id = ?', [timezone, dateFormat, sidebarTheme, name, u.id]);
  audit(actorOf(req), 'settings', `Settings saved (timezone ${timezone}, date format ${dateFormat})`);
  const updated = q.get<typeof u>('SELECT * FROM users WHERE id = ?', [u.id])!;
  res.json({ me: toMe(updated) });
});

// ── Alert preferences (Plan.md §9) ────────────────────────────────────────────
accountRouter.get('/account/alerts', (req, res) => {
  const u = authed(req);
  const a = q.get<{ on_complete: number; on_failed: number; rise_points: number; quota_pct: number; email_alerts: number }>('SELECT * FROM alert_settings WHERE account_id = ?', [u.account_id]);
  res.json({ onComplete: !!(a?.on_complete ?? 1), onFailed: !!(a?.on_failed ?? 1), risePoints: a?.rise_points ?? 5, quotaPct: a?.quota_pct ?? 90, emailAlerts: !!a?.email_alerts });
});

accountRouter.put('/account/alerts', requirePerm('users.manage'), (req, res) => {
  const u = authed(req);
  const body = rawBody(req);
  const rise = Number(body.risePoints);
  const quota = Number(body.quotaPct);
  if (!Number.isInteger(rise) || rise < 1 || rise > 100) throw badRequest('Rise threshold must be 1–100 points.', [{ path: 'risePoints', message: 'Enter 1 to 100.' }]);
  if (!Number.isInteger(quota) || quota < 10 || quota > 100) throw badRequest('Quota threshold must be 10–100%.', [{ path: 'quotaPct', message: 'Enter 10 to 100.' }]);
  q.run(
    `INSERT INTO alert_settings (account_id, on_complete, on_failed, rise_points, quota_pct, email_alerts) VALUES (?,?,?,?,?,?)
     ON CONFLICT(account_id) DO UPDATE SET on_complete = excluded.on_complete, on_failed = excluded.on_failed, rise_points = excluded.rise_points, quota_pct = excluded.quota_pct, email_alerts = excluded.email_alerts`,
    [u.account_id, bool(req, 'onComplete', true) ? 1 : 0, bool(req, 'onFailed', true) ? 1 : 0, rise, quota, bool(req, 'emailAlerts') ? 1 : 0],
  );
  audit(actorOf(req), 'settings', 'Alert preferences updated');
  res.json({ ok: true });
});

// ── Notifications ─────────────────────────────────────────────────────────────
accountRouter.get('/notifications', (req, res) => {
  const u = authed(req);
  const rows = q.all<{ id: number; kind: string; title: string; body: string; link: string | null; created_at: string; read: number }>(
    'SELECT * FROM notifications WHERE account_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY id DESC LIMIT 50',
    [u.account_id, u.id],
  );
  res.json({ items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: !!r.read })), unread: rows.filter((r) => !r.read).length });
});

accountRouter.post('/notifications/read', (req, res) => {
  const u = authed(req);
  const id = rawBody(req).id;
  if (id) q.run('UPDATE notifications SET read = 1 WHERE id = ? AND account_id = ?', [intParam(id), u.account_id]);
  else q.run('UPDATE notifications SET read = 1 WHERE account_id = ? AND (user_id IS NULL OR user_id = ?)', [u.account_id, u.id]);
  res.json({ ok: true });
});

// ── Personal API tokens (REST API + MCP connector) ────────────────────────────
accountRouter.get('/account/tokens', (req, res) => {
  const u = authed(req);
  res.json(q.all<{ id: number; name: string; prefix: string; last_used_at: string | null; created_at: string }>('SELECT id, name, prefix, last_used_at, created_at FROM api_tokens WHERE user_id = ? AND app_id IS NULL ORDER BY id DESC', [u.id]).map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, lastUsedAt: t.last_used_at, createdAt: t.created_at })));
});

accountRouter.post('/account/tokens', (req, res) => {
  const u = authed(req);
  if (req.auth?.viaToken) throw badRequest('Create tokens from the web app, not with another token.');
  const name = str(req, 'name', { required: true, max: 80 });
  const token = `sst_${randomToken(30)}`;
  q.run('INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?,?,?,?)', [u.id, name, sha256(token), token.slice(0, 10)]);
  audit(actorOf(req), 'api-token', `API token "${name}" created`);
  res.status(201).json({ token });
});

accountRouter.delete('/account/tokens/:id', (req, res) => {
  const u = authed(req);
  const r = q.run('DELETE FROM api_tokens WHERE id = ? AND user_id = ? AND app_id IS NULL', [intParam(req.params.id), u.id]);
  if (!r.changes) throw notFound('Token not found.');
  audit(actorOf(req), 'api-token', 'API token revoked');
  res.json({ ok: true });
});

// ── Dev mailbox: emails written to the local outbox (no SMTP needed on localhost) ─
accountRouter.get('/mailbox', requirePerm('users.manage'), (req, res) => {
  const u = authed(req);
  res.json({
    smtpConfigured: !!config.smtp,
    items: q.all<{ id: number; to_addr: string; subject: string; delivered: number; error: string | null; created_at: string }>('SELECT id, to_addr, subject, delivered, error, created_at FROM emails WHERE account_id = ? OR account_id IS NULL ORDER BY id DESC LIMIT 100', [u.account_id]).map((e) => ({ id: e.id, to: e.to_addr, subject: e.subject, delivered: !!e.delivered, error: e.error, createdAt: e.created_at })),
  });
});

accountRouter.get('/mailbox/:id', requirePerm('users.manage'), (req, res) => {
  const u = authed(req);
  const e = q.get<{ html_path: string }>('SELECT html_path FROM emails WHERE id = ? AND (account_id = ? OR account_id IS NULL)', [intParam(req.params.id), u.account_id]);
  if (!e || !fs.existsSync(e.html_path)) throw notFound('Email not found.');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com");
  res.type('html').send(fs.readFileSync(e.html_path, 'utf8'));
});

