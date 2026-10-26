/**
 * When is a link really broken? A client report must not call a link dead because the other site
 * refused an automated request, had a bad moment, or this machine's network blipped:
 *
 *   - 401/403/407/429/999 (and 503 from other people's sites) are bot protection or rate limiting:
 *     they say nothing about whether the page exists → "could not verify".
 *   - On other people's sites only "gone" answers are evidence of a dead link: 404 and 410, or
 *     server errors that survived the fetcher's retries (500/502/504). Facebook, LinkedIn and many
 *     CDNs answer 400/405/406/451 to anything that is not a browser.
 *   - Network errors on other people's sites are only dead when the *address* is wrong: the host does
 *     not exist, nothing listens there, or the redirects never end. Certificate chains that Node cannot
 *     verify (browsers fetch the missing intermediate), reset or closed sockets, temporary DNS failures
 *     and timeouts are reported as "could not verify" instead.
 *   - On the site being scanned every failure is the owner's to fix, so it is reported as broken.
 *
 * linkVerdict() and BROKEN_SQL are two forms of the same rule; `npm run check:links` asserts they agree.
 */
export const NOT_VERIFIABLE_STATUSES = [401, 403, 407, 429, 999] as const;
export const EXTERNAL_BROKEN_STATUSES = [404, 410, 500, 502, 504] as const;
/** Error prefixes (from the fetcher) that mean the address itself is wrong. */
export const ADDRESS_ERRORS = ['ENOTFOUND', 'EAI_NONAME', 'EAI_NODATA', 'ECONNREFUSED', 'Redirect loop', 'Too many redirects'] as const;

export type LinkVerdict = 'ok' | 'broken' | 'unverified';

export function linkVerdict(status: number | null, error: string | null, internal: boolean): LinkVerdict {
  if (status !== null) {
    if (status < 400) return 'ok';
    if ((NOT_VERIFIABLE_STATUSES as readonly number[]).includes(status)) return 'unverified';
    if (internal) return 'broken';
    return (EXTERNAL_BROKEN_STATUSES as readonly number[]).includes(status) ? 'broken' : 'unverified';
  }
  if (!error) return 'ok';
  if (internal) return 'broken'; // DNS, connection, TLS, timeout — all on the owner's own domains
  return ADDRESS_ERRORS.some((p) => error.startsWith(p)) ? 'broken' : 'unverified';
}

/** Human explanation for an unverified link, shown in Diagnostics. */
export function unverifiedReason(status: number | null, error: string | null): string {
  if (status === 403) return '403 Forbidden — the site may be blocking automated checks';
  if (status === 401 || status === 407) return `${status} — the page needs a sign-in`;
  if (status === 429 || status === 999 || status === 503) return `${status} — rate limiting or bot protection`;
  if (status !== null) return `${status} — the other site refused this request; it did not say the page is missing`;
  if (error && /CERT|TLS|SSL|LEAF_SIGNATURE|SELF_SIGNED|EPROTO/i.test(error)) return `${error} — certificate problem on the other site (browsers may still open it)`;
  if (error && /timed out|TIMEOUT/i.test(error)) return `${error} — the other site did not answer in time`;
  return `${error ?? 'no response'} — network error while checking the other site`;
}

/**
 * SQL twin of linkVerdict() for table alias r (scan_resources): true when the resource is broken.
 * Written without NULL comparisons (status → -1, error → ''), so it is always TRUE or FALSE and `NOT ${BROKEN_SQL}`
 * means "not broken" rather than NULL.
 */
export const BROKEN_SQL = `(
  (r.internal = 1 AND ((COALESCE(r.status, -1) >= 400 AND COALESCE(r.status, -1) NOT IN (${NOT_VERIFIABLE_STATUSES.join(', ')})) OR (r.status IS NULL AND COALESCE(r.error, '') != '')))
  OR (r.internal = 0 AND (COALESCE(r.status, -1) IN (${EXTERNAL_BROKEN_STATUSES.join(', ')}) OR (r.status IS NULL AND (${ADDRESS_ERRORS.map((p) => `COALESCE(r.error, '') LIKE '${p}%'`).join(' OR ')}))))
)`;
