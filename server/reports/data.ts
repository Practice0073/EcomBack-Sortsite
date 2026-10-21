import { q } from '../db/index.js';
import { openOptions } from '../lib/options.js';
import { planFor } from '../lib/quota.js';
import type { ScanRecord, SiteRecord } from '../lib/access.js';
import { benchmarkFor, categoryBenchmarks, computeStats, scoreGrade, type ScanStats } from '../engine/stats.js';
import { getRule } from '../engine/rules/catalog.js';
import { progressOf } from '../engine/scanRunner.js';
import { BROKEN_SQL } from '../engine/linkStatus.js';
import { scanDto } from '../routes/dto.js';
import { CATEGORY_LABELS, SCOPE_LABELS, BROWSER_LABELS, READING_AGE_LABELS, SPELL_LANGUAGE_LABELS, type Category, type ScanOptions } from '../../shared/options.js';
import type { IssueGroup, IssueOccurrencePage, ReportSummary, Severity } from '../../shared/types.js';

const SEVERITY_RANK: Record<Severity, number> = { priority: 0, other: 1, warning: 2 };

export function statsFor(scan: ScanRecord): ScanStats {
  // Finished scans use the frozen snapshot; running scans are computed live.
  if (scan.stats_json && scan.status !== 'running' && scan.status !== 'queued') return JSON.parse(scan.stats_json) as ScanStats;
  return computeStats(scan.id, openOptions(scan.options_json));
}

export function reportSummary(scan: ScanRecord, site: SiteRecord): ReportSummary {
  const stats = statsFor(scan);
  const options = openOptions(scan.options_json);
  const client = site.client_id ? q.get<{ name: string }>('SELECT name FROM clients WHERE id = ?', [site.client_id]) : null;
  return {
    scan: scanDto(scan, planFor(site.account_id).disk_quota_bytes),
    site: { id: site.id, url: site.url, clientName: client?.name ?? null },
    pagesWithIssues: stats.pagesWithIssues,
    pagesChecked: stats.pagesChecked,
    filesChecked: stats.filesChecked,
    rulesChecked: stats.rulesChecked,
    benchmark: benchmarkFor(stats.issuePct),
    categoryBenchmarks: categoryBenchmarks(stats),
    categories: stats.categories,
    complianceScore: stats.complianceScore,
    diagnosticsCount: Number(q.value('SELECT COUNT(DISTINCT code) FROM diagnostics WHERE scan_id = ?', [scan.id])),
    options: { ...options, crawler: { ...options.crawler, basicPassword: '', headers: '', cookies: '', shopifyStorefrontPassword: '' } },
    shopify: !!scan.shopify,
    running: scan.status === 'running' || scan.status === 'queued' ? progressOf(scan.id) : null,
  };
}

export interface IssueFilters { category?: Category | 'all'; severity?: Severity | 'all'; guideline?: string; text?: string }

/** Issues grouped by rule (one expandable row per rule), ordered by severity then reach. */
export function issueGroups(scanId: number, f: IssueFilters = {}): IssueGroup[] {
  const params: (string | number)[] = [scanId];
  let where = 'i.scan_id = ?';
  if (f.category && f.category !== 'all') {
    where += ' AND i.category = ?';
    params.push(f.category);
  }
  if (f.severity && f.severity !== 'all') {
    where += ' AND i.severity = ?';
    params.push(f.severity);
  }
  // One row per rule: the most severe level found, and the distinct pages across all levels, so the row's
  // page count always matches what its expanded page list shows.
  const rows = q.all<{ rule_id: string; severity: Severity; pages: number; occ: number; confirmed: number }>(
    `SELECT i.rule_id,
            CASE MIN(CASE i.severity WHEN 'priority' THEN 0 WHEN 'other' THEN 1 ELSE 2 END) WHEN 0 THEN 'priority' WHEN 1 THEN 'other' ELSE 'warning' END AS severity,
            COUNT(DISTINCT i.page_id) AS pages, COUNT(*) AS occ,
            COUNT(DISTINCT CASE WHEN i.severity != 'warning' THEN i.page_id END) AS confirmed
       FROM issues i WHERE ${where} GROUP BY i.rule_id`,
    params,
  );
  const htmlPages = Math.max(1, Number(q.value("SELECT COUNT(*) FROM scan_pages WHERE scan_id = ? AND content_type LIKE 'text/html%'", [scanId])));
  const merged = new Map<string, IssueGroup>();
  for (const r of rows) {
    const rule = getRule(r.rule_id);
    if (!rule) continue;
    // Same rule can appear with several severities (axe impact); show the most severe, sum the reach.
    const key = rule.id;
    const existing = merged.get(key);
    if (existing) {
      existing.occurrenceCount += r.occ;
      existing.pageCount = Math.max(existing.pageCount, r.pages);
      if (SEVERITY_RANK[r.severity] < SEVERITY_RANK[existing.severity]) existing.severity = r.severity;
      continue;
    }
    merged.set(key, {
      ruleId: rule.id,
      category: rule.category,
      severity: r.severity,
      section: r.severity === 'warning' && rule.category === 'accessibility' && rule.section.startsWith('Level') ? 'Warnings' : rule.section,
      title: rule.title,
      description: rule.description,
      fix: rule.fix,
      guidelines: rule.guidelines,
      pageCount: r.pages,
      confirmedPageCount: r.confirmed,
      occurrenceCount: r.occ,
      helpUrl: rule.helpUrl,
      templateLevel: false,
    });
  }
  let groups = [...merged.values()];
  if (f.guideline) {
    const g = f.guideline.toLowerCase();
    groups = groups.filter((x) => x.guidelines.some((gl) => gl.label.toLowerCase().includes(g)));
  }
  if (f.text) {
    const t = f.text.toLowerCase();
    groups = groups.filter((x) => `${x.title} ${x.description} ${x.ruleId}`.toLowerCase().includes(t));
  }
  for (const g of groups) g.templateLevel = isTemplateLevel(scanId, g.ruleId, g.severity === 'warning' ? g.pageCount : g.confirmedPageCount, htmlPages, g.severity !== 'warning');
  return groups.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.pageCount - a.pageCount || a.title.localeCompare(b.title));
}

/**
 * Template-level issue: the same markup fails on most pages, so it lives in a shared theme section/snippet
 * (header, footer, product card) and is fixed once — a key Shopify insight for effort estimates.
 */
function isTemplateLevel(scanId: number, ruleId: string, pageCount: number, htmlPages: number, failingOnly: boolean): boolean {
  if (pageCount < 3 || pageCount / htmlPages < 0.6) return false;
  // Only failing findings count for failing rules: "needs review" rows do not make an issue theme-level.
  const top = q.get<{ pages: number }>(
    `SELECT COUNT(DISTINCT page_id) AS pages FROM issues WHERE scan_id = ? AND rule_id = ? AND snippet IS NOT NULL${failingOnly ? " AND severity != 'warning'" : ''} GROUP BY substr(snippet, 1, 160) ORDER BY pages DESC LIMIT 1`,
    [scanId, ruleId],
  );
  return (top?.pages ?? 0) / pageCount >= 0.6;
}

export function issueOccurrences(scanId: number, ruleId: string, options: ScanOptions, page = 1): { pages: IssueOccurrencePage[]; totalPages: number } {
  const maxPages = options.reports.maxPagesPerIssue;
  const maxLines = options.reports.maxLinesPerIssue;
  const totalPages = Number(q.value('SELECT COUNT(DISTINCT page_id) FROM issues WHERE scan_id = ? AND rule_id = ?', [scanId, ruleId]));
  const pageRows = q.all<{ page_id: number; url: string; n: number }>(
    `SELECT i.page_id, p.url, COUNT(*) AS n FROM issues i JOIN scan_pages p ON p.id = i.page_id
      WHERE i.scan_id = ? AND i.rule_id = ? GROUP BY i.page_id ORDER BY p.depth, p.url LIMIT ? OFFSET ?`,
    [scanId, ruleId, Math.min(maxPages, 50), (page - 1) * Math.min(maxPages, 50)],
  );
  const pages = pageRows
    .filter((_, i) => (page - 1) * 50 + i < maxPages)
    .map((p) => ({
      pageId: p.page_id,
      url: p.url,
      total: p.n,
      lines: q
        .all<{ line: number | null; snippet: string | null; selector: string | null; detail: string | null }>('SELECT line, snippet, selector, detail FROM issues WHERE page_id = ? AND rule_id = ? ORDER BY line LIMIT ?', [p.page_id, ruleId, maxLines])
        .map((l) => ({ line: l.line, snippet: l.snippet ?? l.detail ?? '', selector: l.selector, detail: l.detail })),
    }));
  return { pages, totalPages: Math.min(totalPages, maxPages) };
}

export interface PageListRow { pageId: number; url: string; title: string | null; status: number | null; depth: number; contentType: string | null; priority: number; other: number; warning: number; total: number }

export function pagesWithIssues(scanId: number, opts: { text?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; perPage?: number; onlyIssues?: boolean } = {}) {
  const params: (string | number)[] = [scanId];
  let where = 'p.scan_id = ?';
  if (opts.onlyIssues !== false) where += ' AND (p.priority_count + p.other_count + p.warning_count) > 0';
  if (opts.text) {
    where += ' AND (lower(p.url) LIKE ? OR lower(COALESCE(p.title, \'\')) LIKE ?)';
    params.push(`%${opts.text.toLowerCase()}%`, `%${opts.text.toLowerCase()}%`);
  }
  // Each sort does exactly what its column says; ties fall back to severity, then URL.
  const order =
    {
      issues: '(p.priority_count + p.other_count + p.warning_count)',
      url: 'p.url',
      depth: 'p.depth',
      priority: 'p.priority_count',
    }[opts.sort ?? 'issues'] ?? '(p.priority_count + p.other_count + p.warning_count)';
  const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const perPage = Math.min(200, opts.perPage ?? 50);
  const page = Math.max(1, opts.page ?? 1);
  const total = Number(q.value(`SELECT COUNT(*) FROM scan_pages p WHERE ${where}`, params));
  const rows = q.all<{ id: number; url: string; title: string | null; status: number | null; depth: number; content_type: string | null; priority_count: number; other_count: number; warning_count: number }>(
    `SELECT p.* FROM scan_pages p WHERE ${where} ORDER BY ${order} ${dir}, p.priority_count DESC, p.url LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  const items: PageListRow[] = rows.map((r) => ({
    pageId: r.id,
    url: r.url,
    title: r.title,
    status: r.status,
    depth: r.depth,
    contentType: r.content_type,
    priority: r.priority_count,
    other: r.other_count,
    warning: r.warning_count,
    total: r.priority_count + r.other_count + r.warning_count,
  }));
  return { items, total, page, perPage };
}

export function pageIssues(scanId: number, pageId: number) {
  const page = q.get<{ id: number; url: string; final_url: string | null; title: string | null; status: number | null; depth: number; bytes: number; load_ms: number | null; word_count: number | null; content_type: string | null }>('SELECT * FROM scan_pages WHERE id = ? AND scan_id = ?', [pageId, scanId]);
  if (!page) return null;
  const rows = q.all<{ rule_id: string; severity: Severity; line: number | null; snippet: string | null; selector: string | null; detail: string | null }>('SELECT rule_id, severity, line, snippet, selector, detail FROM issues WHERE page_id = ? ORDER BY line', [pageId]);
  const byRule = new Map<string, { ruleId: string; title: string; severity: Severity; category: Category; guidelines: { label: string; url: string | null }[]; description: string; fix: string; occurrences: { line: number | null; snippet: string | null; selector: string | null; detail: string | null }[] }>();
  for (const r of rows) {
    const rule = getRule(r.rule_id);
    if (!rule) continue;
    const g = byRule.get(r.rule_id) ?? { ruleId: r.rule_id, title: rule.title, severity: r.severity, category: rule.category, guidelines: rule.guidelines, description: rule.description, fix: rule.fix, occurrences: [] };
    if (SEVERITY_RANK[r.severity] < SEVERITY_RANK[g.severity]) g.severity = r.severity;
    g.occurrences.push({ line: r.line, snippet: r.snippet, selector: r.selector, detail: r.detail });
    byRule.set(r.rule_id, g);
  }
  return {
    page: { id: page.id, url: page.url, finalUrl: page.final_url, title: page.title, status: page.status, depth: page.depth, bytes: page.bytes, loadMs: page.load_ms, words: page.word_count, contentType: page.content_type },
    issues: [...byRule.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.title.localeCompare(b.title)),
  };
}

const INVENTORY_LAYOUT: { kind: 'document' | 'image' | 'misc'; label: string; types: { subtype: string; description: string }[] }[] = [
  { kind: 'document', label: 'Documents', types: [{ subtype: 'HTML', description: 'Web pages' }, { subtype: 'PDF', description: 'PDF documents' }, { subtype: 'Other', description: 'Office documents, text files and archives' }] },
  { kind: 'image', label: 'Images', types: [{ subtype: 'GIF', description: 'GIF images' }, { subtype: 'PNG', description: 'PNG images' }, { subtype: 'JPEG', description: 'JPEG photos' }, { subtype: 'SVG', description: 'SVG vector images' }, { subtype: 'Other', description: 'WebP, AVIF, ICO and other images' }] },
  { kind: 'misc', label: 'Misc', types: [{ subtype: 'CSS', description: 'Stylesheets' }, { subtype: 'JavaScript', description: 'Scripts' }, { subtype: 'Font', description: 'Web fonts' }, { subtype: 'Media', description: 'Audio and video' }] },
];

export function inventory(scanId: number) {
  const counts = q.all<{ kind: string; subtype: string; n: number; internal: number; broken: number; bytes: number }>(
    `SELECT r.kind, r.subtype, COUNT(*) AS n, SUM(r.internal) AS internal, SUM(CASE WHEN ${BROKEN_SQL} THEN 1 ELSE 0 END) AS broken, COALESCE(SUM(r.bytes),0) AS bytes FROM scan_resources r WHERE r.scan_id = ? GROUP BY r.kind, r.subtype`,
    [scanId],
  );
  return INVENTORY_LAYOUT.map((g) => ({
    kind: g.kind,
    label: g.label,
    rows: g.types.map((t) => {
      const c = counts.find((x) => x.kind === g.kind && x.subtype === t.subtype);
      return { subtype: t.subtype, description: t.description, count: c?.n ?? 0, internal: c?.internal ?? 0, broken: c?.broken ?? 0, bytes: c?.bytes ?? 0 };
    }),
  }));
}

export function inventoryFiles(scanId: number, kind: string, subtype: string, limit = 500) {
  return q.all<{ url: string; status: number | null; bytes: number | null; internal: number; error: string | null }>('SELECT url, status, bytes, internal, error FROM scan_resources WHERE scan_id = ? AND kind = ? AND subtype = ? ORDER BY internal DESC, url LIMIT ?', [scanId, kind, subtype, limit]);
}

const DIAGNOSTIC_LABELS: Record<string, string> = {
  'server-info': 'Server information',
  'cache-static': 'CSS and JavaScript caching configuration',
  'cache-html': 'HTML caching configuration',
  'robots-blocked': 'Links blocked by robots.txt',
  'scanner-blocked': 'Links blocked by the scanner (scan options)',
  'link-counts': 'Link counts',
  'rate-limited': 'Rate limiting',
  'unexpected-status': 'Unexpected status codes (redirects)',
  'broken-link': 'Broken links',
  'forbidden-403': '403 Forbidden responses',
  'unverified-link': 'Links that could not be verified (rate limits, bot protection, timeouts)',
  'page-limit': 'Page limit reached',
  'no-chrome': 'Browser rendering unavailable',
  'render-failed': 'Pages that could not be rendered',
  shopify: 'Shopify storefront detected',
  'shopify-checkout': 'Shopify checkout coverage',
  'shopify-password': 'Shopify storefront password',
  'shopify-password-page': 'Shopify password page',
  'spelling-brand-words': 'Spelling: words treated as brand names',
  resumed: 'Scan resumed',
};

export function diagnostics(scanId: number) {
  const rows = q.all<{ code: string; message: string; url: string | null; detail: string | null }>('SELECT code, message, url, detail FROM diagnostics WHERE scan_id = ? ORDER BY id', [scanId]);
  const groups = new Map<string, { code: string; label: string; message: string; count: number; urls: string[] }>();
  for (const r of rows) {
    const g = groups.get(r.code) ?? { code: r.code, label: DIAGNOSTIC_LABELS[r.code] ?? r.code, message: r.message, count: 0, urls: [] };
    g.count++;
    if (r.url && g.urls.length < 300) g.urls.push(r.url);
    groups.set(r.code, g);
  }
  return [...groups.values()];
}

export function siteMapData(scanId: number) {
  return q.all<{ id: number; url: string; title: string | null; depth: number; parent_url: string | null; priority_count: number; other_count: number; warning_count: number; status: number | null }>(
    "SELECT id, url, title, depth, parent_url, priority_count, other_count, warning_count, status FROM scan_pages WHERE scan_id = ? AND content_type LIKE 'text/html%' ORDER BY depth, url",
    [scanId],
  ).map((p) => ({ id: p.id, url: p.url, title: p.title, depth: p.depth, parent: p.parent_url, priority: p.priority_count, other: p.other_count, warning: p.warning_count, status: p.status }));
}

/** "What was Tested" — guideline status table and scan options table (Plan.md §2.5, §5.7). */
export function whatWasTested(o: ScanOptions) {
  const a = o.rules.accessibility;
  const on = a.enabled;
  const ver = Number(a.wcagVersion);
  const status = (checked: boolean, note = '') => ({ checked, note });
  const guidelines = [
    { name: 'WAI-ARIA 1.3', ...status(on && a.aria) },
    { name: 'JAWS / NVDA / VoiceOver compatibility', ...status(on && a.screenReaders) },
    { name: 'Scan problems (diagnostics)', ...status(true) },
    { name: 'EN 301 549', ...status(on && a.euStandards) },
    { name: 'PDF/UA-1', ...status(on && a.pdfStandards) },
    { name: 'Section 508', ...status(on && a.usStandards) },
    { name: 'WCAG 2.0', ...status(on, on ? `Level ${a.wcagLevel}` : '') },
    { name: 'WCAG 2.1', ...status(on && ver >= 2.1, on && ver >= 2.1 ? `Level ${a.wcagLevel}` : '') },
    { name: 'WCAG 2.2', ...status(on && ver >= 2.2, on && ver >= 2.2 ? `Level ${a.wcagLevel}` : '') },
    { name: `Reading age (${READING_AGE_LABELS[a.readingAge]})`, ...status(on) },
    { name: `Browser compatibility (${o.rules.compatibility.browsers.map((b) => BROWSER_LABELS[b]).join(', ')})`, ...status(o.rules.compatibility.enabled) },
    { name: 'Broken links and errors', ...status(o.rules.errors.enabled) },
    { name: `Spell check (${SPELL_LANGUAGE_LABELS[o.rules.errors.spellLanguage]})`, ...status(o.rules.errors.enabled && o.rules.errors.spellCheck) },
    { name: `Search engine guidelines (${o.rules.search.engines.join(', ') || 'none'})`, ...status(o.rules.search.enabled) },
    { name: 'HTML validation', ...status(o.rules.standards.enabled && o.rules.standards.validateHtml) },
    { name: 'CSS validation', ...status(o.rules.standards.enabled && o.rules.standards.validateCss) },
    { name: 'Usability best practices', ...status(o.rules.usability.enabled && o.rules.usability.bestPractices) },
    { name: 'Readability', ...status(o.rules.usability.enabled && o.rules.usability.readability) },
  ];
  const throttleLabel = { auto: 'Auto', slow: 'Slow', normal: 'Normal', fast: 'Fast' }[o.crawler.throttle];
  const scanOptions = [
    ['JavaScript DOM changes', { none: 'None', smart: 'Smart', all: 'All' }[o.reports.domMode]],
    ['Obey robots.txt', o.blocks.obeyRobots ? 'On' : 'Off'],
    ['Blocked links', o.blocks.patterns.trim() ? o.blocks.patterns.trim().split(/\r?\n/).join(', ') : 'None specified'],
    ['Legacy DOCTYPEs', o.rules.standards.legacyDoctype === 'legacy' ? 'Use legacy parser' : 'Validate as HTML5'],
    ['HTTP authorisation headers', o.crawler.authMode === 'none' ? 'Off' : { basic: 'HTTP Basic', headers: 'Custom headers', 'shopify-web-bot-auth': 'Shopify Web Bot Auth', cookies: 'Cookies', none: 'Off' }[o.crawler.authMode]],
    ['Max pages shown per issue', String(o.reports.maxPagesPerIssue)],
    ['Max lines shown per issue', String(o.reports.maxLinesPerIssue)],
    ['Server load throttle', throttleLabel],
    ['Page timeout', `${o.crawler.pageTimeoutMs} ms`],
    ['Link depth', o.links.depthMode === 'entire' ? 'Explore entire site' : `Only ${o.links.maxDepth} clicks from start page`],
    ['External links', o.links.externalMode === 'all' ? 'Check all' : `Check first ${o.links.externalFirstN} per external site`],
    ['Include related domains', o.links.followRelatedDomains ? 'On' : 'Off'],
    ['Include additional domains', o.links.additionalDomains.trim() || 'None specified'],
    ['Page limit', `${o.crawler.maxPages} pages`],
    ['Shopify preset', o.crawler.shopifyPreset ? 'On (when Shopify is detected)' : 'Off'],
  ] as [string, string][];
  return { guidelines, scanOptions };
}

// ── Prioritized fix plan with effort (Plan.md §15) ─────────────────────────────
const SEVERITY_WEIGHT: Record<Severity, number> = { priority: 10, other: 3, warning: 1 };

export function fixPlan(scanId: number) {
  const groups = issueGroups(scanId).filter((g) => g.severity !== 'warning' || g.category === 'accessibility');
  const pages = Math.max(1, Number(q.value('SELECT COUNT(*) FROM scan_pages WHERE scan_id = ?', [scanId])));
  const items = groups.map((g) => {
    const rule = getRule(g.ruleId)!;
    const reach = g.pageCount / pages;
    const impact = Math.round(SEVERITY_WEIGHT[g.severity] * (0.3 + reach) * (g.category === 'accessibility' ? 1.5 : 1) * 10) / 10;
    // Template issues are fixed once in the theme; per-page issues scale (with diminishing returns for batched edits).
    const effortMinutes = g.templateLevel ? Math.round(rule.effortMinutes * 2) : Math.round(rule.effortMinutes * Math.min(g.occurrenceCount, 5 + Math.sqrt(Math.max(0, g.occurrenceCount - 5)) * 3));
    const score = impact / Math.max(5, effortMinutes);
    return { ...g, impact, effortMinutes, score, bucket: '' as 'quick-win' | 'major' | 'fill-in' | 'later' };
  });
  const medianEffort = [...items].sort((a, b) => a.effortMinutes - b.effortMinutes)[Math.floor(items.length / 2)]?.effortMinutes ?? 30;
  const medianImpact = [...items].sort((a, b) => a.impact - b.impact)[Math.floor(items.length / 2)]?.impact ?? 5;
  for (const it of items) {
    const highImpact = it.impact >= medianImpact;
    const lowEffort = it.effortMinutes <= medianEffort;
    it.bucket = highImpact && lowEffort ? 'quick-win' : highImpact ? 'major' : lowEffort ? 'fill-in' : 'later';
  }
  items.sort((a, b) => b.score - a.score);
  const totalMinutes = items.reduce((s, i) => s + i.effortMinutes, 0);
  return { items, totalMinutes };
}

// ── Before/after comparison (Plan.md §15) ──────────────────────────────────────
export function compareScans(a: ScanRecord, b: ScanRecord) {
  const ruleCounts = (scanId: number) =>
    new Map(q.all<{ rule_id: string; pages: number; occ: number }>('SELECT rule_id, COUNT(DISTINCT page_id) AS pages, COUNT(*) AS occ FROM issues WHERE scan_id = ? GROUP BY rule_id', [scanId]).map((r) => [r.rule_id, r]));
  const ra = ruleCounts(a.id);
  const rb = ruleCounts(b.id);
  const describe = (id: string) => {
    const r = getRule(id);
    return { ruleId: id, title: r?.title ?? id, category: r?.category ?? 'errors', severity: r?.severity ?? 'other' };
  };
  const fixed = [...ra.keys()].filter((k) => !rb.has(k)).map((k) => ({ ...describe(k), pagesBefore: ra.get(k)!.pages, pagesAfter: 0 }));
  const introduced = [...rb.keys()].filter((k) => !ra.has(k)).map((k) => ({ ...describe(k), pagesBefore: 0, pagesAfter: rb.get(k)!.pages }));
  const changed = [...rb.keys()].filter((k) => ra.has(k)).map((k) => ({ ...describe(k), pagesBefore: ra.get(k)!.pages, pagesAfter: rb.get(k)!.pages })).sort((x, y) => x.pagesAfter - x.pagesBefore - (y.pagesAfter - y.pagesBefore));
  const sa = statsFor(a);
  const sb = statsFor(b);
  return {
    a: { id: a.id, date: a.finished_at ?? a.started_at, issuePct: a.issue_pct, priorityPct: a.priority_pct, score: a.compliance_score, pages: a.pages_checked },
    b: { id: b.id, date: b.finished_at ?? b.started_at, issuePct: b.issue_pct, priorityPct: b.priority_pct, score: b.compliance_score, pages: b.pages_checked },
    categories: sb.categories.map((cb) => {
      const ca = sa.categories.find((x) => x.category === cb.category);
      return { category: cb.category, label: CATEGORY_LABELS[cb.category], before: ca?.issuePct ?? 0, after: cb.issuePct, issuesBefore: ca?.issueCount ?? 0, issuesAfter: cb.issueCount };
    }),
    fixed,
    introduced,
    changed,
  };
}

// ── Accessibility statement helper (Plan.md §15) ───────────────────────────────
export function statementData(scan: ScanRecord, site: SiteRecord) {
  const o = openOptions(scan.options_json);
  const stats = statsFor(scan);
  const a11y = stats.categories.find((c) => c.category === 'accessibility');
  const topIssues = issueGroups(scan.id, { category: 'accessibility' })
    .filter((g) => g.severity !== 'warning')
    .slice(0, 8)
    .map((g) => ({ title: g.title, guidelines: g.guidelines.filter((x) => x.label.startsWith('WCAG')).map((x) => x.label), pages: g.pageCount }));
  return {
    siteUrl: site.url,
    scanDate: scan.finished_at ?? scan.started_at,
    standard: `WCAG ${o.rules.accessibility.wcagVersion} Level ${o.rules.accessibility.wcagLevel}`,
    score: stats.complianceScore,
    grade: scoreGrade(stats.complianceScore),
    pagesChecked: stats.pagesChecked,
    a11yIssuePct: a11y?.issuePct ?? 0,
    knownLimitations: topIssues,
    scope: SCOPE_LABELS[scan.scope],
  };
}
