import { q } from '../db/index.js';
import { CATEGORIES, BROWSER_LABELS, type Category, type ScanOptions } from '../../shared/options.js';
import type { Benchmark, CategoryStat } from '../../shared/types.js';
import { allRules } from './rules/catalog.js';
import { openOptions } from '../lib/options.js';

export interface ScanStats {
  pagesChecked: number;
  filesChecked: number;
  htmlPages: number;
  pagesWithIssues: number;
  issuePct: number;
  priorityPct: number;
  otherPct: number;
  rulesChecked: number;
  complianceScore: number;
  categories: CategoryStat[];
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

const SECTION_HELP: Record<string, string> = {
  'Level A': 'WCAG Level A: the minimum. Failures block some people from using the page at all.',
  'Level AA': 'WCAG Level AA: the level required by the ADA (DOJ 2024 rule), Section 508 and EN 301 549.',
  'Level AAA': 'WCAG Level AAA: enhanced accessibility; not normally required for whole sites.',
  Warnings: 'Best practices and items automated testing cannot decide — review them manually.',
  ARIA: 'WAI-ARIA: roles, states and properties that assistive technology relies on.',
  'Screen readers': 'Patterns that JAWS, NVDA or VoiceOver handle poorly.',
  'PDF/UA': 'PDF/UA-1 checks on linked PDF documents.',
  'Reading age': 'Text that needs a higher reading level than your target.',
  'Broken links': 'Links and files that return errors.',
  'Server and configuration': 'Server responses, redirects, encoding and mixed content.',
  Spelling: 'Words not found in the dictionary.',
  'Content rules': 'Your forbidden and required text.',
  'Page weight': 'Pages heavier than your limit.',
  Content: 'Empty or placeholder pages.',
  Google: 'Google Search Essentials and SEO starter guide.',
  Bing: 'Bing Webmaster Guidelines.',
  DuckDuckGo: 'DuckDuckGo result sources.',
  'robots.txt': 'robots.txt rules and sitemap discovery.',
  'Best practices': 'Widely accepted best practices.',
  Keywords: 'Keywords you asked to optimise.',
  'HTML validation': 'Markup that does not follow the HTML Living Standard.',
  'CSS validation': 'CSS that does not follow the W3C grammar.',
  'Obsolete features': 'Elements and attributes removed from HTML.',
  DOCTYPE: 'Document type declarations.',
  Readability: 'How easy the text is to read.',
};

export function computeStats(scanId: number, options: ScanOptions): ScanStats {
  const pages = q.value<number>('SELECT COUNT(*) FROM scan_pages WHERE scan_id = ?', [scanId]);
  const htmlPages = q.value<number>("SELECT COUNT(*) FROM scan_pages WHERE scan_id = ? AND content_type LIKE 'text/html%'", [scanId]);
  const files = q.value<number>('SELECT COUNT(*) FROM scan_resources WHERE scan_id = ?', [scanId]);
  const withIssues = q.value<number>('SELECT COUNT(*) FROM scan_pages WHERE scan_id = ? AND (priority_count > 0 OR other_count > 0)', [scanId]);
  const withPriority = q.value<number>('SELECT COUNT(*) FROM scan_pages WHERE scan_id = ? AND priority_count > 0', [scanId]);
  const withOther = q.value<number>('SELECT COUNT(*) FROM scan_pages WHERE scan_id = ? AND other_count > 0', [scanId]);

  const enabled: Record<Category, boolean> = Object.fromEntries(CATEGORIES.map((c) => [c, options.rules[c].enabled])) as Record<Category, boolean>;

  // Section bars count real issues only (like the category gauge); accessibility "needs review"
  // warnings are shown in their own Warnings bar so the numbers always agree.
  const sectionRows = q.all<{ category: Category; section: string; pages: number }>(
    `SELECT r.category,
            CASE WHEN i.severity = 'warning' AND r.category = 'accessibility' THEN 'Warnings' ELSE r.section END AS section,
            COUNT(DISTINCT i.page_id) AS pages
       FROM issues i JOIN rules r ON r.id = i.rule_id
      WHERE i.scan_id = ? AND (i.severity != 'warning' OR r.category = 'accessibility')
      GROUP BY 1, 2`,
    [scanId],
  );
  const catRows = q.all<{ category: Category; pages: number; total: number; pri: number; oth: number; warn: number }>(
    `SELECT category,
            COUNT(DISTINCT CASE WHEN severity != 'warning' THEN page_id END) AS pages,
            COUNT(*) AS total,
            SUM(severity = 'priority') AS pri, SUM(severity = 'other') AS oth, SUM(severity = 'warning') AS warn
       FROM issues WHERE scan_id = ? GROUP BY category`,
    [scanId],
  );

  const categories: CategoryStat[] = CATEGORIES.map((category) => {
    const row = catRows.find((r) => r.category === category);
    const sections = sectionRows.filter((s) => s.category === category);
    const order = defaultSections(category, options);
    for (const s of sections) if (!order.includes(s.section)) order.push(s.section);
    return {
      category,
      enabled: enabled[category],
      pagesWithIssues: row?.pages ?? 0,
      issuePct: pct(row?.pages ?? 0, pages),
      issueCount: row?.total ?? 0,
      priorityCount: row?.pri ?? 0,
      otherCount: row?.oth ?? 0,
      warningCount: row?.warn ?? 0,
      bars: order.map((label) => ({ label, pct: pct(sections.find((s) => s.section === label)?.pages ?? 0, pages), help: SECTION_HELP[label] ?? '' })),
    };
  });

  return {
    pagesChecked: pages,
    filesChecked: Math.max(files, pages),
    htmlPages,
    pagesWithIssues: withIssues,
    issuePct: pct(withIssues, pages),
    priorityPct: pct(withPriority, pages),
    otherPct: pct(withOther, pages),
    rulesChecked: allRules().filter((r) => enabled[r.category]).length,
    complianceScore: complianceScore(scanId, pages),
    categories,
  };
}

function defaultSections(category: Category, o: ScanOptions): string[] {
  switch (category) {
    case 'accessibility': {
      const lv = o.rules.accessibility.wcagLevel;
      return ['Level A', ...(lv !== 'A' ? ['Level AA'] : []), ...(lv === 'AAA' ? ['Level AAA'] : []), 'Warnings'];
    }
    case 'compatibility':
      return o.rules.compatibility.browsers.map((b) => BROWSER_LABELS[b]);
    case 'errors':
      return ['Broken links', 'Server and configuration', 'Spelling'];
    case 'search':
      return [...o.rules.search.engines.map((e) => ({ google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo' })[e]), 'Best practices'];
    case 'standards':
      return ['HTML validation', 'CSS validation', 'Obsolete features'];
    case 'usability':
      return ['Best practices', 'Readability'];
  }
}

/**
 * ADA/WCAG compliance score (0–100). Starts at 100; each failing accessibility rule deducts by severity
 * and by the share of pages it affects. Warnings do not deduct. Transparent by design — shown in the UI.
 */
export function complianceScore(scanId: number, pages: number): number {
  if (!pages) return 100;
  const rows = q.all<{ severity: string; pages: number }>(
    `SELECT severity, COUNT(DISTINCT page_id) AS pages FROM issues
      WHERE scan_id = ? AND category = 'accessibility' AND severity != 'warning' GROUP BY rule_id, severity`,
    [scanId],
  );
  let score = 100;
  for (const r of rows) {
    const share = Math.min(1, r.pages / pages);
    score -= r.severity === 'priority' ? 4 + 8 * share : 1.5 + 3 * share;
  }
  return Math.max(0, Math.round(score));
}

export const scoreGrade = (s: number) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 55 ? 'D' : 'F');

/** Provisional baselines until enough scans exist (Plan.md §18.2 — benchmark source is an open question). */
export const BASELINE_ISSUE_PCT = 45;
const CATEGORY_BASELINE: Record<Category, number> = { accessibility: 60, compatibility: 25, errors: 40, search: 55, standards: 70, usability: 50 };
const MIN_SITES = 20;

function latestStats(): ScanStats[] {
  return q
    .all<{ stats_json: string | null }>(
      `SELECT sc.stats_json FROM scans sc
        WHERE sc.status = 'completed' AND sc.id = (SELECT MAX(id) FROM scans x WHERE x.site_id = sc.site_id AND x.status = 'completed')`,
    )
    .flatMap((r) => (r.stats_json ? [JSON.parse(r.stats_json) as ScanStats] : []));
}

function blend(value: number, samples: number[], baseline: number, what: string): Benchmark {
  const n = samples.length;
  const local = n ? samples.reduce((a, b) => a + b, 0) / n : baseline;
  // Blend towards the baseline until MIN_SITES sites exist, so a handful of scans cannot skew it.
  const weight = Math.min(1, n / MIN_SITES);
  const avg = Math.round((local * weight + baseline * (1 - weight)) * 10) / 10;
  const label = value < avg - 5 ? 'better' : value > avg + 5 ? 'worse' : 'average';
  const source =
    n >= MIN_SITES
      ? `Average ${what} of the latest scan of ${n} sites checked with SortSite Tools.`
      : `Blend of ${n} site${n === 1 ? '' : 's'} scanned here and a provisional Ecomback baseline of ${baseline}% for ${what} (replaced by real data once ${MIN_SITES}+ sites are scanned).`;
  return { value: avg, label, source };
}

export function benchmarkFor(issuePct: number): Benchmark {
  return blend(issuePct, latestStats().map((s) => s.issuePct), BASELINE_ISSUE_PCT, 'pages with issues');
}

export function categoryBenchmarks(stats: ScanStats): Record<Category, Benchmark> {
  const all = latestStats();
  return Object.fromEntries(
    CATEGORIES.map((c) => {
      const mine = stats.categories.find((x) => x.category === c)?.issuePct ?? 0;
      const samples = all.flatMap((s) => s.categories.filter((x) => x.category === c && x.enabled).map((x) => x.issuePct));
      return [c, blend(mine, samples, CATEGORY_BASELINE[c], `pages with ${c} issues`)];
    }),
  ) as Record<Category, Benchmark>;
}

/** Bump when the stats formula changes; stored snapshots of finished scans are recomputed once at start-up. */
const STATS_VERSION = '2';

export function refreshStoredStats() {
  const current = q.get<{ value: string }>("SELECT value FROM meta WHERE key = 'stats-version'")?.value;
  if (current === STATS_VERSION) return;
  const scans = q.all<{ id: number; options_json: string }>("SELECT id, options_json FROM scans WHERE status IN ('completed','stopped') AND stats_json IS NOT NULL");
  for (const s of scans) {
    const stats = computeStats(s.id, openOptions(s.options_json));
    q.run('UPDATE scans SET stats_json = ?, compliance_score = ? WHERE id = ?', [JSON.stringify(stats), stats.complianceScore, s.id]);
  }
  q.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('stats-version', ?)", [STATS_VERSION]);
  if (scans.length) console.log(`[stats] recomputed report statistics for ${scans.length} scan(s)`);
}
