import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p): p is string => !!p && fs.existsSync(p)) ?? null;
}

export const config = {
  root,
  version: pkg.version,
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  baseUrl,
  /** Behind a reverse proxy or PaaS (Railway, Render, Fly.io, Vercel rewrites) set TRUST_PROXY=1 so client IPs come from X-Forwarded-For. */
  trustProxy: process.env.TRUST_PROXY === undefined ? 'loopback' : /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY,
  /** Session cookies are marked Secure in production unless the public address is plain http (an internal LAN deployment). */
  cookieSecure: process.env.NODE_ENV === 'production' && !baseUrl.startsWith('http://'),
  dataDir,
  dbFile: path.join(dataDir, 'sortsite.db'),
  screenshotsDir: path.join(dataDir, 'screenshots'),
  exportsDir: path.join(dataDir, 'exports'),
  outboxDir: path.join(dataDir, 'outbox'),
  uploadsDir: path.join(dataDir, 'uploads'),
  secretKeyFile: path.join(dataDir, '.secret-key'),
  assetsDir: path.join(root, 'assets'),
  chromePath: findChrome(),
  /** Extra Chrome flags, e.g. CHROME_ARGS="--no-sandbox --disable-gpu" inside containers that run Chrome as a non-root user without user namespaces. */
  chromeArgs: (process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean),
  /** Concurrent page workers per scan and concurrent scans overall. */
  pageConcurrency: Number(process.env.PAGE_CONCURRENCY ?? 4),
  scanConcurrency: Number(process.env.SCAN_CONCURRENCY ?? 2),
  session: {
    cookie: 'ss_session',
    idleTimeoutMs: 1000 * 60 * 60 * 8, // 8h idle
    rememberMs: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
  login: { maxFailures: 5, lockoutMs: 15 * 60 * 1000, ipWindowMs: 15 * 60 * 1000, ipMaxAttempts: 30 },
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 183),
  /** Fixed scanner egress IPs published on the Billing page for allowlisting (set in production). */
  scannerIps: (process.env.SCANNER_IPS ?? '127.0.0.1 (local development)').split(',').map((s) => s.trim()),
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
        from: process.env.SMTP_FROM ?? 'SortSite Tools by Ecomback <no-reply@ecomback.com>',
      }
    : null,
  userAgent: 'Mozilla/5.0 (compatible; SortSiteTools/1.0; +https://www.ecomback.com) Chrome/130 Safari/537.36',
} as const;

for (const dir of [config.dataDir, config.screenshotsDir, config.exportsDir, config.outboxDir, config.uploadsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
