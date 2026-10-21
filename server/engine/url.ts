import type { ScanOptions, ScanScope } from '../../shared/options.js';

/** Query parameters that never change page content (tracking, Shopify session noise). */
const NOISE_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|_pos|_sid|_ss|_psq|_fid|_kx|ref|srsltid|pr_prod_strat|pr_rec_id|pr_rec_pid|pr_ref_pid|pr_seq)$/i;

/** Shopify product-recommendation parameters. PowerMapper treats each combination as a separate page. */
export const RECOMMENDATION_PARAMS = /^pr_(prod_strat|rec_id|rec_pid|ref_pid|seq)$/i;

/** Auto-https and sanity checks for user-typed site addresses. */
export function normalizeStartUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Enter a site address.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That does not look like a web address. Try something like https://example.com');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https addresses can be scanned.');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('Enter a full domain name, such as example.com');
  u.hash = '';
  return u.toString();
}

export function normalizeUrl(raw: string, base?: string, keepParams?: RegExp): string | null {
  try {
    const u = new URL(raw, base);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    const params = [...u.searchParams.entries()].filter(([k]) => !NOISE_PARAMS.test(k) || !!keepParams?.test(k));
    params.sort(([a], [b]) => a.localeCompare(b));
    u.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    return u.toString();
  } catch {
    return null;
  }
}

export const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** Registrable-ish root ("shop.example.co.uk" → "example.co.uk") for the related-domains option. */
export function rootDomain(host: string): string {
  const parts = bareHost(host).split('.');
  const twoLevelTld = parts.length > 2 && /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2]!) && parts[parts.length - 1]!.length === 2;
  return parts.slice(twoLevelTld ? -3 : -2).join('.');
}

/** Wildcard pattern → RegExp. "/forbidden/*" matches paths, "*.pdf" matches anywhere, full URLs match exactly. */
export function compileBlockPatterns(text: string): RegExp[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (/^https?:\/\//i.test(pattern)) return new RegExp(`^${escaped}$`, 'i');
      if (pattern.startsWith('/')) return new RegExp(`^https?://[^/]+${escaped}${pattern.endsWith('*') ? '' : '(\\?.*)?$'}`, 'i');
      return new RegExp(escaped, 'i');
    });
}

/** Shopify preset: URLs that are infinite, stateful or duplicate and should never be crawled. */
export const SHOPIFY_BLOCKS = compileBlockPatterns(
  [
    '/cart/add*',
    '/cart/change*',
    '/cart/clear*',
    '/cart/update*',
    '/checkout*',
    '/checkouts/*',
    '/account/logout*',
    '/cdn/*',
    '/services/*',
    '/wpm@*',
    '/web-pixels*',
    '*?variant=*',
    '*&variant=*',
    '*sort_by=*',
    '*filter.*',
    '*/collections/*/*+*', // tag-filter combinations
    '/search?*',
    '*?page=*&*',
    '/password',
    '/challenge*',
  ].join('\n'),
);

export interface ScopeConfig {
  scope: ScanScope;
  start: URL;
  allowedHosts: Set<string>;
  relatedRoot: string | null;
  folderPrefix: string;
  /** User block patterns — never requested at all (reported as "blocked by the scanner"). */
  blocks: RegExp[];
  /** Preset patterns — links still checked, but never crawled as pages. */
  pageBlocks: RegExp[];
  shopify: boolean;
}

export function buildScope(startUrl: string, scope: ScanScope, opts: ScanOptions, isShopify: boolean): ScopeConfig {
  const start = new URL(startUrl);
  const allowedHosts = new Set([bareHost(start.hostname)]);
  for (const d of opts.links.additionalDomains.split(/[\s,]+/).filter(Boolean)) {
    try {
      allowedHosts.add(bareHost(new URL(/^https?:/.test(d) ? d : `https://${d}`).hostname));
    } catch {
      /* ignore malformed additional domain */
    }
  }
  const folderPrefix = start.pathname.endsWith('/') ? start.pathname : start.pathname.replace(/[^/]*$/, '');
  const shopify = isShopify && opts.crawler.shopifyPreset;
  return {
    scope,
    start,
    allowedHosts,
    relatedRoot: opts.links.followRelatedDomains ? rootDomain(start.hostname) : null,
    folderPrefix,
    blocks: compileBlockPatterns(opts.blocks.patterns),
    pageBlocks: shopify ? SHOPIFY_BLOCKS : [],
    shopify,
  };
}

export function isInternal(url: string, sc: ScopeConfig): boolean {
  const host = bareHost(new URL(url).hostname);
  if (sc.allowedHosts.has(host)) return true;
  return sc.relatedRoot !== null && (host === sc.relatedRoot || host.endsWith(`.${sc.relatedRoot}`));
}

/** Whether a URL may be crawled as a page (vs. only link-checked). */
export function inCrawlScope(url: string, sc: ScopeConfig): boolean {
  if (!isInternal(url, sc)) return false;
  if (sc.scope === 'folder') return new URL(url).pathname.startsWith(sc.folderPrefix);
  return true;
}

export const isBlocked = (url: string, sc: ScopeConfig) => sc.blocks.some((re) => re.test(url));
export const isPageBlocked = (url: string, sc: ScopeConfig) => sc.pageBlocks.some((re) => re.test(url));

/** Shopify: /collections/x/products/y is the same document as /products/y — crawl the canonical form once. */
export function shopifyCanonical(url: string): string {
  return url.replace(/^(https?:\/\/[^/]+\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?)collections\/[^/?#]+\/products\//i, '$1products/');
}

const EXT_KIND: [RegExp, string, string][] = [
  [/\.pdf$/i, 'document', 'PDF'],
  [/\.(docx?|xlsx?|pptx?|odt|ods|rtf|txt|csv|zip)$/i, 'document', 'Other'],
  [/\.gif$/i, 'image', 'GIF'],
  [/\.png$/i, 'image', 'PNG'],
  [/\.jpe?g$/i, 'image', 'JPEG'],
  [/\.svg$/i, 'image', 'SVG'],
  [/\.(webp|avif|ico|bmp|tiff?)$/i, 'image', 'Other'],
  [/\.css$/i, 'misc', 'CSS'],
  [/\.m?js$/i, 'misc', 'JavaScript'],
  [/\.(woff2?|ttf|otf|eot)$/i, 'misc', 'Font'],
  [/\.(mp4|webm|mov|mp3|wav|ogg)$/i, 'misc', 'Media'],
];

/** Inventory classification (Plan.md §2.5 Pages › Inventory). */
export function classify(url: string, contentType?: string | null): { kind: 'document' | 'image' | 'misc'; subtype: string } {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return { kind: 'document', subtype: 'HTML' };
  if (ct.includes('application/pdf')) return { kind: 'document', subtype: 'PDF' };
  if (ct.includes('image/gif')) return { kind: 'image', subtype: 'GIF' };
  if (ct.includes('image/png')) return { kind: 'image', subtype: 'PNG' };
  if (ct.includes('image/jpeg')) return { kind: 'image', subtype: 'JPEG' };
  if (ct.includes('image/svg')) return { kind: 'image', subtype: 'SVG' };
  if (ct.startsWith('image/')) return { kind: 'image', subtype: 'Other' };
  if (ct.includes('text/css')) return { kind: 'misc', subtype: 'CSS' };
  if (ct.includes('javascript') || ct.includes('ecmascript')) return { kind: 'misc', subtype: 'JavaScript' };
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  for (const [re, kind, subtype] of EXT_KIND) if (re.test(path)) return { kind: kind as 'document' | 'image' | 'misc', subtype };
  if (ct) return { kind: 'document', subtype: 'Other' };
  return { kind: 'document', subtype: 'HTML' };
}

/** Shopify theme assets live under /cdn/shop/t/<id>/assets; app extensions elsewhere — only theme CSS is validated. */
export const isShopifyAppAsset = (url: string) => /\/cdn\/shop\/extensions\/|\/shopifycloud\/|\/extensions\/[0-9a-f-]{20,}\//i.test(url);
