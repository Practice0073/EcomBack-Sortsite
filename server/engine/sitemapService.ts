import { q, nowIso } from '../db/index.js';
import { HttpError, badRequest } from '../lib/http.js';
import { DEFAULT_SITEMAP_OPTIONS, type SitemapOptions } from '../../shared/sitemap.js';
import { mergeOptions } from '../../shared/options.js';
import { normalizeStartUrl } from './url.js';
import { tick } from './queue.js';
import { assertCanScan } from '../lib/quota.js';

export function parseSitemapOptions(json: string | null | undefined): SitemapOptions {
  const raw = json ? (JSON.parse(json) as Partial<SitemapOptions>) : {};
  const o = { ...DEFAULT_SITEMAP_OPTIONS, ...raw };
  o.schedule = mergeOptions({ schedule: raw.schedule }).schedule;
  return o;
}

export function validateSitemapOptions(o: SitemapOptions): { path: string; message: string }[] {
  const errs: { path: string; message: string }[] = [];
  if (!Number.isInteger(o.maxPages) || o.maxPages < 1 || o.maxPages > 5000) errs.push({ path: 'maxPages', message: 'Enter 1 to 5000.' });
  if (!Number.isInteger(o.maxDepth) || o.maxDepth < 1 || o.maxDepth > 50) errs.push({ path: 'maxDepth', message: 'Enter 1 to 50.' });
  if (!['site', 'folder'].includes(o.scope)) errs.push({ path: 'scope', message: 'Choose Entire Site or Folder.' });
  return errs;
}

export function createSitemap(accountId: number, rawUrl: string, clientId: number | null): number {
  let url: string;
  try {
    url = normalizeStartUrl(rawUrl);
  } catch (e) {
    throw badRequest((e as Error).message, [{ path: 'url', message: (e as Error).message }]);
  }
  const existing = q.get<{ id: number }>('SELECT id FROM sitemaps WHERE account_id = ? AND url = ?', [accountId, url]);
  if (existing) return existing.id;
  return q.run('INSERT INTO sitemaps (account_id, client_id, url, options_json) VALUES (?,?,?,?)', [accountId, clientId, url, JSON.stringify(DEFAULT_SITEMAP_OPTIONS)]).lastId;
}

export function enqueueSitemapRun(sitemapId: number): number {
  const m = q.get<{ account_id: number }>('SELECT account_id FROM sitemaps WHERE id = ?', [sitemapId]);
  if (!m) throw new HttpError(404, 'Sitemap not found.');
  if (q.get("SELECT id FROM sitemap_runs WHERE sitemap_id = ? AND status IN ('queued','running')", [sitemapId])) throw new HttpError(409, 'This map is already being built.');
  assertCanScan(m.account_id);
  const id = q.run("INSERT INTO sitemap_runs (sitemap_id, status, queued_at) VALUES (?, 'queued', ?)", [sitemapId, nowIso()]).lastId;
  void tick();
  return id;
}
