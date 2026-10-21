/**
 * When is a link really broken? Bot protection and rate limits (401/403/429/999, and 503 or timeouts on
 * other people's sites) say nothing about whether the page exists, so they are reported as "could not
 * verify" diagnostics instead of broken links — avoiding false positives in client reports.
 */
const NOT_VERIFIABLE = new Set([401, 403, 407, 429, 999]);

export type LinkVerdict = 'ok' | 'broken' | 'unverified';

export function linkVerdict(status: number | null, error: string | null, internal: boolean): LinkVerdict {
  if (status !== null) {
    if (status < 400) return 'ok';
    if (NOT_VERIFIABLE.has(status)) return 'unverified';
    if (!internal && status === 503) return 'unverified';
    return 'broken';
  }
  if (!error) return 'ok';
  if (/timed out/i.test(error) && !internal) return 'unverified';
  return 'broken'; // DNS failure, connection refused, TLS error, redirect loop…
}

/** SQL twin of linkVerdict() for table r (scan_resources): true when the resource is broken. */
export const BROKEN_SQL = `(
  (r.status >= 400 AND r.status NOT IN (401, 403, 407, 429, 999) AND NOT (r.internal = 0 AND r.status = 503))
  OR (r.status IS NULL AND r.error IS NOT NULL AND NOT (r.internal = 0 AND r.error LIKE 'Timed out%'))
)`;
