import { Router } from 'express';
import { q } from '../db/index.js';
import { authed, actorOf, requirePerm } from '../auth/session.js';
import { sitemapFor } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { badRequest, intParam, notFound, rawBody, str } from '../lib/http.js';
import { createSitemap, enqueueSitemapRun, parseSitemapOptions, validateSitemapOptions } from '../engine/sitemapService.js';
import { nextRunAt, accountTimezone } from '../engine/scheduler.js';
import type { SitemapOptions } from '../../shared/sitemap.js';
import { mergeOptions } from '../../shared/options.js';

export const sitemapsRouter = Router();

interface RunRow { id: number; sitemap_id: number; status: string; queued_at: string; started_at: string | null; finished_at: string | null; pages_found: number; pages_done: number; current_url: string | null; disk_bytes: number; error: string | null }
const runDto = (r: RunRow | undefined) => (r ? { id: r.id, status: r.status, queuedAt: r.queued_at, startedAt: r.started_at, finishedAt: r.finished_at, pagesFound: r.pages_found, pagesDone: r.pages_done, currentUrl: r.current_url, diskBytes: r.disk_bytes, error: r.error } : null);

sitemapsRouter.get('/sitemaps', (req, res) => {
  const me = authed(req);
  const text = String(req.query.q ?? '').toLowerCase();
  const sort = String(req.query.sort ?? 'date');
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const order = { address: 'm.url', date: "COALESCE((SELECT MAX(COALESCE(finished_at, queued_at)) FROM sitemap_runs r WHERE r.sitemap_id = m.id), m.created_at)", disk: '(SELECT COALESCE(SUM(disk_bytes),0) FROM sitemap_runs r WHERE r.sitemap_id = m.id)' }[sort] ?? 'm.created_at';
  const params: (string | number)[] = [me.account_id];
  let where = 'm.account_id = ?';
  if (me.client_id) {
    where += ' AND m.client_id = ?';
    params.push(me.client_id);
  }
  if (text) {
    where += ' AND lower(m.url) LIKE ?';
    params.push(`%${text}%`);
  }
  const rows = q.all<{ id: number; url: string; thumbnail: string | null; schedule_frequency: string; next_run_at: string | null; options_json: string }>(`SELECT m.* FROM sitemaps m WHERE ${where} ORDER BY ${order} ${dir}`, params);
  const quota = q.get<{ disk_quota_bytes: number }>('SELECT p.disk_quota_bytes FROM plans p JOIN accounts a ON a.plan_id = p.id WHERE a.id = ?', [me.account_id])?.disk_quota_bytes ?? 1;
  res.json(
    rows.map((m) => {
      const disk = Number(q.value('SELECT COALESCE(SUM(disk_bytes),0) FROM sitemap_runs WHERE sitemap_id = ?', [m.id]));
      return {
        id: m.id,
        url: m.url,
        thumbnail: m.thumbnail,
        schedule: parseSitemapOptions(m.options_json).schedule.frequency,
        nextRunAt: m.next_run_at,
        diskBytes: disk,
        diskPct: Math.round((disk / quota) * 10000) / 100,
        lastRun: runDto(q.get<RunRow>('SELECT * FROM sitemap_runs WHERE sitemap_id = ? ORDER BY id DESC LIMIT 1', [m.id])),
      };
    }),
  );
});

sitemapsRouter.post('/sitemaps', requirePerm('sitemap.run'), (req, res) => {
  const me = authed(req);
  const url = str(req, 'url', { required: true, max: 2048 });
  const id = createSitemap(me.account_id, url, me.client_id);
  const runId = enqueueSitemapRun(id);
  audit(actorOf(req), 'sitemap', `Started site map of ${url}`);
  res.status(201).json({ id, runId });
});

sitemapsRouter.get('/sitemaps/:id', (req, res) => {
  const m = sitemapFor(req);
  const runs = q.all<RunRow>('SELECT * FROM sitemap_runs WHERE sitemap_id = ? ORDER BY id DESC LIMIT 20', [m.id]);
  res.json({ id: m.id, url: m.url, thumbnail: m.thumbnail, options: parseSitemapOptions(m.options_json), nextRunAt: m.next_run_at, runs: runs.map(runDto) });
});

sitemapsRouter.put('/sitemaps/:id/options', requirePerm('sitemap.run'), (req, res) => {
  const m = sitemapFor(req);
  const me = authed(req);
  const incoming = (rawBody(req).options ?? {}) as Partial<SitemapOptions>;
  const current = parseSitemapOptions(m.options_json);
  const next: SitemapOptions = {
    scope: incoming.scope === 'folder' ? 'folder' : 'site',
    maxPages: Number(incoming.maxPages ?? current.maxPages),
    depthMode: incoming.depthMode === 'limited' ? 'limited' : 'entire',
    maxDepth: Number(incoming.maxDepth ?? current.maxDepth),
    blocks: typeof incoming.blocks === 'string' ? incoming.blocks.slice(0, 5000) : current.blocks,
    obeyRobots: typeof incoming.obeyRobots === 'boolean' ? incoming.obeyRobots : current.obeyRobots,
    includeImages: typeof incoming.includeImages === 'boolean' ? incoming.includeImages : current.includeImages,
    schedule: mergeOptions({ schedule: incoming.schedule ?? current.schedule }).schedule,
  };
  const errors = validateSitemapOptions(next);
  if (errors.length) throw badRequest('Some options need attention.', errors);
  q.run('UPDATE sitemaps SET options_json = ?, schedule_frequency = ?, next_run_at = ? WHERE id = ?', [JSON.stringify(next), next.schedule.frequency, nextRunAt(next.schedule, accountTimezone(me.account_id)), m.id]);
  audit(actorOf(req), 'sitemap', `Updated site map options for ${m.url}`);
  res.json({ ok: true });
});

sitemapsRouter.post('/sitemaps/:id/run', requirePerm('sitemap.run'), (req, res) => {
  const m = sitemapFor(req);
  const runId = enqueueSitemapRun(m.id);
  audit(actorOf(req), 'sitemap', `Map Now: ${m.url}`);
  res.status(201).json({ runId });
});

sitemapsRouter.post('/sitemaps/:id/stop', requirePerm('sitemap.run'), (req, res) => {
  const m = sitemapFor(req);
  q.run("UPDATE sitemap_runs SET stop_requested = 1 WHERE sitemap_id = ? AND status = 'running'", [m.id]);
  q.run("UPDATE sitemap_runs SET status = 'stopped' WHERE sitemap_id = ? AND status = 'queued'", [m.id]);
  res.json({ ok: true });
});

sitemapsRouter.delete('/sitemaps/:id', requirePerm('sitemap.run'), (req, res) => {
  const m = sitemapFor(req);
  if (q.get("SELECT id FROM sitemap_runs WHERE sitemap_id = ? AND status IN ('queued','running')", [m.id])) throw badRequest('Stop the running map first.');
  q.run('DELETE FROM sitemaps WHERE id = ?', [m.id]);
  audit(actorOf(req), 'sitemap', `Deleted site map ${m.url}`);
  res.json({ ok: true });
});

function runFor(sitemapId: number, runParam: unknown) {
  const runId = runParam ? intParam(runParam, 'run') : q.get<{ id: number }>("SELECT id FROM sitemap_runs WHERE sitemap_id = ? AND status IN ('completed','stopped','running') ORDER BY id DESC LIMIT 1", [sitemapId])?.id;
  const run = runId ? q.get<RunRow>('SELECT * FROM sitemap_runs WHERE id = ? AND sitemap_id = ?', [runId, sitemapId]) : undefined;
  if (!run) throw notFound('This map has not been built yet.');
  return run;
}

/** Map result: node list for the visual tree, plus summary counts. */
sitemapsRouter.get('/sitemaps/:id/result', (req, res) => {
  const m = sitemapFor(req);
  const run = runFor(m.id, req.query.run);
  const nodes = q.all<{ url: string; parent_url: string | null; title: string | null; status: number | null; depth: number; content_type: string | null }>('SELECT url, parent_url, title, status, depth, content_type FROM sitemap_nodes WHERE run_id = ? ORDER BY depth, url', [run.id]);
  const depths = new Map<number, number>();
  for (const n of nodes) depths.set(n.depth, (depths.get(n.depth) ?? 0) + 1);
  res.json({
    run: runDto(run),
    url: m.url,
    nodes: nodes.map((n) => ({ url: n.url, parentUrl: n.parent_url, title: n.title, status: n.status, depth: n.depth, contentType: n.content_type })),
    byDepth: [...depths].sort((a, b) => a[0] - b[0]).map(([depth, count]) => ({ depth, count })),
    errors: nodes.filter((n) => (n.status ?? 0) >= 400 || n.status === null).length,
  });
});

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Standard XML sitemap (sitemaps.org protocol) of every page that returned 200. */
sitemapsRouter.get('/sitemaps/:id/sitemap.xml', (req, res) => {
  const m = sitemapFor(req);
  const run = runFor(m.id, req.query.run);
  const nodes = q.all<{ url: string; depth: number; last_modified: string | null }>("SELECT url, depth, last_modified FROM sitemap_nodes WHERE run_id = ? AND status = 200 AND (content_type IS NULL OR content_type LIKE 'text/html%') ORDER BY depth, url", [run.id]);
  const body = nodes
    .map((n) => {
      const lastmod = n.last_modified && !Number.isNaN(Date.parse(n.last_modified)) ? `<lastmod>${new Date(n.last_modified).toISOString().slice(0, 10)}</lastmod>` : '';
      const priority = Math.max(0.1, 1 - n.depth * 0.2).toFixed(1);
      return `  <url><loc>${xmlEsc(n.url)}</loc>${lastmod}<priority>${priority}</priority></url>`;
    })
    .join('\n');
  res.setHeader('Content-Disposition', `attachment; filename="sitemap-${new URL(m.url).hostname}.xml"`);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by SortSite Tools by Ecomback -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

sitemapsRouter.get('/sitemaps/:id/sitemap.csv', (req, res) => {
  const m = sitemapFor(req);
  const run = runFor(m.id, req.query.run);
  const nodes = q.all<{ url: string; parent_url: string | null; title: string | null; status: number | null; depth: number }>('SELECT url, parent_url, title, status, depth FROM sitemap_nodes WHERE run_id = ? ORDER BY depth, url', [run.id]);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['URL,Title,Status,Click depth,Linked from', ...nodes.map((n) => [n.url, n.title, n.status, n.depth, n.parent_url].map(cell).join(','))].join('\r\n');
  res.setHeader('Content-Disposition', `attachment; filename="sitemap-${new URL(m.url).hostname}.csv"`);
  res.type('text/csv').send(`﻿${csv}`);
});

