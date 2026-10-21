import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';

export type AuditType =
  | 'login'
  | 'login-failed'
  | 'logout'
  | 'password'
  | '2fa'
  | 'scan'
  | 'site'
  | 'options'
  | 'export'
  | 'sitemap'
  | 'user'
  | 'settings'
  | 'client'
  | 'api-token'
  | 'billing';

export interface Actor { accountId: number; userId: number | null; label: string; ip?: string | null }

export function audit(actor: Actor, type: AuditType, details: string) {
  q.run('INSERT INTO audit_events (account_id, user_id, user_label, type, details, ip, created_at) VALUES (?,?,?,?,?,?,?)', [
    actor.accountId,
    actor.userId,
    actor.label,
    type,
    details,
    actor.ip ?? null,
    nowIso(),
  ]);
}

export const systemActor = (accountId: number): Actor => ({ accountId, userId: null, label: 'Scheduler' });

/** Retention: purge audit events older than the configured window (default ~6 months). */
export function purgeOldAudit() {
  const cutoff = new Date(Date.now() - config.auditRetentionDays * 86400_000).toISOString();
  q.run('DELETE FROM audit_events WHERE created_at < ?', [cutoff]);
}
