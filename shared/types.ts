import type { Category, ScanScope, ScanOptions } from './options';

export const PRODUCT_NAME = 'SortSite Tools by Ecomback';

// ── Roles & permissions (Plan.md §10) ─────────────────────────────────────────
export type Role = 'admin' | 'analyst' | 'viewer';
export const ROLE_LABELS: Record<Role, string> = { admin: 'Administrator', analyst: 'Analyst', viewer: 'Viewer' };

export type Permission =
  | 'scan.run'
  | 'scan.options'
  | 'scan.delete'
  | 'site.delete'
  | 'report.view'
  | 'report.export'
  | 'sitemap.run'
  | 'users.manage'
  | 'audit.view'
  | 'billing.view'
  | 'clients.manage'
  | 'settings.self';

export const PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ['scan.run', 'scan.options', 'scan.delete', 'site.delete', 'report.view', 'report.export', 'sitemap.run', 'users.manage', 'audit.view', 'billing.view', 'clients.manage', 'settings.self'],
  analyst: ['scan.run', 'scan.options', 'scan.delete', 'report.view', 'report.export', 'sitemap.run', 'billing.view', 'settings.self'],
  viewer: ['report.view', 'report.export', 'settings.self'],
};
export const PERMISSION_LABELS: Record<Permission, string> = {
  'scan.run': 'Start and stop scans',
  'scan.options': 'Edit scan options and schedules',
  'scan.delete': 'Delete scans',
  'site.delete': 'Delete sites',
  'report.view': 'View reports',
  'report.export': 'Download reports',
  'sitemap.run': 'Create and run sitemaps',
  'users.manage': 'Manage users',
  'audit.view': 'View audit history',
  'billing.view': 'View billing and quotas',
  'clients.manage': 'Manage client workspaces',
  'settings.self': 'Edit own settings and security',
};
export const can = (role: Role, p: Permission) => PERMISSIONS[role].includes(p);

// ── Severity ──────────────────────────────────────────────────────────────────
export type Severity = 'priority' | 'other' | 'warning';
export const SEVERITY_LABELS: Record<Severity, string> = { priority: 'Priority', other: 'Other', warning: 'Warning' };

// ── DTOs ──────────────────────────────────────────────────────────────────────
export interface Me {
  id: number;
  email: string;
  name: string;
  role: Role;
  clientId: number | null;
  timezone: string;
  dateFormat: DateFormat;
  sidebarTheme: 'dark' | 'light';
  twoFactorEnabled: boolean;
  accountName: string;
  permissions: Permission[];
}

export type DateFormat = 'dd-mmm-yyyy' | 'mm/dd/yyyy' | 'dd/mm/yyyy' | 'yyyy-mm-dd';

export type ScanStatus = 'queued' | 'running' | 'completed' | 'stopped' | 'failed';
export type MapStatus = ScanStatus;

export interface ScanProgress {
  scanId: number;
  siteId: number;
  status: ScanStatus;
  /** crawl = analysing pages, links = checking links and files, finishing = site-wide analysis. */
  phase: 'queued' | 'crawl' | 'links' | 'finishing' | 'done';
  pagesFound: number;
  pagesDone: number;
  linksTotal: number;
  linksDone: number;
  currentUrl: string | null;
  etaSeconds: number | null;
  percent: number;
  startedAt: string | null;
}

export interface SiteRow {
  id: number;
  url: string;
  scope: ScanScope;
  clientId: number | null;
  clientName: string | null;
  scheduleLabel: string;
  nextRunAt: string | null;
  diskBytes: number;
  diskPct: number;
  lastScan: ScanSummaryRow | null;
  running: ScanProgress | null;
  thumbnail: string | null;
  scanCount: number;
}

export interface ScanSummaryRow {
  id: number;
  siteId: number;
  url: string;
  scope: ScanScope;
  status: ScanStatus;
  startedAt: string | null;
  finishedAt: string | null;
  pagesChecked: number;
  issuePct: number;
  priorityPct: number;
  otherPct: number;
  diskBytes: number;
  diskPct: number;
  thumbnail: string | null;
  error: string | null;
}

export interface CategoryStat {
  category: Category;
  enabled: boolean;
  pagesWithIssues: number;
  issuePct: number;
  issueCount: number;
  priorityCount: number;
  otherCount: number;
  warningCount: number;
  bars: { label: string; pct: number; help: string }[];
}

export interface Benchmark { value: number; label: 'better' | 'average' | 'worse'; source: string }

export interface ReportSummary {
  scan: ScanSummaryRow;
  site: { id: number; url: string; clientName: string | null };
  pagesWithIssues: number;
  pagesChecked: number;
  filesChecked: number;
  rulesChecked: number;
  benchmark: Benchmark;
  categoryBenchmarks: Record<Category, Benchmark>;
  categories: CategoryStat[];
  complianceScore: number;
  diagnosticsCount: number;
  options: ScanOptions;
  shopify: boolean;
  running: ScanProgress | null;
}

export interface IssueGroup {
  ruleId: string;
  category: Category;
  severity: Severity;
  section: string;
  title: string;
  description: string;
  fix: string;
  guidelines: GuidelineRef[];
  pageCount: number;
  /** Pages where the rule definitely fails (excludes "needs review" warnings). */
  confirmedPageCount: number;
  occurrenceCount: number;
  helpUrl: string | null;
  templateLevel: boolean;
}

export interface GuidelineRef { label: string; url: string | null }

export interface IssueOccurrencePage {
  pageId: number;
  url: string;
  lines: { line: number | null; snippet: string; selector: string | null; detail: string | null }[];
  total: number;
}

export interface Notification { id: number; kind: string; title: string; body: string; link: string | null; createdAt: string; read: boolean }

export interface ApiError { error: string; fields?: { path: string; message: string }[] }
