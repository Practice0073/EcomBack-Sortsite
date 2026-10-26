import { createContext, useContext } from 'react';
import type { Category } from '@shared/options';
import type { IssueGroup, ReportSummary, Severity } from '@shared/types';

export interface ReportCtx {
  scanId: number;
  summary: ReportSummary;
  base: string;
  reload: () => void;
}

export const ReportContext = createContext<ReportCtx | null>(null);

export function useReport(): ReportCtx {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error('useReport outside ReportShell');
  return ctx;
}

// ── Response shapes (mirrors server/reports/data.ts) ─────────────────────────
export interface IssuesResponse {
  groups: IssueGroup[];
  sections: { name: string; issues: number; pages: number }[];
  aria: { errorsPct: number; warningsPct: number };
}

export interface OccurrencesResponse {
  pages: { pageId: number; url: string; total: number; lines: { line: number | null; snippet: string; selector: string | null; detail: string | null }[] }[];
  totalPages: number;
}

export interface PageListRow { pageId: number; url: string; title: string | null; status: number | null; depth: number; contentType: string | null; priority: number; other: number; warning: number; total: number }
export interface PageListResponse { items: PageListRow[]; total: number; page: number; perPage: number }

export interface PageDetail {
  page: { id: number; url: string; finalUrl: string | null; title: string | null; status: number | null; depth: number; bytes: number; loadMs: number | null; words: number | null; contentType: string | null };
  issues: { ruleId: string; title: string; severity: Severity; category: Category; guidelines: { label: string; url: string | null }[]; description: string; fix: string; occurrences: { line: number | null; snippet: string | null; selector: string | null; detail: string | null }[] }[];
}

export interface InventoryGroup { kind: string; label: string; rows: { subtype: string; description: string; count: number; internal: number; broken: number; bytes: number }[] }
export interface InventoryFile { url: string; status: number | null; bytes: number | null; internal: number; error: string | null; verdict: 'ok' | 'broken' | 'unverified' }

export interface DiagnosticGroup { code: string; label: string; message: string; count: number; urls: string[] }

export interface SiteMapNode { id: number; url: string; title: string | null; depth: number; parent: string | null; priority: number; other: number; warning: number; status: number | null }

export interface TestedResponse { guidelines: { name: string; checked: boolean; note: string }[]; scanOptions: [string, string][] }

export type Bucket = 'quick-win' | 'major' | 'fill-in' | 'later';
export interface FixPlanItem extends IssueGroup { impact: number; effortMinutes: number; score: number; bucket: Bucket }
export interface FixPlanResponse { items: FixPlanItem[]; totalMinutes: number }

export interface StatementData {
  siteUrl: string;
  scanDate: string | null;
  standard: string;
  score: number;
  grade: string;
  pagesChecked: number;
  a11yIssuePct: number;
  knownLimitations: { title: string; guidelines: string[]; pages: number }[];
  scope: string;
}

export const BUCKET_LABELS: Record<Bucket, string> = { 'quick-win': 'Quick wins', major: 'Major projects', 'fill-in': 'Fill-ins', later: 'Later' };

/** Rule ids can contain dots, colons and spaces — always encode before putting them in a URL. */
export const ruleHref = (ruleId: string) => `/rules/${encodeURIComponent(ruleId)}`;

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // block spreadsheet formula injection
  return `"${safe.replace(/"/g, '""')}"`;
};
