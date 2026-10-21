import { Router } from 'express';
import { q } from '../db/index.js';
import { authed, actorOf, requirePerm, siteScope } from '../auth/session.js';
import { siteFor, scanFor, type ScanRecord, type SiteRecord } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { badRequest, intParam, oneOf, rawBody, str } from '../lib/http.js';
import { planFor } from '../lib/quota.js';
import { applyIncoming, maskOptions, openOptions, sealOptions } from '../lib/options.js';
import { validateOptions, type ScanScope } from '../../shared/options.js';
import { enqueueScan, upsertSite, requestStop, resumeScan, deleteScans } from '../engine/scanService.js';
import { refreshSiteSchedule } from '../engine/scheduler.js';
import { progressOf } from '../engine/scanRunner.js';
import { scanDto, siteDto } from './dto.js';

export const sitesRouter = Router();
const SCOPES = ['site', 'folder', 'page', 'page-links'] as const satisfies readonly ScanScope[];

// ── Sites (the Scans list) ────────────────────────────────────────────────────
sitesRouter.get('/sites', (req, res) => {
  const user = authed(req);
  const scope = siteScope(user);
  const search = String(req.query.q ?? '').trim().toLowerCase();
  const clientId = req.query.client ? Number(req.query.client) : null;
  const sort = ['address', 'date', 'disk', 'issues'].includes(String(req.query.sort)) ? String(req.query.sort) : 'date';
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const perPage = Math.min(100, Math.max(5, Number(req.query.perPage ?? 20)));
  const params: (string | number)[] = [...scope.params];
  let where = scope.sql;
  if (search) {
    where += ' AND lower(s.url) LIKE ?';
    params.push(`%${search}%`);
  }
  if (clientId) {
    where += ' AND s.client_id = ?';
    params.push(clientId);
  }
  const orderSql = {
    address: 's.url',
    date: "COALESCE((SELECT MAX(COALESCE(finished_at, started_at, queued_at)) FROM scans x WHERE x.site_id = s.id), s.created_at)",
    disk: '(SELECT COALESCE(SUM(disk_bytes),0) FROM scans x WHERE x.site_id = s.id)',
    issues: "COALESCE((SELECT issue_pct FROM scans x WHERE x.site_id = s.id AND x.status IN ('completed','stopped') ORDER BY x.id DESC LIMIT 1), -1)",
  }[sort];
  const total = Number(q.value(`SELECT COUNT(*) FROM sites s WHERE ${where}`, params));
  const rows = q.all<SiteRecord & { client_name: string | null }>(
    `SELECT s.*, c.name AS client_name FROM sites s LEFT JOIN clients c ON c.id = s.client_id WHERE ${where} ORDER BY ${orderSql} ${dir}, s.id DESC LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  res.json({ items: rows.map(siteDto), total, page, perPage });
});

/** POST /scans — New Scan (Plan.md §12). Creates the site if needed, then queues a scan. */
sitesRouter.post('/scans', requirePerm('scan.run'), (req, res) => {
  const user = authed(req);
  const url = str(req, 'url', { required: true, max: 2048 });
  const scope = oneOf(req, 'scope', SCOPES, 'site');
  const clientId = user.client_id ?? (rawBody(req).clientId ? intParam(rawBody(req).clientId, 'client') : null);
  if (clientId && !q.get('SELECT id FROM clients WHERE id = ? AND account_id = ?', [clientId, user.account_id])) throw badRequest('Unknown client workspace.');
  const siteId = upsertSite(user.account_id, url, scope, clientId);
  const scanId = enqueueScan(siteId, req.auth?.viaToken ? 'api' : 'manual');
  const site = q.get<SiteRecord>('SELECT * FROM sites WHERE id = ?', [siteId])!;
  audit(actorOf(req), 'scan', `Started ${scope} scan of ${site.url}`);
  res.status(201).json({ siteId, scanId });
});

sitesRouter.get('/sites/:id', (req, res) => {
  const site = siteFor(req);
  const client = site.client_id ? q.get<{ name: string }>('SELECT name FROM clients WHERE id = ?', [site.client_id]) : null;
  res.json({ ...siteDto({ ...site, client_name: client?.name ?? null }), options: maskOptions(openOptions(site.options_json)) });
});

sitesRouter.patch('/sites/:id', requirePerm('scan.options'), (req, res) => {
  const site = siteFor(req);
  const user = authed(req);
  const body = rawBody(req);
  if ('clientId' in body) {
    const clientId = body.clientId === null ? null : intParam(body.clientId, 'client');
    if (clientId && !q.get('SELECT id FROM clients WHERE id = ? AND account_id = ?', [clientId, user.account_id])) throw badRequest('Unknown client workspace.');
    q.run('UPDATE sites SET client_id = ? WHERE id = ?', [clientId, site.id]);
    audit(actorOf(req), 'site', `Moved ${site.url} to ${clientId ? `client #${clientId}` : 'no client'}`);
  }
  res.json({ ok: true });
});

sitesRouter.delete('/sites/:id', requirePerm('site.delete'), (req, res) => {
  const site = siteFor(req);
  const confirm = str(req, 'confirm');
  if (confirm !== new URL(site.url).hostname) throw badRequest(`Type ${new URL(site.url).hostname} to confirm.`, [{ path: 'confirm', message: 'Does not match.' }]);
  const ids = q.all<{ id: number; status: string }>('SELECT id, status FROM scans WHERE site_id = ?', [site.id]);
  if (ids.some((s) => s.status === 'running' || s.status === 'queued')) throw badRequest('Stop the running scan before deleting this site.');
  deleteScans(ids.map((s) => s.id));
  q.run('DELETE FROM sites WHERE id = ?', [site.id]);
  audit(actorOf(req), 'site', `Deleted site ${site.url} and ${ids.length} scan(s)`);
  res.json({ ok: true });
});

sitesRouter.post('/sites/:id/scan', requirePerm('scan.run'), (req, res) => {
  const site = siteFor(req);
  const scanId = enqueueScan(site.id, req.auth?.viaToken ? 'api' : 'manual');
  audit(actorOf(req), 'scan', `Started scan of ${site.url}`);
  res.status(201).json({ scanId });
});

/** Bulk actions on the Scans list (Plan.md §5.4 enhancement). */
sitesRouter.post('/sites/bulk', requirePerm('scan.run'), (req, res) => {
  const user = authed(req);
  const action = oneOf(req, 'action', ['scan', 'stop'] as const);
  const ids = Array.isArray(rawBody(req).ids) ? (rawBody(req).ids as unknown[]).map((x) => intParam(x)) : [];
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const id of ids.slice(0, 100)) {
    const site = q.get<SiteRecord>('SELECT * FROM sites WHERE id = ?', [id]);
    if (!site || site.account_id !== user.account_id || (user.client_id && site.client_id !== user.client_id)) {
      results.push({ id, ok: false, error: 'Not found' });
      continue;
    }
    try {
      if (action === 'scan') enqueueScan(id, 'manual');
      else {
        const active = q.get<{ id: number }>("SELECT id FROM scans WHERE site_id = ? AND status IN ('queued','running')", [id]);
        if (active) requestStop(active.id);
      }
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  audit(actorOf(req), 'scan', `Bulk ${action} on ${results.filter((r) => r.ok).length} site(s)`);
  res.json({ results });
});

// ── Options (Edit Scan) ───────────────────────────────────────────────────────
sitesRouter.get('/sites/:id/options', (req, res) => {
  const site = siteFor(req);
  res.json({ url: site.url, scope: site.scope, options: maskOptions(openOptions(site.options_json)) });
});

sitesRouter.put('/sites/:id/options', requirePerm('scan.options'), (req, res) => {
  const site = siteFor(req);
  const user = authed(req);
  const body = rawBody(req);
  const next = applyIncoming(openOptions(site.options_json), body.options);
  const errors = validateOptions(next);
  if (errors.length) throw badRequest('Some options need attention.', errors);
  let url = site.url;
  let scope = site.scope;
  if (typeof body.scope === 'string' && (SCOPES as readonly string[]).includes(body.scope)) scope = body.scope as ScanScope;
  if (typeof body.url === 'string' && body.url.trim() && body.url.trim() !== site.url) {
    const newId = upsertSite(user.account_id, body.url, scope, site.client_id, next);
    if (newId !== site.id) {
      res.json({ ok: true, siteId: newId, moved: true });
      return;
    }
    url = body.url;
  }
  const clash = q.get<{ id: number }>('SELECT id FROM sites WHERE account_id = ? AND url = ? AND scope = ? AND id != ?', [user.account_id, url, scope, site.id]);
  if (clash) throw badRequest('Another site entry already uses this address and scope.');
  q.run('UPDATE sites SET options_json = ?, scope = ? WHERE id = ?', [sealOptions(next), scope, site.id]);
  refreshSiteSchedule(site.id);
  audit(actorOf(req), 'options', `Updated scan options for ${site.url}`);
  res.json({ ok: true, siteId: site.id });
});

// ── History ───────────────────────────────────────────────────────────────────
sitesRouter.get('/sites/:id/history', (req, res) => {
  const site = siteFor(req);
  const quota = planFor(site.account_id).disk_quota_bytes;
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const perPage = Math.min(100, Math.max(5, Number(req.query.perPage ?? 20)));
  const total = Number(q.value('SELECT COUNT(*) FROM scans WHERE site_id = ?', [site.id]));
  const rows = q.all<ScanRecord>(`SELECT * FROM scans WHERE site_id = ? ORDER BY COALESCE(started_at, queued_at) ${dir}, id ${dir} LIMIT ? OFFSET ?`, [site.id, perPage, (page - 1) * perPage]);
  const trend = q.all<{ id: number; finished_at: string; priority_pct: number; other_pct: number; issue_pct: number; compliance_score: number | null }>(
    "SELECT id, finished_at, priority_pct, other_pct, issue_pct, compliance_score FROM scans WHERE site_id = ? AND status = 'completed' ORDER BY finished_at",
    [site.id],
  );
  const disk = Number(q.value('SELECT COALESCE(SUM(disk_bytes),0) FROM scans WHERE site_id = ?', [site.id]));
  res.json({
    items: rows.map((r) => ({ ...scanDto(r, quota), running: r.status === 'running' || r.status === 'queued' ? progressOf(r.id) : null, canResume: r.status === 'stopped' && !!r.crawl_state })),
    total,
    page,
    perPage,
    trend: trend.map((t) => ({ scanId: t.id, date: t.finished_at, priority: t.priority_pct, other: t.other_pct, issues: t.issue_pct, score: t.compliance_score })),
    footer: { scans: total, diskBytes: disk, diskPct: quota ? Math.round((disk / quota) * 10000) / 100 : 0 },
  });
});

sitesRouter.post('/sites/:id/scans/delete', requirePerm('scan.delete'), (req, res) => {
  const site = siteFor(req);
  const body = rawBody(req);
  const host = new URL(site.url).hostname;
  if (str(req, 'confirm') !== host) throw badRequest(`Type ${host} to confirm.`, [{ path: 'confirm', message: 'Does not match.' }]);
  const all = body.all === true;
  const ids = all
    ? q.all<{ id: number }>("SELECT id FROM scans WHERE site_id = ? AND status NOT IN ('queued','running')", [site.id]).map((r) => r.id)
    : (Array.isArray(body.ids) ? body.ids : []).map((x) => intParam(x)).filter((id) => q.get('SELECT id FROM scans WHERE id = ? AND site_id = ?', [id, site.id]));
  if (!ids.length) throw badRequest('Select at least one finished scan to delete.');
  deleteScans(ids);
  audit(actorOf(req), 'scan', `Deleted ${ids.length} scan(s) of ${site.url}`);
  res.json({ deleted: ids.length });
});

// ── Scans ─────────────────────────────────────────────────────────────────────
sitesRouter.get('/scans', (req, res) => {
  const user = authed(req);
  const scope = siteScope(user);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
  const rows = q.all<ScanRecord>(`SELECT sc.* FROM scans sc JOIN sites s ON s.id = sc.site_id WHERE ${scope.sql} ORDER BY sc.id DESC LIMIT ?`, [...scope.params, limit]);
  const quota = planFor(user.account_id).disk_quota_bytes;
  res.json({ items: rows.map((r) => ({ ...scanDto(r, quota), running: r.status === 'running' || r.status === 'queued' ? progressOf(r.id) : null })) });
});

sitesRouter.get('/scans/:id', (req, res) => {
  const { scan, site } = scanFor(req);
  res.json({ ...scanDto(scan, planFor(site.account_id).disk_quota_bytes), running: scan.status === 'running' || scan.status === 'queued' ? progressOf(scan.id) : null, canResume: scan.status === 'stopped' && !!scan.crawl_state });
});

sitesRouter.post('/scans/:id/stop', requirePerm('scan.run'), (req, res) => {
  const { scan } = scanFor(req);
  requestStop(scan.id);
  audit(actorOf(req), 'scan', `Stopped scan of ${scan.url}`);
  res.json({ ok: true });
});

sitesRouter.post('/scans/:id/resume', requirePerm('scan.run'), (req, res) => {
  const { scan } = scanFor(req);
  resumeScan(scan.id);
  audit(actorOf(req), 'scan', `Resumed scan of ${scan.url}`);
  res.json({ ok: true });
});

sitesRouter.delete('/scans/:id', requirePerm('scan.delete'), (req, res) => {
  const { scan } = scanFor(req);
  deleteScans([scan.id]);
  audit(actorOf(req), 'scan', `Deleted scan #${scan.id} of ${scan.url}`);
  res.json({ ok: true });
});
