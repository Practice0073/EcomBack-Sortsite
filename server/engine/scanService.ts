import fs from 'node:fs';
import path from 'node:path';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { assertCanScan } from '../lib/quota.js';
import { HttpError, badRequest } from '../lib/http.js';
import { sealOptions, openOptions } from '../lib/options.js';
import { DEFAULT_SCAN_OPTIONS, type ScanScope, type ScanOptions } from '../../shared/options.js';
import { normalizeStartUrl } from './url.js';
import { tick } from './queue.js';
import { refreshSiteSchedule } from './scheduler.js';

/** Find or create the site record for (account, url, scope). */
export function upsertSite(accountId: number, rawUrl: string, scope: ScanScope, clientId: number | null = null, options?: ScanOptions): number {
  let url: string;
  try {
    url = normalizeStartUrl(rawUrl);
  } catch (e) {
    throw badRequest((e as Error).message, [{ path: 'url', message: (e as Error).message }]);
  }
  const existing = q.get<{ id: number }>('SELECT id FROM sites WHERE account_id = ? AND url = ? AND scope = ?', [accountId, url, scope]);
  if (existing) return existing.id;
  const id = q.run('INSERT INTO sites (account_id, client_id, url, scope, options_json) VALUES (?,?,?,?,?)', [accountId, clientId, url, scope, sealOptions(options ?? DEFAULT_SCAN_OPTIONS)]).lastId;
  refreshSiteSchedule(id);
  return id;
}

export function enqueueScan(siteId: number, trigger: 'manual' | 'scheduled' | 'api'): number {
  const site = q.get<{ id: number; account_id: number; url: string; scope: ScanScope; options_json: string }>('SELECT * FROM sites WHERE id = ?', [siteId]);
  if (!site) throw new HttpError(404, 'Site not found.');
  const active = q.get<{ id: number }>("SELECT id FROM scans WHERE site_id = ? AND status IN ('queued','running')", [siteId]);
  if (active) throw new HttpError(409, 'A scan of this site is already running. Stop it first or wait for it to finish.');
  assertCanScan(site.account_id);
  // Snapshot the options so the report always shows the settings that produced it.
  const id = q.run('INSERT INTO scans (site_id, status, trigger, url, scope, options_json, queued_at) VALUES (?,?,?,?,?,?,?)', [siteId, 'queued', trigger, site.url, site.scope, site.options_json, nowIso()]).lastId;
  void tick();
  return id;
}

export function requestStop(scanId: number) {
  const s = q.get<{ status: string }>('SELECT status FROM scans WHERE id = ?', [scanId]);
  if (!s) throw new HttpError(404, 'Scan not found.');
  if (s.status === 'queued') {
    q.run("UPDATE scans SET status = 'stopped', finished_at = ? WHERE id = ?", [nowIso(), scanId]);
    return;
  }
  if (s.status !== 'running') throw badRequest('This scan is not running.');
  q.run('UPDATE scans SET stop_requested = 1 WHERE id = ?', [scanId]);
}

export function resumeScan(scanId: number) {
  const s = q.get<{ status: string; site_id: number; crawl_state: string | null }>('SELECT status, site_id, crawl_state FROM scans WHERE id = ?', [scanId]);
  if (!s) throw new HttpError(404, 'Scan not found.');
  if (s.status !== 'stopped' || !s.crawl_state) throw badRequest('Only stopped scans can be resumed.');
  if (q.get("SELECT id FROM scans WHERE site_id = ? AND status IN ('queued','running')", [s.site_id])) throw new HttpError(409, 'Another scan of this site is in progress.');
  q.run("UPDATE scans SET status = 'queued', stop_requested = 0, finished_at = NULL WHERE id = ?", [scanId]);
  void tick();
}

/** Child tables of a scan, deleted leaf-first in small batches. */
const SCAN_CHILD_TABLES = ['issues', 'page_refs', 'diagnostics', 'scan_resources', 'scan_pages'] as const;
const DELETE_BATCH = 2000;

/**
 * Deleting scans frees their disk quota (Plan.md §10). Screenshots and exports are removed too.
 * A finished scan can hold hundreds of thousands of rows; one big transaction would hold SQLite's write lock
 * for many seconds and make running scan workers fail with "database is locked". Rows are therefore deleted
 * in short batches, each its own transaction, so the lock is released between batches.
 */
export function deleteScans(scanIds: number[]) {
  for (const id of scanIds) {
    const status = q.get<{ status: string }>('SELECT status FROM scans WHERE id = ?', [id])?.status;
    if (status === 'running' || status === 'queued') throw badRequest('Stop running scans before deleting them.');
  }
  for (const id of scanIds) {
    for (const e of q.all<{ file_path: string | null }>('SELECT file_path FROM report_exports WHERE scan_id = ?', [id])) if (e.file_path) fs.rmSync(e.file_path, { force: true });
    fs.rmSync(path.join(config.screenshotsDir, `scan-${id}.jpg`), { force: true });
    for (const table of SCAN_CHILD_TABLES) {
      while (q.run(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE scan_id = ? LIMIT ${DELETE_BATCH})`, [id]).changes > 0);
    }
    q.run('DELETE FROM scans WHERE id = ?', [id]);
  }
}

export function siteOptions(siteId: number): ScanOptions {
  const row = q.get<{ options_json: string }>('SELECT options_json FROM sites WHERE id = ?', [siteId]);
  if (!row) throw new HttpError(404, 'Site not found.');
  return openOptions(row.options_json);
}
