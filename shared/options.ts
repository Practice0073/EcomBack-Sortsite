/**
 * Scan options — the single contract shared by the Edit Scan UI, the API and the scan engine.
 * Defaults mirror Plan.md §2.6 and §5.8.
 */

export type ScanScope = 'site' | 'folder' | 'page' | 'page-links';
export const SCOPE_LABELS: Record<ScanScope, string> = {
  site: 'Entire Site',
  folder: 'Folder',
  page: 'Page',
  'page-links': 'Page and Links',
};

export type Category = 'accessibility' | 'compatibility' | 'errors' | 'search' | 'standards' | 'usability';
export const CATEGORIES: readonly Category[] = ['accessibility', 'compatibility', 'errors', 'search', 'standards', 'usability'];
export const CATEGORY_LABELS: Record<Category, string> = {
  accessibility: 'Accessibility',
  compatibility: 'Compatibility',
  errors: 'Errors',
  search: 'Search',
  standards: 'Standards',
  usability: 'Usability',
};

export type WcagVersion = '2.0' | '2.1' | '2.2';
export type WcagLevel = 'A' | 'AA' | 'AAA';
export type DomMode = 'none' | 'smart' | 'all';
export type Compatibility = 'powermapper' | 'standard';
export type ScheduleFrequency = 'none' | 'daily' | 'weekly' | 'monthly';
export type ReadingAge = 'universal' | 'teen' | 'adult';
export type SpellLanguage = 'en-US' | 'en-GB' | 'es' | 'fr' | 'de';
export type BrowserId = 'chrome' | 'edge' | 'firefox' | 'opera' | 'safari' | 'chrome_android' | 'safari_ios';
export type SearchEngine = 'google' | 'bing' | 'duckduckgo';
export type AuthMode = 'none' | 'basic' | 'headers' | 'shopify-web-bot-auth' | 'cookies';

export const BROWSER_LABELS: Record<BrowserId, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  safari: 'Safari macOS',
  chrome_android: 'Android',
  safari_ios: 'iPhone / iPad',
};

export const SPELL_LANGUAGE_LABELS: Record<SpellLanguage, string> = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

export const READING_AGE_LABELS: Record<ReadingAge, string> = {
  universal: 'Universal (reading age 9–12, grade ≤ 7)',
  teen: 'Teen (grade ≤ 9)',
  adult: 'Adult (grade ≤ 12)',
};

export interface ScanOptions {
  rules: {
    accessibility: {
      enabled: boolean;
      wcagVersion: WcagVersion;
      wcagLevel: WcagLevel;
      aria: boolean;
      usStandards: boolean; // Section 508
      euStandards: boolean; // EN 301 549
      pdfStandards: boolean; // PDF/UA-1
      screenReaders: boolean; // JAWS / NVDA / VoiceOver
      readingAge: ReadingAge;
    };
    compatibility: { enabled: boolean; browsers: BrowserId[] };
    errors: {
      enabled: boolean;
      spellCheck: boolean;
      spellLanguage: SpellLanguage;
      ignoreCapitalized: boolean;
      forbiddenText: string;
      requiredText: string;
      pageWeightLimitKb: number | null; // null = don't check
    };
    search: {
      enabled: boolean;
      engines: SearchEngine[];
      robotsGuidelines: boolean;
      bestPractices: boolean;
      keywords: string;
    };
    standards: { enabled: boolean; validateCss: boolean; validateHtml: boolean; obsoleteFeatures: boolean; legacyDoctype: 'modern' | 'legacy' };
    usability: { enabled: boolean; bestPractices: boolean; readability: boolean };
  };
  blocks: { patterns: string; obeyRobots: boolean };
  reports: {
    domMode: DomMode;
    maxPagesPerIssue: number;
    maxLinesPerIssue: number;
    /** 'powermapper': count pages and choose rules the way PowerMapper/SortSite does; 'standard': de-duplicate recommendation URLs and run every rule. */
    compatibility: Compatibility;
  };
  links: {
    followRelatedDomains: boolean;
    additionalDomains: string;
    depthMode: 'entire' | 'limited';
    maxDepth: number;
    externalMode: 'all' | 'first';
    externalFirstN: number;
  };
  crawler: {
    authMode: AuthMode;
    basicUser: string;
    basicPassword: string;
    headers: string; // "Name: value" per line
    cookies: string; // "name=value" per line
    shopifyStorefrontPassword: string;
    shopifyPreset: boolean;
    throttle: 'auto' | 'slow' | 'normal' | 'fast';
    pageTimeoutMs: number;
    maxPages: number;
    retries: number;
  };
  schedule: { frequency: ScheduleFrequency; startDate: string; time: string; emailTo: 'nobody' | 'me' | 'all-users' | 'custom'; customEmails: string };
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  rules: {
    accessibility: {
      enabled: true,
      wcagVersion: '2.2',
      wcagLevel: 'AA',
      aria: true,
      usStandards: true,
      euStandards: true,
      pdfStandards: true,
      screenReaders: true,
      readingAge: 'universal',
    },
    compatibility: { enabled: true, browsers: ['chrome', 'edge', 'firefox', 'opera', 'safari', 'chrome_android', 'safari_ios'] },
    errors: {
      enabled: true,
      spellCheck: true,
      spellLanguage: 'en-US',
      ignoreCapitalized: true,
      forbiddenText: '',
      requiredText: '',
      pageWeightLimitKb: null,
    },
    search: { enabled: true, engines: ['google', 'bing', 'duckduckgo'], robotsGuidelines: true, bestPractices: true, keywords: '' },
    standards: { enabled: true, validateCss: true, validateHtml: true, obsoleteFeatures: true, legacyDoctype: 'legacy' },
    usability: { enabled: true, bestPractices: true, readability: true },
  },
  blocks: { patterns: '', obeyRobots: true },
  reports: { domMode: 'all', maxPagesPerIssue: 140, maxLinesPerIssue: 5, compatibility: 'powermapper' },
  links: { followRelatedDomains: false, additionalDomains: '', depthMode: 'entire', maxDepth: 3, externalMode: 'first', externalFirstN: 20 },
  crawler: {
    authMode: 'none',
    basicUser: '',
    basicPassword: '',
    headers: '',
    cookies: '',
    shopifyStorefrontPassword: '',
    shopifyPreset: true,
    throttle: 'auto',
    pageTimeoutMs: 180000,
    maxPages: 500,
    retries: 2,
  },
  schedule: { frequency: 'none', startDate: '', time: '03:00', emailTo: 'nobody', customEmails: '' },
};

/** Fields holding secrets — encrypted at rest and masked in API responses. */
export const SECRET_OPTION_PATHS = ['crawler.basicPassword', 'crawler.headers', 'crawler.cookies', 'crawler.shopifyStorefrontPassword'] as const;
export const SECRET_MASK = '••••••••';

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge partial options over defaults so older saved options gain new fields. */
export function mergeOptions(partial: unknown, base: ScanOptions = DEFAULT_SCAN_OPTIONS): ScanOptions {
  // Incoming values must keep the default's type (arrays stay arrays, numbers stay numbers);
  // anything else is ignored so malformed input can never corrupt stored options.
  const merge = (b: unknown, p: unknown): unknown => {
    if (p === undefined) return b;
    if (Array.isArray(b)) return Array.isArray(p) ? p.filter((x) => typeof x === 'string') : b;
    if (b === null || p === null) return p === null || typeof p === 'number' ? p : b; // nullable numbers
    if (!isPlain(b)) return typeof p === typeof b ? p : b;
    if (!isPlain(p)) return b;
    const out: Plain = {};
    for (const key of Object.keys(b)) out[key] = merge(b[key], p[key]);
    return out;
  };
  return merge(structuredClone(base), partial) as ScanOptions;
}

export interface OptionsValidationError { path: string; message: string }

export function validateOptions(o: ScanOptions): OptionsValidationError[] {
  const errors: OptionsValidationError[] = [];
  const intIn = (path: string, v: number | null, min: number, max: number, nullable = false) => {
    if (v === null) {
      if (!nullable) errors.push({ path, message: 'This field is required.' });
      return;
    }
    if (!Number.isInteger(v) || v < min || v > max) errors.push({ path, message: `Enter a whole number from ${min} to ${max}.` });
  };
  intIn('reports.maxPagesPerIssue', o.reports.maxPagesPerIssue, 1, 5000);
  intIn('reports.maxLinesPerIssue', o.reports.maxLinesPerIssue, 1, 100);
  intIn('links.maxDepth', o.links.maxDepth, 1, 50);
  intIn('links.externalFirstN', o.links.externalFirstN, 1, 1000);
  intIn('crawler.pageTimeoutMs', o.crawler.pageTimeoutMs, 5000, 600000);
  intIn('crawler.maxPages', o.crawler.maxPages, 1, 500);
  intIn('crawler.retries', o.crawler.retries, 0, 5);
  intIn('rules.errors.pageWeightLimitKb', o.rules.errors.pageWeightLimitKb, 10, 100000, true);
  const enumIn = (path: string, v: string, allowed: readonly string[]) => {
    if (!allowed.includes(v)) errors.push({ path, message: `Choose one of: ${allowed.join(', ')}.` });
  };
  enumIn('rules.accessibility.wcagVersion', o.rules.accessibility.wcagVersion, ['2.0', '2.1', '2.2']);
  enumIn('rules.accessibility.wcagLevel', o.rules.accessibility.wcagLevel, ['A', 'AA', 'AAA']);
  enumIn('rules.accessibility.readingAge', o.rules.accessibility.readingAge, Object.keys(READING_AGE_LABELS));
  enumIn('rules.errors.spellLanguage', o.rules.errors.spellLanguage, Object.keys(SPELL_LANGUAGE_LABELS));
  enumIn('rules.standards.legacyDoctype', o.rules.standards.legacyDoctype, ['modern', 'legacy']);
  enumIn('reports.domMode', o.reports.domMode, ['none', 'smart', 'all']);
  enumIn('reports.compatibility', o.reports.compatibility, ['powermapper', 'standard']);
  enumIn('links.depthMode', o.links.depthMode, ['entire', 'limited']);
  enumIn('links.externalMode', o.links.externalMode, ['all', 'first']);
  enumIn('crawler.authMode', o.crawler.authMode, ['none', 'basic', 'headers', 'shopify-web-bot-auth', 'cookies']);
  enumIn('crawler.throttle', o.crawler.throttle, ['auto', 'slow', 'normal', 'fast']);
  enumIn('schedule.frequency', o.schedule.frequency, ['none', 'daily', 'weekly', 'monthly']);
  enumIn('schedule.emailTo', o.schedule.emailTo, ['nobody', 'me', 'all-users', 'custom']);
  o.rules.compatibility.browsers = o.rules.compatibility.browsers.filter((b) => b in BROWSER_LABELS);
  o.rules.search.engines = o.rules.search.engines.filter((e) => ['google', 'bing', 'duckduckgo'].includes(e));
  if (o.rules.compatibility.enabled && o.rules.compatibility.browsers.length === 0) {
    errors.push({ path: 'rules.compatibility.browsers', message: 'Select at least one browser, or turn compatibility checks off.' });
  }
  if (o.rules.search.enabled && o.rules.search.engines.length === 0 && !o.rules.search.bestPractices && !o.rules.search.robotsGuidelines) {
    errors.push({ path: 'rules.search.engines', message: 'Select at least one search guideline, or turn search checks off.' });
  }
  if (o.crawler.authMode === 'basic' && !o.crawler.basicUser.trim()) errors.push({ path: 'crawler.basicUser', message: 'Enter the HTTP username.' });
  if (o.schedule.frequency !== 'none' && o.schedule.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(o.schedule.startDate)) {
    errors.push({ path: 'schedule.startDate', message: 'Use the date picker (YYYY-MM-DD).' });
  }
  if (!/^\d{2}:\d{2}$/.test(o.schedule.time)) errors.push({ path: 'schedule.time', message: 'Use HH:MM (24-hour).' });
  if (o.schedule.emailTo === 'custom') {
    const bad = o.schedule.customEmails.split(/[\s,;]+/).filter(Boolean).filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad.length) errors.push({ path: 'schedule.customEmails', message: `Not a valid email: ${bad.join(', ')}` });
  }
  return errors;
}
