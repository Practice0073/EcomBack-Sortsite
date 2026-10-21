import { q } from '../db/index.js';
import type { ScanRecord, SiteRecord } from '../lib/access.js';
import { openOptions } from '../lib/options.js';
import { scoreGrade } from '../engine/stats.js';
import { SCOPE_LABELS, type ScanOptions } from '../../shared/options.js';
import type { IssueGroup, IssueOccurrencePage, ReportSummary } from '../../shared/types.js';
import { clientBrand, type ClientBrand } from './branding.js';
import { diagnostics, fixPlan, inventory, issueGroups, issueOccurrences, pagesWithIssues, reportSummary, whatWasTested, type PageListRow } from './data.js';

export type ReportType = 'full' | 'summary' | 'executive' | 'issues-only';
export const REPORT_TYPES: readonly ReportType[] = ['full', 'summary', 'executive', 'issues-only'];
export const REPORT_TYPE_LABELS: Record<ReportType, string> = { full: 'Full Report', summary: 'Summary Report', executive: 'Executive Report', 'issues-only': 'Issues Report' };

type FixPlan = ReturnType<typeof fixPlan>;

/** Everything any export format needs, loaded once. Sections are filled according to the report type. */
export interface ReportModel {
  type: ReportType;
  scan: ScanRecord;
  site: SiteRecord;
  options: ScanOptions;
  client: ClientBrand | null;
  summary: ReportSummary;
  grade: string;
  scopeLabel: string;
  scanDate: string | null;
  fixPlan: FixPlan;
  tested: ReturnType<typeof whatWasTested> | null;
  groups: IssueGroup[];
  occurrences: Map<string, { pages: IssueOccurrencePage[]; totalPages: number }>;
  pages: PageListRow[];
  inventory: ReturnType<typeof inventory> | null;
  diagnostics: ReturnType<typeof diagnostics> | null;
}

export function loadScan(scanId: number): { scan: ScanRecord; site: SiteRecord } {
  const scan = q.get<ScanRecord>('SELECT * FROM scans WHERE id = ?', [scanId]);
  if (!scan) throw new Error(`Scan ${scanId} not found`);
  const site = q.get<SiteRecord>('SELECT * FROM sites WHERE id = ?', [scan.site_id]);
  if (!site) throw new Error(`Site for scan ${scanId} not found`);
  return { scan, site };
}

/** All occurrences for every issue group, capped by the scan's report options (pages per issue, lines per issue). */
export function allOccurrences(scanId: number, groups: IssueGroup[], options: ScanOptions) {
  const map = new Map<string, { pages: IssueOccurrencePage[]; totalPages: number }>();
  for (const g of groups) {
    const pages: IssueOccurrencePage[] = [];
    let totalPages = 0;
    for (let page = 1; pages.length < options.reports.maxPagesPerIssue; page++) {
      const chunk = issueOccurrences(scanId, g.ruleId, options, page);
      totalPages = chunk.totalPages;
      pages.push(...chunk.pages);
      if (chunk.pages.length < 50) break;
    }
    map.set(g.ruleId, { pages: pages.slice(0, options.reports.maxPagesPerIssue), totalPages });
  }
  return map;
}

export function allPages(scanId: number): PageListRow[] {
  const out: PageListRow[] = [];
  for (let page = 1; page < 100; page++) {
    const chunk = pagesWithIssues(scanId, { page, perPage: 200, sort: 'issues', dir: 'desc' });
    out.push(...chunk.items);
    if (out.length >= chunk.total || chunk.items.length === 0) break;
  }
  return out;
}

export function buildModel(scanId: number, type: ReportType): ReportModel {
  const { scan, site } = loadScan(scanId);
  const options = openOptions(scan.options_json);
  const summary = reportSummary(scan, site);
  const wantsGroups = type !== 'executive';
  const wantsOccurrences = type === 'issues-only' || type === 'full';
  const groups = wantsGroups ? issueGroups(scan.id) : [];
  return {
    type,
    scan,
    site,
    options,
    client: clientBrand(site.client_id),
    summary,
    grade: scoreGrade(summary.complianceScore),
    scopeLabel: SCOPE_LABELS[scan.scope],
    scanDate: scan.finished_at ?? scan.started_at ?? scan.queued_at,
    fixPlan: fixPlan(scan.id),
    tested: type === 'summary' || type === 'full' ? whatWasTested(options) : null,
    groups,
    occurrences: wantsOccurrences ? allOccurrences(scan.id, groups, options) : new Map(),
    pages: type === 'full' ? allPages(scan.id) : [],
    inventory: type === 'full' ? inventory(scan.id) : null,
    diagnostics: type === 'full' ? diagnostics(scan.id) : null,
  };
}

export function narrative(m: ReportModel): string {
  const s = m.summary;
  const a11y = s.categories.find((c) => c.category === 'accessibility');
  const worst = s.categories.filter((c) => c.enabled).sort((a, b) => b.issuePct - a.issuePct)[0];
  const quick = m.fixPlan.items.filter((i) => i.bucket === 'quick-win').length;
  const template = m.fixPlan.items.filter((i) => i.templateLevel).length;
  const parts = [
    `We checked ${s.pagesChecked} pages and files on ${m.site.url} with ${s.rulesChecked} rules. ${s.pagesWithIssues} of them (${s.scan.issuePct}%) have at least one quality issue, which is ${s.benchmark.label === 'average' ? 'about average' : `${s.benchmark.label} than average`} (benchmark ${s.benchmark.value}%).`,
    a11y?.enabled ? `The ADA / WCAG compliance score is ${s.complianceScore} out of 100 (grade ${m.grade}); ${a11y.issuePct}% of pages have accessibility issues.` : '',
    worst && worst.issuePct > 0 ? `The category needing most attention is ${worst.category} (${worst.issuePct}% of pages).` : '',
    quick ? `The fix plan lists ${quick} quick win${quick === 1 ? '' : 's'} — high impact for little effort.` : '',
    template ? `${template} issue${template === 1 ? ' is' : 's are'} template-level: fixing the shared theme section once resolves ${template === 1 ? 'it' : 'them'} across the whole site.` : '',
    'Automated testing finds only part of accessibility problems; confirm results with keyboard and screen reader testing.',
  ];
  return parts.filter(Boolean).join(' ');
}
