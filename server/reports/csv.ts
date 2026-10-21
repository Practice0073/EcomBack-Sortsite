import { q } from '../db/index.js';
import { getRule } from '../engine/rules/catalog.js';
import { CATEGORY_LABELS } from '../../shared/options.js';
import { SEVERITY_LABELS, type Severity } from '../../shared/types.js';

const BOM = '﻿';

/** RFC 4180 field quoting; also neutralises spreadsheet formula injection (=, +, -, @ prefixes). */
function field(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (header: string[], rows: unknown[][]) => BOM + [header, ...rows].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';

export function csvIssues(scanId: number): string {
  const rows = q.all<{ rule_id: string; category: string; severity: Severity; url: string; line: number | null; snippet: string | null; selector: string | null; detail: string | null }>(
    "SELECT i.rule_id, i.category, i.severity, p.url, i.line, i.snippet, i.selector, i.detail FROM issues i JOIN scan_pages p ON p.id = i.page_id WHERE i.scan_id = ? ORDER BY CASE i.severity WHEN 'priority' THEN 0 WHEN 'other' THEN 1 ELSE 2 END, i.rule_id, p.url, i.line",
    [scanId],
  );
  return toCsv(
    ['Category', 'Severity', 'Rule ID', 'Issue', 'Guidelines', 'Page URL', 'Line', 'Selector', 'Snippet', 'Detail'],
    rows.map((r) => {
      const rule = getRule(r.rule_id);
      return [CATEGORY_LABELS[r.category as keyof typeof CATEGORY_LABELS] ?? r.category, SEVERITY_LABELS[r.severity], r.rule_id, rule?.title ?? r.rule_id, rule?.guidelines.map((g) => g.label).join('; ') ?? '', r.url, r.line ?? '', r.selector ?? '', r.snippet ?? '', r.detail ?? ''];
    }),
  );
}

export function csvPages(scanId: number): string {
  const rows = q.all<{ url: string; final_url: string | null; title: string | null; status: number | null; content_type: string | null; depth: number; bytes: number; load_ms: number | null; word_count: number | null; priority_count: number; other_count: number; warning_count: number }>(
    'SELECT url, final_url, title, status, content_type, depth, bytes, load_ms, word_count, priority_count, other_count, warning_count FROM scan_pages WHERE scan_id = ? ORDER BY (priority_count * 1000 + other_count * 10 + warning_count) DESC, url',
    [scanId],
  );
  return toCsv(
    ['URL', 'Final URL', 'Title', 'Status', 'Content type', 'Click depth', 'Bytes', 'Load ms', 'Words', 'Priority issues', 'Other issues', 'Warnings', 'Total'],
    rows.map((r) => [r.url, r.final_url ?? '', r.title ?? '', r.status ?? '', r.content_type ?? '', r.depth, r.bytes, r.load_ms ?? '', r.word_count ?? '', r.priority_count, r.other_count, r.warning_count, r.priority_count + r.other_count + r.warning_count]),
  );
}
