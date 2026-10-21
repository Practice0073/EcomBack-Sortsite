import { q, nowIso } from '../db/index.js';
import { HttpError } from './http.js';
import { bus } from './events.js';

export interface PlanRow {
  id: number;
  name: string;
  daily_scans: number;
  weekly_scans: number;
  monthly_scans: number;
  users_allowed: number;
  disk_quota_bytes: number;
  max_pages_per_scan: number;
  concurrent_scans: number;
}

export function planFor(accountId: number): PlanRow {
  const plan = q.get<PlanRow>('SELECT p.* FROM plans p JOIN accounts a ON a.plan_id = p.id WHERE a.id = ?', [accountId]);
  if (!plan) throw new Error(`Account ${accountId} has no plan`);
  return plan;
}

export function diskUsed(accountId: number): number {
  const scans = q.value<number>('SELECT COALESCE(SUM(sc.disk_bytes),0) FROM scans sc JOIN sites s ON s.id = sc.site_id WHERE s.account_id = ?', [accountId]);
  const maps = q.value<number>('SELECT COALESCE(SUM(r.disk_bytes),0) FROM sitemap_runs r JOIN sitemaps m ON m.id = r.sitemap_id WHERE m.account_id = ?', [accountId]);
  return Number(scans) + Number(maps);
}

export function scanCountSince(accountId: number, sinceMs: number): number {
  return Number(q.value<number>('SELECT COUNT(*) FROM scans sc JOIN sites s ON s.id = sc.site_id WHERE s.account_id = ? AND sc.queued_at >= ?', [accountId, new Date(Date.now() - sinceMs).toISOString()]));
}

export function usage(accountId: number) {
  const plan = planFor(accountId);
  const disk = diskUsed(accountId);
  const users = Number(q.value<number>("SELECT COUNT(*) FROM users WHERE account_id = ? AND status != 'disabled'", [accountId]));
  return {
    plan,
    disk: { used: disk, quota: plan.disk_quota_bytes, pct: plan.disk_quota_bytes ? Math.round((disk / plan.disk_quota_bytes) * 1000) / 10 : 0 },
    daily: { used: scanCountSince(accountId, 86400_000), limit: plan.daily_scans },
    weekly: { used: scanCountSince(accountId, 7 * 86400_000), limit: plan.weekly_scans },
    monthly: { used: scanCountSince(accountId, 30 * 86400_000), limit: plan.monthly_scans },
    users: { used: users, limit: plan.users_allowed },
  };
}

/** Throws a friendly 402/429 when a new scan would exceed the plan (Plan.md §6.6, §9). */
export function assertCanScan(accountId: number) {
  const u = usage(accountId);
  if (u.disk.used >= u.disk.quota) throw new HttpError(402, 'Your disk quota is full. Delete old scans to free space, then try again.');
  for (const [label, w] of [['today', u.daily], ['this week', u.weekly], ['this month', u.monthly]] as const) {
    if (w.used >= w.limit) throw new HttpError(429, `Scan limit reached for ${label} (${w.limit} scans on your plan).`);
  }
}

export function notify(accountId: number, kind: string, title: string, body: string, link: string | null, userId: number | null = null) {
  q.run('INSERT INTO notifications (account_id, user_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)', [accountId, userId, kind, title, body, link, nowIso()]);
  bus.emitEvent({ type: 'notification', accountId, userId, title, body, kind, link });
}

/** Alert when disk use crosses the account's threshold (once per crossing). */
export function checkQuotaAlert(accountId: number) {
  const settings = q.get<{ quota_pct: number }>('SELECT quota_pct FROM alert_settings WHERE account_id = ?', [accountId]);
  const threshold = settings?.quota_pct ?? 90;
  const u = usage(accountId);
  const key = `quota-alert-${accountId}`;
  const flagged = q.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  if (u.disk.pct >= threshold && !flagged) {
    notify(accountId, 'quota', 'Disk quota nearly full', `You have used ${u.disk.pct}% of your disk quota. Delete old scans to free space.`, '/scans');
    q.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, nowIso()]);
  } else if (u.disk.pct < threshold && flagged) {
    q.run('DELETE FROM meta WHERE key = ?', [key]);
  }
}
