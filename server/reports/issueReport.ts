/**
 * "Issue Report" layout model shared by the Word, PDF and HTML exports. The structure follows the
 * report format the owner supplied (PowerMapperReport.docx): title, one-line intro, summary table,
 * then per category → per level → per issue (icon, title, description, guideline links) → per page
 * (condensed code snippet with the offending attribute marked, line number, page link).
 */
import { q } from '../db/index.js';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../../shared/options.js';
import type { GuidelineRef, IssueGroup, Severity } from '../../shared/types.js';
import type { ReportModel, ReportType } from './model.js';

// ── Text with inline code ──────────────────────────────────────────────────────
export type Segment = { text: string; code?: boolean; marked?: boolean };

/** Tokens rendered as code: HTML tags, aria-/role/tabindex attributes, attr="value" pairs. */
const CODE_TOKEN = /(<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>|\baria-[a-z]+(?:=(?:"[^"]*"|'[^']*'|[\w-]+))?|\brole=(?:"[^"]*"|'[^']*'|[\w-]+)|\btabindex=-?\d+|\b[a-z-]+="[^"]*")/gi;

export function codeSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE_TOKEN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], code: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

// ── Snippet condensing ─────────────────────────────────────────────────────────
/** Attribute(s) that explain why a rule fired, so the snippet can mark them (matched against rule ids). */
const MARK_BY_RULE: [RegExp, RegExp][] = [
  [/sr-title-only/, /^title$/],
  [/sr-aria-label-generic|aria-prohibited-attr/, /^(aria-label|aria-labelledby)$/],
  [/sr-role-application/, /^role$/],
  [/sr-alt-filename|image-alt|input-image-alt|image-redundant-alt/, /^alt$/],
  [/aria-hidden/, /^aria-hidden$/],
  [/aria-allowed-attr|aria-valid-attr|aria-required-attr|aria-deprecated|aria-conditional/, /^aria-[a-z]+$/],
  [/aria-allowed-role|aria-roles|aria-required-children|aria-required-parent|presentation-role|landmark/, /^role$/],
  [/tabindex/, /^tabindex$/],
  [/html-has-lang|html-lang|valid-lang|lang-missing/, /^(lang|xml:lang)$/],
  [/autocomplete/, /^autocomplete$/],
  [/new-window/, /^target$/],
  [/broken-link|broken-anchor|mixed-content/, /^(href|src)$/],
  [/broken-resource/, /^(src|href|srcset|data)$/],
  [/image-dimensions/, /^(width|height|src)$/],
  [/duplicate-id|dup-id|valid-id/, /^id$/],
  [/meta-refresh/, /^(http-equiv|content)$/],
];

const SHORT = 22;

/** Cut a long value at a natural boundary (- _ / . space) so it reads "csm-smart-banner-..." not "csm-smart-banner-prefe...". */
function cut(value: string): string {
  if (value.length <= SHORT) return value;
  const head = value.slice(0, SHORT);
  // Prefer word separators inside identifiers (- _), then path/sentence boundaries.
  const hyphen = Math.max(head.lastIndexOf('-'), head.lastIndexOf('_'));
  const other = Math.max(head.lastIndexOf('/'), head.lastIndexOf('.'), head.lastIndexOf(' '));
  const at = hyphen >= 8 ? hyphen : other >= 8 ? other : -1;
  return `${at >= 0 ? head.slice(0, at + 1).trimEnd() : head}...`;
}

function shortenValue(name: string, value: string): string {
  if (name === 'class') {
    const classes = value.trim().split(/\s+/);
    return `${cut(classes[0] ?? '')}${classes.length > 1 ? ' ...' : ''}`;
  }
  return cut(value);
}

function shortenText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= 28) return t;
  const words = t.split(' ');
  return words.length > 2 ? `${words[0]} ... ${words[words.length - 1]}` : `${t.slice(0, 26)}...`;
}

/**
 * Condense an element's HTML for print: long attribute values and inner content are abbreviated,
 * attributes are single-quoted, and the attribute that triggered the rule is marked.
 */
export function condenseSnippet(snippet: string, ruleId: string): Segment[] {
  const html = snippet.replace(/\s+/g, ' ').trim();
  const open = /^<([a-z][a-z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/i.exec(html);
  if (!open) return [{ text: html.length > 160 ? `${html.slice(0, 157)}...` : html, code: true }];
  const tag = open[1]!.toLowerCase();
  const markRe = MARK_BY_RULE.find(([rule]) => rule.test(ruleId))?.[1] ?? null;
  const segs: Segment[] = [{ text: `<${tag}`, code: true }];
  const attrRe = /([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const a of open[2]!.matchAll(attrRe)) {
    const name = a[1]!;
    const value = a[3] ?? a[4] ?? a[5];
    const text = value === undefined ? name : `${name}='${shortenValue(name.toLowerCase(), value)}'`;
    segs.push({ text: ' ', code: true });
    segs.push(markRe?.test(name.toLowerCase()) ? { text, code: true, marked: true } : { text, code: true });
  }
  const rest = html.slice(open[0].length);
  const selfClosing = open[3] === '/' || /^(img|input|br|hr|meta|link|source|area|col|embed|param|track|wbr)$/.test(tag);
  if (selfClosing) {
    segs.push({ text: '>', code: true });
  } else {
    const closed = new RegExp(`</${tag}>\\s*$`, 'i').test(rest);
    const inner = rest.replace(new RegExp(`</${tag}>\\s*$`, 'i'), '');
    const innerText = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasChildren = /<[a-z]/i.test(inner);
    // A snippet cut short (no closing tag) has unknown content: never claim the element is empty.
    const content = !closed ? '...' : !inner.trim() ? '' : !hasChildren && innerText ? shortenText(innerText) : '...';
    segs.push({ text: `>${content}</${tag}>`, code: true });
  }
  // Merge adjacent code runs with the same marking (fewer runs = cleaner Word XML).
  const merged: Segment[] = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.code === s.code && !!prev.marked === !!s.marked) prev.text += s.text;
    else merged.push({ ...s });
  }
  return merged;
}

// ── Report structure ───────────────────────────────────────────────────────────
export interface OccurrenceLine { segments: Segment[]; line: number | null; detail: string | null }
export interface OccurrencePage { url: string; lines: OccurrenceLine[]; more: number }
export interface IssueEntry {
  ruleId: string;
  severity: Severity;
  title: Segment[];
  description: Segment[];
  fix: string;
  guidelines: GuidelineRef[];
  pageCount: number;
  /** Further pages where the rule only needs manual review (not counted as failing). */
  reviewPages: number;
  templateLevel: boolean;
  pages: OccurrencePage[];
  morePages: number;
}
export interface SectionEntry { name: string; issues: IssueEntry[]; pageCount: number }
export interface CategoryEntry { category: Category; label: string; intro: string; sections: SectionEntry[] }
export interface SummaryRow { label: string; pct: number; text: string }
export interface IssueReport {
  title: string;
  intro: string;
  url: string;
  date: string;
  summary: SummaryRow[];
  totalUrls: number;
  categories: CategoryEntry[];
  showOccurrences: boolean;
  showIssues: boolean;
  topFixes: { title: string; severity: Severity; pages: number; effort: string; templateLevel: boolean }[];
}

export const CATEGORY_INTRO: Record<Category, string> = {
  accessibility:
    'This section shows accessibility issues, indicating problems for older users, people with disabilities or accessibility needs. Automated testing cannot detect all accessibility issues, so should be used alongside human testing.',
  compatibility: 'This section shows browser compatibility issues: HTML and CSS features that are missing or only partly supported in the browsers selected for this scan.',
  errors: 'This section shows broken links, missing files, server and configuration errors, spelling mistakes and content rule failures.',
  search: 'This section shows search engine issues based on Google, Bing and DuckDuckGo guidelines, robots.txt rules and search best practices.',
  standards: 'This section shows web standards issues: HTML and CSS that does not follow the W3C and WHATWG specifications, and obsolete features.',
  usability: 'This section shows usability issues based on established best practices and readability guidelines.',
};

const SUMMARY_WORDING: Record<Category, string> = {
  accessibility: 'accessibility problems',
  compatibility: 'browser compatibility problems',
  errors: 'errors',
  search: 'search engine issues',
  standards: 'standards problems',
  usability: 'usability problems',
};

const SECTION_ORDER: Record<Category, string[]> = {
  accessibility: ['Level A', 'Level AA', 'Level AAA', 'ARIA', 'Screen readers', 'PDF/UA', 'Reading age', 'Warnings'],
  compatibility: ['Chrome', 'Edge', 'Firefox', 'Opera', 'Safari macOS', 'Android', 'iPhone / iPad'],
  errors: ['Broken links', 'Server and configuration', 'Content', 'Content rules', 'Spelling', 'Page weight'],
  search: ['Google', 'Bing', 'DuckDuckGo', 'robots.txt', 'Keywords', 'Best practices'],
  standards: ['HTML validation', 'CSS validation', 'Obsolete features', 'DOCTYPE'],
  usability: ['Best practices', 'Readability'],
};

const SEVERITY_RANK: Record<Severity, number> = { priority: 0, other: 1, warning: 2 };

export const REPORT_TITLES: Record<ReportType, string> = { full: 'Issue Report', 'issues-only': 'Issue Report', summary: 'Summary Report', executive: 'Executive Summary' };

const longDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function buildIssueReport(m: ReportModel): IssueReport {
  const s = m.summary;
  const enabled = s.categories.filter((c) => c.enabled);
  const summary: SummaryRow[] = [
    { label: 'Overall Quality', pct: s.scan.issuePct, text: `${s.pagesWithIssues.toLocaleString()} ${s.pagesWithIssues === 1 ? 'page' : 'pages'} with quality issues` },
    ...enabled.map((c) => ({ label: CATEGORY_LABELS[c.category], pct: c.issuePct, text: `${c.pagesWithIssues.toLocaleString()} ${c.pagesWithIssues === 1 ? 'page' : 'pages'} with ${SUMMARY_WORDING[c.category]}` })),
  ];

  const showIssues = m.type !== 'executive';
  const showOccurrences = m.type === 'full' || m.type === 'issues-only';
  const maxLines = m.options.reports.maxLinesPerIssue;

  const categories: CategoryEntry[] = [];
  if (showIssues) {
    for (const category of CATEGORIES) {
      const groups = m.groups.filter((g) => g.category === category);
      if (!groups.length) continue;
      const bySection = new Map<string, IssueGroup[]>();
      for (const g of groups) bySection.set(g.section, [...(bySection.get(g.section) ?? []), g]);
      const order = [...SECTION_ORDER[category], ...[...bySection.keys()].filter((k) => !SECTION_ORDER[category].includes(k))];
      const sections: SectionEntry[] = [];
      for (const name of order) {
        const list = bySection.get(name);
        if (!list?.length) continue;
        list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.pageCount - a.pageCount || a.title.localeCompare(b.title));
        const issues = list.map((g): IssueEntry => {
          const occ = m.occurrences.get(g.ruleId);
          const seenDetails = new Set<string>();
          return {
            ruleId: g.ruleId,
            severity: g.severity,
            title: codeSegments(g.title.replace(/\.?$/, '.')),
            description: codeSegments(g.description),
            fix: g.fix,
            guidelines: g.guidelines,
            pageCount: g.severity === 'warning' ? g.pageCount : g.confirmedPageCount,
            reviewPages: g.severity === 'warning' ? 0 : g.pageCount - g.confirmedPageCount,
            templateLevel: g.templateLevel,
            pages: showOccurrences
              ? (occ?.pages ?? []).map((p) => dedupeDetails({
                  url: p.url,
                  lines: p.lines.slice(0, maxLines).map((l) => ({
                    segments: l.snippet && l.snippet.trim().startsWith('<') ? condenseSnippet(l.snippet, g.ruleId) : l.snippet ? [{ text: l.snippet.replace(/\s+/g, ' ').slice(0, 220) }] : [],
                    line: l.line,
                    detail: l.detail && l.detail !== l.snippet ? l.detail.replace(/\s+/g, ' ').slice(0, 300) : null,
                  })),
                  more: Math.max(0, p.total - Math.min(p.lines.length, maxLines)),
                }, seenDetails))
              : [],
            morePages: showOccurrences ? Math.max(0, g.pageCount - (occ?.pages.length ?? 0)) : 0,
          };
        });
        // Exact distinct pages across every rule in the section ("13 issues on 168 pages").
        const ids = list.map((g) => g.ruleId);
        const failing = list.some((g) => g.severity !== 'warning');
        const pageCount = Number(q.value(`SELECT COUNT(DISTINCT page_id) FROM issues WHERE scan_id = ? AND rule_id IN (${ids.map(() => '?').join(',')})${failing ? " AND severity != 'warning'" : ''}`, [m.scan.id, ...ids]));
        sections.push({ name, issues, pageCount });
      }
      categories.push({ category, label: CATEGORY_LABELS[category], intro: CATEGORY_INTRO[category], sections });
    }
  }

  const host = m.site.url;
  return {
    title: REPORT_TITLES[m.type],
    intro: `Site quality report for ${host} produced on ${longDate(m.scanDate)}.`,
    url: host,
    date: longDate(m.scanDate),
    summary,
    totalUrls: s.filesChecked,
    categories,
    showOccurrences,
    showIssues,
    topFixes: m.fixPlan.items.slice(0, 15).map((i) => ({ title: i.title, severity: i.severity, pages: i.pageCount, effort: i.effortMinutes < 60 ? `${i.effortMinutes} min` : `${Math.round((i.effortMinutes / 60) * 10) / 10} h`, templateLevel: i.templateLevel })),
  };
}

/** Show each explanatory detail once per issue — repeating it under every page adds only noise. */
function dedupeDetails(page: OccurrencePage, seen: Set<string>): OccurrencePage {
  return {
    ...page,
    lines: page.lines.map((l) => {
      if (!l.detail) return l;
      if (seen.has(l.detail)) return { ...l, detail: null };
      seen.add(l.detail);
      return l;
    }),
  };
}

/** Section page count line, e.g. "13 issues on 168 pages". */
export const foundOnText = (i: IssueEntry) =>
  `Found on ${i.pageCount.toLocaleString()} ${i.pageCount === 1 ? 'page' : 'pages'}${i.reviewPages ? ` (+${i.reviewPages.toLocaleString()} to review)` : ''}.`;
export const sectionCountText = (s: SectionEntry) => `${s.issues.length} ${s.issues.length === 1 ? 'issue' : 'issues'} on ${s.pageCount.toLocaleString()} ${s.pageCount === 1 ? 'page' : 'pages'}`;
