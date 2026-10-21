import type { Request } from 'express';
import { q } from '../db/index.js';
import { authed, type UserRow } from '../auth/session.js';
import { notFound, intParam } from './http.js';
import type { ScanScope } from '../../shared/options.js';
import type { ScanStatus } from '../../shared/types.js';

export interface SiteRecord { id: number; account_id: number; client_id: number | null; url: string; scope: ScanScope; options_json: string; schedule_frequency: string; next_run_at: string | null; thumbnail: string | null; created_at: string }
export interface ScanRecord { id: number; site_id: number; status: ScanStatus; trigger: string; url: string; scope: ScanScope; options_json: string; queued_at: string; started_at: string | null; finished_at: string | null; pages_found: number; pages_done: number; current_url: string | null; pages_checked: number; files_checked: number; rules_checked: number; issue_pct: number; priority_pct: number; other_pct: number; compliance_score: number | null; stats_json: string | null; disk_bytes: number; thumbnail: string | null; shopify: number; crawl_state: string | null; error: string | null }

const visible = (user: UserRow, site: { account_id: number; client_id: number | null }) => site.account_id === user.account_id && (!user.client_id || site.client_id === user.client_id);

/** Loads a site the signed-in user may see; 404 (not 403) so IDs of other tenants are not disclosed. */
export function siteFor(req: Request, idParam: unknown = req.params.id): SiteRecord {
  const user = authed(req);
  const site = q.get<SiteRecord>('SELECT * FROM sites WHERE id = ?', [intParam(idParam)]);
  if (!site || !visible(user, site)) throw notFound('Site not found.');
  return site;
}

export function scanFor(req: Request, idParam: unknown = req.params.id): { scan: ScanRecord; site: SiteRecord } {
  const user = authed(req);
  const scan = q.get<ScanRecord>('SELECT * FROM scans WHERE id = ?', [intParam(idParam, 'scan id')]);
  if (!scan) throw notFound('Scan not found.');
  const site = q.get<SiteRecord>('SELECT * FROM sites WHERE id = ?', [scan.site_id]);
  if (!site || !visible(user, site)) throw notFound('Scan not found.');
  return { scan, site };
}

export function sitemapFor(req: Request, idParam: unknown = req.params.id) {
  const user = authed(req);
  const m = q.get<{ id: number; account_id: number; client_id: number | null; url: string; options_json: string; schedule_frequency: string; next_run_at: string | null; thumbnail: string | null }>('SELECT * FROM sitemaps WHERE id = ?', [intParam(idParam)]);
  if (!m || !visible(user, m)) throw notFound('Sitemap not found.');
  return m;
}
