import { q, nowIso } from '../db/index.js';
import type { ScheduleFrequency, ScanOptions } from '../../shared/options.js';
import { openOptions } from '../lib/options.js';
import { audit, systemActor, purgeOldAudit } from '../lib/audit.js';
import { purgeExpiredSessions } from '../auth/session.js';
import { notify } from '../lib/quota.js';
import { tick } from './queue.js';
import { enqueueScan } from './scanService.js';
import { enqueueSitemapRun } from './sitemapService.js';

/** Wall-clock parts of an instant in an IANA timezone. */
function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}

/** Convert a wall-clock time in `tz` to a UTC instant (two-pass offset correction handles DST). */
function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h, min) - asUtc;
  }
  return new Date(guess);
}

/** Next run strictly after `after` for a schedule (Plan.md §9: daily/weekly/monthly with start date and time in the account timezone). */
export function nextRunAt(schedule: ScanOptions['schedule'], tz: string, after = new Date()): string | null {
  const freq: ScheduleFrequency = schedule.frequency;
  if (freq === 'none') return null;
  const [hh, mm] = schedule.time.split(':').map(Number) as [number, number];
  const today = zonedParts(after, tz);
  const [sy, sm, sd] = schedule.startDate ? (schedule.startDate.split('-').map(Number) as [number, number, number]) : [today.y, today.m, today.d];
  let y = sy, m = sm, d = sd;
  let candidate = zonedToUtc(y, m, d, hh, mm, tz);
  let guard = 0;
  while (candidate <= after && guard++ < 1000) {
    if (freq === 'daily') d += 1;
    else if (freq === 'weekly') d += 7;
    else {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      d = Math.min(sd, new Date(Date.UTC(y, m, 0)).getUTCDate()); // clamp to month length (31st → 30th/28th)
    }
    const norm = new Date(Date.UTC(y, m - 1, d));
    y = norm.getUTCFullYear();
    m = norm.getUTCMonth() + 1;
    d = norm.getUTCDate();
    candidate = zonedToUtc(y, m, d, hh, mm, tz);
  }
  return candidate.toISOString();
}

export function accountTimezone(accountId: number): string {
  return q.get<{ timezone: string }>("SELECT timezone FROM users WHERE account_id = ? AND role = 'admin' ORDER BY id LIMIT 1", [accountId])?.timezone ?? 'UTC';
}

export function refreshSiteSchedule(siteId: number) {
  const site = q.get<{ account_id: number; options_json: string }>('SELECT account_id, options_json FROM sites WHERE id = ?', [siteId]);
  if (!site) return;
  const o = openOptions(site.options_json);
  q.run('UPDATE sites SET schedule_frequency = ?, next_run_at = ? WHERE id = ?', [o.schedule.frequency, nextRunAt(o.schedule, accountTimezone(site.account_id)), siteId]);
}

/** Runs every 30 s: fires due schedules, housekeeping, and nudges the job queue. */
export function startScheduler() {
  const run = () => {
    try {
      const due = q.all<{ id: number; account_id: number; url: string; options_json: string }>("SELECT id, account_id, url, options_json FROM sites WHERE next_run_at IS NOT NULL AND next_run_at <= ?", [nowIso()]);
      for (const site of due) {
        const o = openOptions(site.options_json);
        q.run('UPDATE sites SET next_run_at = ? WHERE id = ?', [nextRunAt(o.schedule, accountTimezone(site.account_id), new Date(Date.now() + 1000)), site.id]);
        const busy = q.get("SELECT id FROM scans WHERE site_id = ? AND status IN ('queued','running')", [site.id]);
        if (busy) continue;
        try {
          enqueueScan(site.id, 'scheduled');
          audit(systemActor(site.account_id), 'scan', `Scheduled scan started for ${site.url}`);
        } catch (e) {
          notify(site.account_id, 'scan-failed', 'Scheduled scan skipped', `${site.url}: ${(e as Error).message}`, `/sites/${site.id}`);
        }
      }
      const dueMaps = q.all<{ id: number; account_id: number; url: string; options_json: string }>("SELECT id, account_id, url, options_json FROM sitemaps WHERE next_run_at IS NOT NULL AND next_run_at <= ?", [nowIso()]);
      for (const m of dueMaps) {
        const o = JSON.parse(m.options_json) as { schedule: ScanOptions['schedule'] };
        q.run('UPDATE sitemaps SET next_run_at = ? WHERE id = ?', [nextRunAt(o.schedule, accountTimezone(m.account_id), new Date(Date.now() + 1000)), m.id]);
        if (!q.get("SELECT id FROM sitemap_runs WHERE sitemap_id = ? AND status IN ('queued','running')", [m.id])) enqueueSitemapRun(m.id);
      }
      purgeExpiredSessions();
    } catch (e) {
      console.error('[scheduler]', e);
    }
    void tick();
  };
  run();
  setInterval(run, 30_000).unref();
  setInterval(purgeOldAudit, 6 * 3600_000).unref();
  purgeOldAudit();
}
