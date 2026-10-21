import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { q } from '../db/index.js';
import { config } from '../config.js';
import { authed, actorOf, destroyUserSessions, requirePerm, siteScope, type UserRow } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, HttpError, intParam, notFound, oneOf, rawBody, str } from '../lib/http.js';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';
import { usage } from '../lib/quota.js';
import { brandedEmail, sendMail } from '../mail/mailer.js';
import { PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, type Role } from '../../shared/types.js';
import { allRules, getRule } from '../engine/rules/catalog.js';
import { scoreGrade } from '../engine/stats.js';

export const adminRouter = Router();
const ROLES = ['admin', 'analyst', 'viewer'] as const satisfies readonly Role[];

// ── Users (Plan.md §2.8, §5.10) ───────────────────────────────────────────────
adminRouter.get('/users', requirePerm('users.manage'), (req, res) => {
  const u = authed(req);
  const rows = q.all<UserRow & { client_name: string | null }>('SELECT u.*, c.name AS client_name FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.account_id = ? ORDER BY u.name', [u.account_id]);
  const use = usage(u.account_id);
  res.json({
    limit: use.users,
    roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], permissions: PERMISSIONS[r].map((p) => PERMISSION_LABELS[p]) })),
    items: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, roleLabel: ROLE_LABELS[r.role], status: r.status, lastLoginAt: r.last_login_at, clientId: r.client_id, clientName: r.client_name, twoFactor: !!r.totp_enabled, isYou: r.id === u.id })),
  });
});

adminRouter.post('/users', requirePerm('users.manage'), async (req, res) => {
  const me = authed(req);
  const use = usage(me.account_id);
  if (use.users.used >= use.users.limit) throw new HttpError(402, `Your plan allows ${use.users.limit} users. Remove a user or upgrade to add more.`);
  const email = str(req, 'email', { required: true, max: 254 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address.', [{ path: 'email', message: 'Invalid email.' }]);
  if (q.get('SELECT id FROM users WHERE email = ?', [email])) throw badRequest('A user with this email already exists.', [{ path: 'email', message: 'Already in use.' }]);
  const name = str(req, 'name', { required: true, max: 120 });
  const role = oneOf(req, 'role', ROLES);
  const clientId = rawBody(req).clientId ? intParam(rawBody(req).clientId, 'client') : null;
  if (clientId && !q.get('SELECT id FROM clients WHERE id = ? AND account_id = ?', [clientId, me.account_id])) throw badRequest('Unknown client workspace.');
  // Invited users set their own password through a one-time link (valid 7 days).
  const id = q.run("INSERT INTO users (account_id, email, name, password_hash, role, client_id, status, timezone, date_format) VALUES (?,?,?,?,?,?, 'invited', ?, ?)", [me.account_id, email, name, hashPassword(randomToken(24)), role, clientId, me.timezone, me.date_format]).lastId;
  const token = randomToken(32);
  q.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', [sha256(token), id, new Date(Date.now() + 7 * 86400_000).toISOString()]);
  const inviteUrl = `${config.baseUrl}/reset-password?token=${token}&invite=1`;
  await sendMail({ accountId: me.account_id, to: [email], subject: `You're invited to SortSite Tools by Ecomback`, html: brandedEmail({ heading: `Join ${me.name}'s team`, intro: `${me.name} invited you to SortSite Tools by Ecomback as ${ROLE_LABELS[role]}. Choose a password to activate your account (link valid for 7 days).`, cta: { label: 'Accept invitation', url: inviteUrl } }) });
  audit(actorOf(req), 'user', `Invited ${email} as ${ROLE_LABELS[role]}`);
  res.status(201).json({ id, inviteUrl });
});

adminRouter.patch('/users/:id', requirePerm('users.manage'), (req, res) => {
  const me = authed(req);
  const target = q.get<UserRow>('SELECT * FROM users WHERE id = ? AND account_id = ?', [intParam(req.params.id), me.account_id]);
  if (!target) throw notFound('User not found.');
  const body = rawBody(req);
  const changes: string[] = [];
  if (body.role !== undefined) {
    const role = oneOf(req, 'role', ROLES);
    if (target.id === me.id && role !== 'admin') throw badRequest('You cannot remove your own administrator role.');
    if (target.role === 'admin' && role !== 'admin' && Number(q.value("SELECT COUNT(*) FROM users WHERE account_id = ? AND role = 'admin' AND status = 'active'", [me.account_id])) <= 1) throw badRequest('The account needs at least one administrator.');
    q.run('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
    changes.push(`role → ${ROLE_LABELS[role]}`);
  }
  if (body.status !== undefined) {
    const status = oneOf(req, 'status', ['active', 'disabled'] as const);
    if (target.id === me.id) throw badRequest('You cannot disable your own account.');
    q.run('UPDATE users SET status = ? WHERE id = ?', [status, target.id]);
    if (status === 'disabled') destroyUserSessions(target.id);
    changes.push(`status → ${status}`);
  }
  if (body.name !== undefined) {
    q.run('UPDATE users SET name = ? WHERE id = ?', [str(req, 'name', { required: true, max: 120 }), target.id]);
    changes.push('name');
  }
  if ('clientId' in body) {
    const clientId = body.clientId === null ? null : intParam(body.clientId, 'client');
    if (clientId && !q.get('SELECT id FROM clients WHERE id = ? AND account_id = ?', [clientId, me.account_id])) throw badRequest('Unknown client workspace.');
    q.run('UPDATE users SET client_id = ? WHERE id = ?', [clientId, target.id]);
    changes.push(clientId ? 'limited to a client workspace' : 'access to all workspaces');
  }
  audit(actorOf(req), 'user', `Updated ${target.email}: ${changes.join(', ') || 'no changes'}`);
  res.json({ ok: true });
});

adminRouter.delete('/users/:id', requirePerm('users.manage'), (req, res) => {
  const me = authed(req);
  const target = q.get<UserRow>('SELECT * FROM users WHERE id = ? AND account_id = ?', [intParam(req.params.id), me.account_id]);
  if (!target) throw notFound('User not found.');
  if (target.id === me.id) throw badRequest('You cannot remove yourself.');
  if (target.role === 'admin' && Number(q.value("SELECT COUNT(*) FROM users WHERE account_id = ? AND role = 'admin'", [me.account_id])) <= 1) throw badRequest('The account needs at least one administrator.');
  q.run('DELETE FROM users WHERE id = ?', [target.id]);
  audit(actorOf(req), 'user', `Removed ${target.email}`);
  res.json({ ok: true });
});

// ── Audit history (6 months, filters: date, user, type) ──────────────────────
adminRouter.get('/audit', requirePerm('audit.view'), (req, res) => {
  const me = authed(req);
  const params: (string | number)[] = [me.account_id];
  let where = 'account_id = ?';
  if (req.query.type) {
    where += ' AND type = ?';
    params.push(String(req.query.type));
  }
  if (req.query.user) {
    where += ' AND user_id = ?';
    params.push(Number(req.query.user));
  }
  if (req.query.from) {
    where += ' AND created_at >= ?';
    params.push(String(req.query.from));
  }
  if (req.query.to) {
    where += ' AND created_at <= ?';
    params.push(`${String(req.query.to)}T23:59:59.999Z`);
  }
  if (req.query.q) {
    where += ' AND lower(details) LIKE ?';
    params.push(`%${String(req.query.q).toLowerCase()}%`);
  }
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const perPage = 50;
  const total = Number(q.value(`SELECT COUNT(*) FROM audit_events WHERE ${where}`, params));
  const items = q.all<{ id: number; user_label: string; type: string; details: string; ip: string | null; created_at: string }>(`SELECT * FROM audit_events WHERE ${where} ORDER BY created_at ${dir} LIMIT ? OFFSET ?`, [...params, perPage, (page - 1) * perPage]);
  const users = q.all<{ id: number; name: string }>('SELECT id, name FROM users WHERE account_id = ? ORDER BY name', [me.account_id]);
  const types = q.all<{ type: string }>('SELECT DISTINCT type FROM audit_events WHERE account_id = ? ORDER BY type', [me.account_id]).map((t) => t.type);
  res.json({ items: items.map((i) => ({ id: i.id, who: i.user_label, what: i.type, details: i.details, ip: i.ip, when: i.created_at })), total, page, perPage, users, types, retentionDays: config.auditRetentionDays });
});

// ── Billing summary (plans & payments come later — Plan.md §10) ───────────────
adminRouter.get('/billing', requirePerm('billing.view'), (req, res) => {
  const me = authed(req);
  const account = q.get<{ name: string; plan_started_at: string }>('SELECT name, plan_started_at FROM accounts WHERE id = ?', [me.account_id])!;
  const u = usage(me.account_id);
  const invoices = q.all<{ id: number; issued_at: string; amount_cents: number; currency: string; description: string }>('SELECT * FROM invoices WHERE account_id = ? ORDER BY issued_at DESC', [me.account_id]);
  res.json({
    company: account.name,
    plan: { name: u.plan.name, startedAt: account.plan_started_at, maxPagesPerScan: u.plan.max_pages_per_scan, concurrentScans: u.plan.concurrent_scans },
    quotas: { daily: u.daily, weekly: u.weekly, monthly: u.monthly },
    users: u.users,
    disk: u.disk,
    scannerIps: config.scannerIps,
    charges: invoices.map((i) => ({ id: i.id, date: i.issued_at, amount: i.amount_cents / 100, currency: i.currency, description: i.description })),
    paymentsEnabled: false,
  });
});

// ── Release notes ─────────────────────────────────────────────────────────────
adminRouter.get('/release-notes', (_req, res) => {
  const rows = q.all<{ id: number; version: string; title: string; category: string; released_at: string; new_features: string; rule_changes: string; fixes: string }>('SELECT * FROM release_notes ORDER BY released_at DESC, id DESC');
  res.json(rows.map((r) => ({ id: r.id, version: r.version, title: r.title, category: r.category, date: r.released_at, newFeatures: JSON.parse(r.new_features) as string[], ruleChanges: JSON.parse(r.rule_changes) as string[], fixes: JSON.parse(r.fixes) as string[] })));
});

// ── Rule documentation (guideline chips link here) ────────────────────────────
adminRouter.get('/rules', (req, res) => {
  const text = String(req.query.q ?? '').toLowerCase();
  const category = String(req.query.category ?? '');
  const rules = allRules()
    .filter((r) => !r.id.startsWith('compat.') || text) // thousands of generated compat rules: only when searching
    .filter((r) => (!category || r.category === category) && (!text || `${r.id} ${r.title} ${r.description}`.toLowerCase().includes(text)))
    .slice(0, 500)
    .map((r) => ({ id: r.id, title: r.title, category: r.category, severity: r.severity, section: r.section, version: r.version }));
  res.json(rules);
});

adminRouter.get('/rules/:id', (req, res) => {
  const rule = getRule(String(req.params.id));
  if (!rule) throw notFound('Rule not found.');
  res.json(rule);
});

// ── Client workspaces (agency / white-label mode, Plan.md §15) ─────────────────
adminRouter.get('/clients', (req, res) => {
  const me = authed(req);
  const rows = q.all<{ id: number; name: string; contact_email: string | null; logo_path: string | null; sites: number }>(
    `SELECT c.*, (SELECT COUNT(*) FROM sites s WHERE s.client_id = c.id) AS sites FROM clients c WHERE c.account_id = ? ${me.client_id ? 'AND c.id = ?' : ''} ORDER BY c.name`,
    me.client_id ? [me.account_id, me.client_id] : [me.account_id],
  );
  res.json(rows.map((c) => ({ id: c.id, name: c.name, contactEmail: c.contact_email, logo: c.logo_path ? `/media/uploads/${path.basename(c.logo_path)}` : null, sites: c.sites })));
});

adminRouter.post('/clients', requirePerm('clients.manage'), (req, res) => {
  const me = authed(req);
  const name = str(req, 'name', { required: true, max: 120 });
  const contact = str(req, 'contactEmail', { max: 254 });
  const id = q.run('INSERT INTO clients (account_id, name, contact_email) VALUES (?,?,?)', [me.account_id, name, contact || null]).lastId;
  audit(actorOf(req), 'client', `Created client workspace "${name}"`);
  res.status(201).json({ id });
});

adminRouter.patch('/clients/:id', requirePerm('clients.manage'), (req, res) => {
  const me = authed(req);
  const c = q.get<{ id: number; logo_path: string | null }>('SELECT id, logo_path FROM clients WHERE id = ? AND account_id = ?', [intParam(req.params.id), me.account_id]);
  if (!c) throw notFound('Client not found.');
  const body = rawBody(req);
  if (typeof body.name === 'string') q.run('UPDATE clients SET name = ? WHERE id = ?', [str(req, 'name', { required: true, max: 120 }), c.id]);
  if (typeof body.contactEmail === 'string') q.run('UPDATE clients SET contact_email = ? WHERE id = ?', [str(req, 'contactEmail', { max: 254 }) || null, c.id]);
  // Logo upload as a data URL (PNG/JPEG/SVG ≤ 500 KB) — stored on disk, shown on branded reports.
  if (typeof body.logoDataUrl === 'string') {
    const m = /^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(body.logoDataUrl);
    if (!m) throw badRequest('Upload a PNG, JPEG or SVG image.');
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length > 500 * 1024) throw badRequest('Logo must be 500 KB or smaller.');
    const ext = m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : 'png';
    const file = path.join(config.uploadsDir, `client-${c.id}-${Date.now()}.${ext}`);
    fs.writeFileSync(file, buf);
    if (c.logo_path) fs.rmSync(c.logo_path, { force: true });
    q.run('UPDATE clients SET logo_path = ? WHERE id = ?', [file, c.id]);
  }
  if (body.logoDataUrl === null && c.logo_path) {
    fs.rmSync(c.logo_path, { force: true });
    q.run('UPDATE clients SET logo_path = NULL WHERE id = ?', [c.id]);
  }
  audit(actorOf(req), 'client', `Updated client workspace #${c.id}`);
  res.json({ ok: true });
});

adminRouter.delete('/clients/:id', requirePerm('clients.manage'), (req, res) => {
  const me = authed(req);
  const c = q.get<{ id: number; name: string; logo_path: string | null }>('SELECT * FROM clients WHERE id = ? AND account_id = ?', [intParam(req.params.id), me.account_id]);
  if (!c) throw notFound('Client not found.');
  if (c.logo_path) fs.rmSync(c.logo_path, { force: true });
  q.run('DELETE FROM clients WHERE id = ?', [c.id]);
  audit(actorOf(req), 'client', `Deleted client workspace "${c.name}" (sites kept, now unassigned)`);
  res.json({ ok: true });
});

// ── Portfolio dashboard: roll-up across all client sites (Plan.md §15) ─────────
adminRouter.get('/dashboard', (req, res) => {
  const me = authed(req);
  const scope = siteScope(me);
  const clientFilter = req.query.client ? Number(req.query.client) : null;
  const sites = q.all<{ id: number; url: string; client_id: number | null; client_name: string | null; thumbnail: string | null }>(
    `SELECT s.id, s.url, s.client_id, c.name AS client_name, s.thumbnail FROM sites s LEFT JOIN clients c ON c.id = s.client_id WHERE ${scope.sql}${clientFilter ? ' AND s.client_id = ?' : ''} ORDER BY s.url`,
    clientFilter ? [...scope.params, clientFilter] : scope.params,
  );
  const rows = sites.map((s) => {
    const scans = q.all<{ id: number; finished_at: string; issue_pct: number; priority_pct: number; compliance_score: number | null; pages_checked: number }>(
      "SELECT id, finished_at, issue_pct, priority_pct, compliance_score, pages_checked FROM scans WHERE site_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 8",
      [s.id],
    );
    const latest = scans[0];
    const prev = scans[1];
    const priorityIssues = latest ? Number(q.value("SELECT COUNT(DISTINCT rule_id) FROM issues WHERE scan_id = ? AND severity = 'priority'", [latest.id])) : 0;
    return {
      siteId: s.id,
      url: s.url,
      clientName: s.client_name,
      thumbnail: s.thumbnail,
      latestScanId: latest?.id ?? null,
      lastScanned: latest?.finished_at ?? null,
      pages: latest?.pages_checked ?? 0,
      issuePct: latest?.issue_pct ?? null,
      score: latest?.compliance_score ?? null,
      grade: latest?.compliance_score != null ? scoreGrade(latest.compliance_score) : null,
      delta: latest && prev ? Math.round((latest.issue_pct - prev.issue_pct) * 10) / 10 : null,
      priorityRules: priorityIssues,
      trend: scans.map((x) => x.issue_pct).reverse(),
    };
  });
  const scored = rows.filter((r) => r.score !== null);
  res.json({
    totals: {
      sites: rows.length,
      scanned: scored.length,
      avgScore: scored.length ? Math.round(scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length) : null,
      avgIssuePct: scored.length ? Math.round((scored.reduce((a, r) => a + (r.issuePct ?? 0), 0) / scored.length) * 10) / 10 : null,
      needsAttention: rows.filter((r) => (r.score ?? 100) < 70 || (r.delta ?? 0) > 5).length,
      running: Number(q.value(`SELECT COUNT(*) FROM scans sc JOIN sites s ON s.id = sc.site_id WHERE ${scope.sql} AND sc.status IN ('queued','running')`, scope.params)),
    },
    sites: rows,
  });
});
