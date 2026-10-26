/**
 * `npm run check:links` — proves that linkVerdict() (TypeScript) and BROKEN_SQL (SQLite) agree on every
 * status/error/internal combination the fetcher can produce. Exits 1 on the first disagreement.
 */
import { DatabaseSync } from 'node:sqlite';
import { ADDRESS_ERRORS, BROKEN_SQL, linkVerdict } from '../engine/linkStatus.js';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE scan_resources (scan_id INTEGER, url TEXT, status INTEGER, error TEXT, internal INTEGER)');
const insert = db.prepare('INSERT INTO scan_resources (scan_id, url, status, error, internal) VALUES (1, ?, ?, ?, ?)');
const broken = db.prepare(`SELECT url FROM scan_resources r WHERE r.scan_id = 1 AND ${BROKEN_SQL}`);

const statuses: (number | null)[] = [null, 200, 204, 301, 302, 304, 400, 401, 403, 404, 405, 406, 407, 410, 418, 429, 451, 500, 502, 503, 504, 999];
const errors: (string | null)[] = [null, 'Timed out after 30s', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'UND_ERR_SOCKET', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'EAI_AGAIN', 'EPROTO', ...ADDRESS_ERRORS];

let n = 0;
const expected = new Map<string, boolean>();
for (const internal of [0, 1]) {
  for (const status of statuses) {
    for (const error of status === null ? errors : [null]) {
      const url = `https://host/${n++}`;
      insert.run(url, status, error, internal);
      expected.set(url, linkVerdict(status, error, internal === 1) === 'broken');
    }
  }
}
const sqlBroken = new Set((broken.all() as { url: string }[]).map((r) => r.url));
let failures = 0;
// `NOT ${BROKEN_SQL}` must select exactly the complement (no NULL rows lost to three-valued logic).
const notBroken = (db.prepare(`SELECT COUNT(*) AS n FROM scan_resources r WHERE r.scan_id = 1 AND NOT ${BROKEN_SQL}`).get() as { n: number }).n;
if (notBroken !== expected.size - sqlBroken.size) {
  failures++;
  console.error(`NOT BROKEN_SQL selected ${notBroken} rows, expected ${expected.size - sqlBroken.size} (some rows evaluate to NULL)`);
}
for (const [url, isBroken] of expected) {
  if (sqlBroken.has(url) !== isBroken) {
    failures++;
    const row = db.prepare('SELECT status, error, internal FROM scan_resources WHERE url = ?').get(url) as { status: number | null; error: string | null; internal: number };
    console.error(`MISMATCH ${JSON.stringify(row)}: linkVerdict says ${isBroken ? 'broken' : 'not broken'}, BROKEN_SQL says ${sqlBroken.has(url) ? 'broken' : 'not broken'}`);
  }
}

// Spot checks against the cases that produced false positives in real scans.
const cases: [number | null, string | null, boolean, ReturnType<typeof linkVerdict>][] = [
  [400, null, false, 'unverified'], // facebook.com answers 400 to non-browsers
  [404, null, false, 'broken'],
  [410, null, false, 'broken'],
  [500, null, false, 'broken'],
  [503, null, false, 'unverified'],
  [503, null, true, 'broken'],
  [403, null, true, 'unverified'],
  [null, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', false, 'unverified'],
  [null, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', true, 'broken'],
  [null, 'ENOTFOUND', false, 'broken'],
  [null, 'EAI_AGAIN', false, 'unverified'],
  [null, 'ECONNRESET', false, 'unverified'],
  [null, 'Timed out after 30s', false, 'unverified'],
  [null, 'Timed out after 30s', true, 'broken'],
  [null, 'Redirect loop', false, 'broken'],
  [200, null, false, 'ok'],
];
for (const [status, error, internal, want] of cases) {
  const got = linkVerdict(status, error, internal);
  if (got !== want) {
    failures++;
    console.error(`WRONG VERDICT status=${status} error=${error} internal=${internal}: got ${got}, want ${want}`);
  }
}

if (failures) {
  console.error(`\n${failures} failure(s) over ${expected.size} combinations.`);
  process.exit(1);
}
console.log(`OK: linkVerdict() and BROKEN_SQL agree on all ${expected.size} combinations; ${cases.length} spot checks pass.`);
