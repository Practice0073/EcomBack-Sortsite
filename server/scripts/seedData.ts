import { q, tx, nowIso } from '../db/index.js';
import { hashPassword } from '../lib/crypto.js';

export const DEFAULT_ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@ecomback.com',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'Ecomback-Local-2026!',
  name: process.env.SEED_ADMIN_NAME ?? 'Ecomback Admin',
};

const RELEASE_NOTES = [
  {
    version: '1.0.0',
    title: 'SortSite Tools by Ecomback 1.0',
    category: 'Release',
    date: '2026-10-19',
    features: [
      'Full-site scans of up to 500 pages with live progress, stop and resume',
      'Accessibility checks for WCAG 2.0 / 2.1 / 2.2 (A, AA, AAA), WAI-ARIA, Section 508, EN 301 549 and PDF/UA-1',
      'Browser compatibility, broken links, spelling, search engine, HTML/CSS standards and usability checks',
      'Reports: Summary, 3D site map, Issues, Pages, Inventory and Diagnostics',
      'Exports to Word, PDF, HTML, CSV, Excel and JSON with Ecomback branding',
      'Scheduling with emailed reports and alerts',
      'Shopify-first preset, ADA/WCAG compliance score, accessibility statement helper, prioritized fix plan, before/after comparison and portfolio dashboard',
    ],
    rules: ['Initial rule catalog: axe-core 4.14 accessibility rules, html-validate standard rules, MDN browser-compat data, Ecomback search, error and usability rules'],
    fixes: [],
  },
  {
    version: '0.9.0',
    title: 'Private beta',
    category: 'Beta',
    date: '2026-10-12',
    features: ['Crawler with robots.txt, link-depth and domain scoping', 'Headless Chrome rendering with Smart and All DOM modes'],
    rules: ['Screen reader compatibility rules for JAWS, NVDA and VoiceOver'],
    fixes: ['Line numbers now point at the original page source, not the rendered DOM'],
  },
];

/** Idempotent first-run seed: default plan, account, administrator and release notes. */
export function ensureSeed() {
  if (q.get('SELECT id FROM accounts LIMIT 1')) return;
  tx(() => {
    const planId = q.run(
      'INSERT INTO plans (name, daily_scans, weekly_scans, monthly_scans, users_allowed, disk_quota_bytes, max_pages_per_scan, concurrent_scans) VALUES (?,?,?,?,?,?,?,?)',
      ['Ecomback Agency (local)', 50, 200, 600, 10, 2 * 1024 ** 3, 500, 2],
    ).lastId;
    const accountId = q.run('INSERT INTO accounts (name, plan_id, plan_started_at) VALUES (?,?,?)', ['Ecomback', planId, nowIso()]).lastId;
    q.run("INSERT INTO subscriptions (account_id, plan_id, status, started_at) VALUES (?, ?, 'active', ?)", [accountId, planId, nowIso()]);
    q.run("INSERT INTO users (account_id, email, name, password_hash, role, status, timezone, password_changed_at) VALUES (?,?,?,?, 'admin', 'active', ?, ?)", [
      accountId,
      DEFAULT_ADMIN.email.toLowerCase(),
      DEFAULT_ADMIN.name,
      hashPassword(DEFAULT_ADMIN.password),
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      nowIso(),
    ]);
    q.run('INSERT INTO alert_settings (account_id) VALUES (?)', [accountId]);
    for (const n of RELEASE_NOTES) {
      q.run('INSERT INTO release_notes (version, title, category, released_at, new_features, rule_changes, fixes) VALUES (?,?,?,?,?,?,?)', [n.version, n.title, n.category, n.date, JSON.stringify(n.features), JSON.stringify(n.rules), JSON.stringify(n.fixes)]);
    }
  });
  console.log('\n  First run: created the Ecomback account.');
  console.log(`  Sign in with  ${DEFAULT_ADMIN.email}  /  ${DEFAULT_ADMIN.password}`);
  console.log('  (change the password under Account › Security)\n');
}
