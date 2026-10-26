import { q } from '../db/index.js';
import { planFor } from '../lib/quota.js';
import type { ScanRecord, SiteRecord } from '../lib/access.js';
import type { ScanSummaryRow, SiteRow } from '../../shared/types.js';
import { progressOf } from '../engine/scanRunner.js';
import { openOptions } from '../lib/options.js';

const FREQ_LABEL: Record<string, string> = { none: 'Not scheduled', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export function scanDto(s: ScanRecord, quotaBytes: number): ScanSummaryRow {
  return {
    id: s.id,
    siteId: s.site_id,
    url: s.url,
    scope: s.scope,
    status: s.status,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    pagesChecked: s.pages_checked,
    issuePct: s.issue_pct,
    priorityPct: s.priority_pct,
    otherPct: s.other_pct,
    diskBytes: s.disk_bytes,
    diskPct: quotaBytes ? Math.round((s.disk_bytes / quotaBytes) * 10000) / 100 : 0,
    thumbnail: s.thumbnail,
    error: s.error,
  };
}

export function siteDto(site: SiteRecord & { client_name?: string | null }): SiteRow {
  const quota = planFor(site.account_id).disk_quota_bytes;
  // The latest finished scan, failures included, so a site whose last scan failed says so instead of "Never".
  const last = q.get<ScanRecord>("SELECT * FROM scans WHERE site_id = ? AND status IN ('completed','stopped','failed') ORDER BY id DESC LIMIT 1", [site.id]);
  const active = q.get<ScanRecord>("SELECT * FROM scans WHERE site_id = ? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1", [site.id]);
  const disk = Number(q.value('SELECT COALESCE(SUM(disk_bytes),0) FROM scans WHERE site_id = ?', [site.id]));
  const o = openOptions(site.options_json);
  return {
    id: site.id,
    url: site.url,
    scope: site.scope,
    clientId: site.client_id,
    clientName: site.client_name ?? null,
    scheduleLabel: FREQ_LABEL[o.schedule.frequency] ?? 'Not scheduled',
    nextRunAt: site.next_run_at,
    diskBytes: disk,
    diskPct: quota ? Math.round((disk / quota) * 10000) / 100 : 0,
    lastScan: last ? scanDto(last, quota) : null,
    running: active ? progressOf(active.id) : null,
    thumbnail: site.thumbnail,
    scanCount: Number(q.value('SELECT COUNT(*) FROM scans WHERE site_id = ?', [site.id])),
  };
}
