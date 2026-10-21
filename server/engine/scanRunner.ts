import fs from 'node:fs';
import path from 'node:path';
import robotsParser from 'robots-parser';
import { q, tx, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { bus } from '../lib/events.js';
import { openOptions } from '../lib/options.js';
import type { ScanOptions, ScanScope } from '../../shared/options.js';
import type { ScanProgress, ScanStatus, Severity } from '../../shared/types.js';
import { getRule } from './rules/catalog.js';
import type { Finding } from './rules/types.js';
import { CookieJar, Throttle, authHeaders, fetchUrl, unlockShopifyStorefront, type FetchResult, type FetcherOptions } from './fetcher.js';
import { axeTagsFor, browserAvailable, renderPage, type RenderResult } from './browser.js';
import { SourceMap, loadWithLocations, lineOf, snippetOf, visibleText } from './source.js';
import {
  bareHost,
  buildScope,
  classify,
  inCrawlScope,
  isBlocked,
  isInternal,
  isPageBlocked,
  isShopifyAppAsset,
  normalizeUrl as normalizeAnyUrl,
  RECOMMENDATION_PARAMS,
  shopifyCanonical,
  type ScopeConfig,
} from './url.js';
import type { PageContext } from './context.js';
import { accessibilityAnalyzer } from './analyzers/accessibility.js';
import { errorsAnalyzer } from './analyzers/errors.js';
import { searchAnalyzer, type SearchFacts } from './analyzers/search.js';
import { standardsAnalyzer, validateCss } from './analyzers/standards.js';
import { usabilityAnalyzer } from './analyzers/usability.js';
import { compatibilityAnalyzer, checkCssCompat, cssFeatures } from './analyzers/compatibility.js';
import { pdfAnalyzer } from './analyzers/pdf.js';
import { BROKEN_SQL, linkVerdict } from './linkStatus.js';
import { computeStats } from './stats.js';
import { afterScanFinished } from './afterScan.js';

interface ScanRow {
  id: number;
  site_id: number;
  status: ScanStatus;
  url: string;
  scope: ScanScope;
  options_json: string;
  started_at: string | null;
  crawl_state: string | null;
  stop_requested: number;
}

interface QueueItem { url: string; depth: number; parent: string | null; seed?: boolean }
interface CrawlState { frontier: QueueItem[]; linkQueue: string[]; startFinal: string; shopify: boolean; elapsedMs: number }

const MAX_OCCURRENCES_PER_RULE_PER_PAGE = 50;

export class ScanCancelled extends Error {}

/** Runs one scan end to end. Safe to call again for a resumed scan (state is persisted). */
export async function runScan(scanId: number): Promise<void> {
  const scan = q.get<ScanRow>('SELECT * FROM scans WHERE id = ?', [scanId]);
  if (!scan) return;
  const site = q.get<{ id: number; account_id: number }>('SELECT id, account_id FROM sites WHERE id = ?', [scan.site_id]);
  if (!site) return;
  const runner = new ScanRunner(scan, site.account_id, openOptions(scan.options_json));
  try {
    await runner.run();
  } catch (e) {
    console.error(`[scan ${scanId}] failed`, e);
    q.run("UPDATE scans SET status = 'failed', finished_at = ?, error = ?, current_url = NULL WHERE id = ?", [nowIso(), (e as Error).message.slice(0, 500), scanId]);
    runner.emitProgress(true);
    bus.emitEvent({ type: 'scan.finished', accountId: site.account_id, scanId, siteId: scan.site_id, status: 'failed' });
    await afterScanFinished(scanId);
  }
}

class ScanRunner {
  private readonly o: ScanOptions;
  private scope!: ScopeConfig;
  private fo!: FetcherOptions;
  private externalFo!: FetcherOptions;
  /** One throttle per external host: a slow or rate-limiting site only slows checks of that site. */
  private externalThrottles = new Map<string, Throttle>();
  /** Cross-origin stylesheet text shared by every page of the scan (theme and app CSS repeat on each page). */
  private cssCache = new Map<string, Promise<string>>();
  private robots: ReturnType<typeof robotsParser> | null = null;
  private robotsText: string | null = null;
  private robotsMissing = false;
  private frontier: QueueItem[] = [];
  private seen = new Set<string>(); // URLs queued as pages
  private linkQueue: string[] = [];
  private linkSeen = new Set<string>();
  private externalPerHost = new Map<string, number>();
  private facts = new Map<string, SearchFacts>();
  private spellingWords = new Map<string, Set<number>>();
  private pagesDone = 0;
  private skippedForLimit = 0;
  private blockedByScanner = new Set<string>();
  private robotsBlocked = new Set<string>();
  private startFinal = '';
  private shopify = false;
  private maxPages: number;
  private startedAt = Date.now();
  private elapsedBefore = 0;
  private lastEmit = 0;
  private lastStateSave = 0;
  private stopChecked = 0;
  private stopFlag = false;
  private chromeOk = browserAvailable();
  private avgMs = 0;
  private axeTags: string[] | null;
  private axeDisabled: string[];
  /** Normalise a crawl URL; PowerMapper compatibility keeps recommendation variants as separate pages. */
  private normalizeUrl: (raw: string, base?: string) => string | null;

  constructor(private scan: ScanRow, private accountId: number, options: ScanOptions) {
    this.o = options;
    const plan = q.get<{ max_pages_per_scan: number }>('SELECT p.max_pages_per_scan FROM plans p JOIN accounts a ON a.plan_id = p.id WHERE a.id = ?', [accountId]);
    this.maxPages = Math.min(options.crawler.maxPages, plan?.max_pages_per_scan ?? 500);
    const a11y = options.rules.accessibility;
    this.axeTags = a11y.enabled ? axeTagsFor(a11y) : null;
    const pm = options.reports.compatibility === 'powermapper';
    // PowerMapper compatibility: skip the axe rules PowerMapper does not test (list structure, WCAG 2.2 target size).
    this.axeDisabled = [...(a11y.aria ? [] : allAriaRuleIds()), ...(pm ? POWERMAPPER_SKIPPED_AXE_RULES : [])];
    this.normalizeUrl = (raw, base) => normalizeAnyUrl(raw, base, pm ? RECOMMENDATION_PARAMS : undefined);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  async run() {
    const resumed = !!this.scan.crawl_state;
    q.run("UPDATE scans SET status = 'running', started_at = COALESCE(started_at, ?), error = NULL, stop_requested = 0 WHERE id = ?", [nowIso(), this.scan.id]);
    if (!resumed) this.emitProgress(true); // immediate "Started" feedback for a fresh scan

    const jar = new CookieJar(this.o.crawler.authMode === 'cookies' ? this.o.crawler.cookies : '');
    const headers = authHeaders(this.o.crawler);
    const throttle = new Throttle(this.o.crawler.throttle);
    const base = { timeoutMs: this.o.crawler.pageTimeoutMs, retries: this.o.crawler.retries, headers, jar, throttle };

    if (resumed) {
      const state = JSON.parse(this.scan.crawl_state!) as CrawlState;
      this.startFinal = state.startFinal;
      this.shopify = state.shopify;
      this.elapsedBefore = state.elapsedMs ?? 0;
      this.scope = buildScope(this.startFinal, this.scan.scope, this.o, this.shopify);
      this.fo = { ...base, authHosts: this.scope.allowedHosts };
      this.restore(state);
    } else {
      await this.bootstrap(base);
    }
    this.externalFo = { ...base, headers: {}, jar: new CookieJar(), throttle: new Throttle('fast'), authHosts: new Set(), retries: 1, timeoutMs: Math.min(30_000, this.o.crawler.pageTimeoutMs) };
    this.emitProgress(true); // after a resume, this already reflects the pages restored from saved state

    if (this.shopify && this.o.crawler.shopifyStorefrontPassword) {
      const ok = await unlockShopifyStorefront(new URL(this.startFinal).origin, this.o.crawler.shopifyStorefrontPassword, this.fo);
      this.diag('shopify-password', ok ? 'Unlocked the password-protected Shopify storefront with the storefront password.' : 'The storefront password was not accepted; protected pages may show the password page.');
    }

    await this.loadRobots();
    await this.crawl();
    if (this.stopFlag) return this.finish('stopped');
    await this.checkLinks();
    if (this.stopFlag) return this.finish('stopped');
    await this.siteLevelChecks();
    await this.finish('completed');
  }

  private async bootstrap(base: Omit<FetcherOptions, 'authHosts'>) {
    // A scan interrupted before its first saved state restarts from scratch: clear partial results so
    // pages analysed twice can never produce duplicate issues or diagnostics.
    tx(() => {
      for (const table of ['issues', 'page_refs', 'diagnostics', 'scan_resources', 'scan_pages']) q.run(`DELETE FROM ${table} WHERE scan_id = ?`, [this.scan.id]);
      q.run('UPDATE scans SET pages_found = 0, pages_done = 0, links_total = 0, links_done = 0, links_started_at = NULL WHERE id = ?', [this.scan.id]);
    });
    const start = this.normalizeUrl(this.scan.url)!;
    const startHosts = new Set([bareHost(new URL(start).hostname)]);
    const probeFo = { ...base, authHosts: startHosts };
    const first = await fetchUrl(start, probeFo);
    if (first.error && first.status === null) throw new Error(`Could not reach ${start}: ${first.error}`);
    this.startFinal = this.normalizeUrl(first.finalUrl) ?? start;
    const body = first.body?.toString('utf8') ?? '';
    this.shopify =
      !!first.headers['x-shopid'] || !!first.headers['x-shopify-stage'] || /shopify/i.test(first.headers['powered-by'] ?? '') || /cdn\.shopify\.com|Shopify\.theme|shopify-section/.test(body);
    this.scope = buildScope(this.startFinal, this.scan.scope, this.o, this.shopify);
    this.scope.allowedHosts.add(bareHost(new URL(start).hostname));
    this.fo = { ...base, authHosts: this.scope.allowedHosts };
    q.run('UPDATE scans SET shopify = ? WHERE id = ?', [this.shopify ? 1 : 0, this.scan.id]);
    if (this.shopify) this.diag('shopify', 'Shopify storefront detected — the Shopify preset (cart coverage, duplicate-URL filtering, theme vs. app asset handling) was applied.');
    if (/\/password\/?$/.test(new URL(this.startFinal).pathname)) {
      this.diag('shopify-password-page', 'The storefront redirected to its password page. Add the storefront password under Options › Crawler to scan the real pages.');
    }
    this.enqueue({ url: this.startFinal, depth: 0, parent: null });
    if (this.scope.shopify && this.scan.scope === 'site') {
      const origin = new URL(this.startFinal).origin;
      for (const p of ['/cart', '/collections/all', '/collections', '/account/login', '/blogs/news']) this.enqueue({ url: `${origin}${p}`, depth: 1, parent: this.startFinal, seed: true });
      this.diag('shopify-checkout', 'Checkout pages are hosted by Shopify and need a cart session, so they are not scanned. Use Shopify\'s checkout accessibility report for those steps.');
    }
  }

  private restore(state: CrawlState) {
    for (const row of q.all<{ url: string }>('SELECT url FROM scan_pages WHERE scan_id = ?', [this.scan.id])) this.seen.add(row.url);
    for (const row of q.all<{ url: string }>('SELECT url FROM scan_resources WHERE scan_id = ?', [this.scan.id])) this.linkSeen.add(row.url);
    this.pagesDone = Number(q.value("SELECT COUNT(*) FROM scan_pages WHERE scan_id = ? AND content_type LIKE 'text/html%'", [this.scan.id]));
    for (const item of state.frontier) {
      if (!this.seen.has(item.url)) {
        this.seen.add(item.url);
        this.frontier.push(item);
      }
    }
    for (const u of state.linkQueue) if (!this.linkSeen.has(u)) this.linkQueue.push(u);
    for (const u of this.linkQueue) this.linkSeen.add(u);
    this.diag('resumed', `Scan resumed after interruption with ${this.pagesDone} pages already done.`);
  }

  private saveState(force = false) {
    if (!force && Date.now() - this.lastStateSave < 5000) return;
    this.lastStateSave = Date.now();
    const state: CrawlState = { frontier: this.frontier, linkQueue: this.linkQueue, startFinal: this.startFinal, shopify: this.shopify, elapsedMs: this.elapsed() };
    q.run('UPDATE scans SET crawl_state = ? WHERE id = ?', [JSON.stringify(state), this.scan.id]);
  }

  private elapsed() {
    return this.elapsedBefore + (Date.now() - this.startedAt);
  }

  private shouldStop(): boolean {
    if (this.stopFlag) return true;
    if (Date.now() - this.stopChecked > 1500) {
      this.stopChecked = Date.now();
      this.stopFlag = Number(q.value('SELECT stop_requested FROM scans WHERE id = ?', [this.scan.id])) === 1;
    }
    return this.stopFlag;
  }

  // ── Robots ──────────────────────────────────────────────────────────────────
  private async loadRobots() {
    const robotsUrl = new URL('/robots.txt', this.startFinal).toString();
    const res = await fetchUrl(robotsUrl, this.fo);
    if (res.status === 200 && res.body) {
      const txt = res.body.toString('utf8');
      this.robots = robotsParser(robotsUrl, txt);
      this.robotsText = txt;
    } else {
      this.robotsMissing = res.status === 404 || res.status === 410;
    }
  }

  private robotsAllows(url: string): boolean {
    if (!this.robots) return true;
    return this.robots.isAllowed(url, 'SortSiteTools') !== false && this.robots.isAllowed(url, 'Googlebot') !== false;
  }

  // ── Crawl ───────────────────────────────────────────────────────────────────
  private enqueue(item: QueueItem): void {
    let url = this.normalizeUrl(item.url);
    if (!url) return;
    if (this.scope.shopify) url = shopifyCanonical(url);
    if (this.seen.has(url)) return;
    if (isBlocked(url, this.scope)) {
      this.blockedByScanner.add(url);
      return;
    }
    if (!inCrawlScope(url, this.scope) || isPageBlocked(url, this.scope)) {
      this.queueLinkCheck(url);
      return;
    }
    if (this.scan.scope === 'page' && item.depth > 0) return this.queueLinkCheck(url);
    if (this.scan.scope === 'page-links' && item.depth > 1) return this.queueLinkCheck(url);
    if (this.o.links.depthMode === 'limited' && item.depth > this.o.links.maxDepth) return this.queueLinkCheck(url);
    if (this.o.blocks.obeyRobots && !this.robotsAllows(url)) {
      this.robotsBlocked.add(url);
      return;
    }
    if (classify(url).subtype !== 'HTML' && classify(url).subtype !== 'PDF') return this.queueLinkCheck(url);
    this.seen.add(url);
    this.frontier.push({ ...item, url });
  }

  private queueLinkCheck(url: string) {
    if (this.linkSeen.has(url) || this.seen.has(url)) return;
    if (isBlocked(url, this.scope)) {
      this.blockedByScanner.add(url);
      return;
    }
    if (!isInternal(url, this.scope) && this.o.links.externalMode === 'first') {
      const host = new URL(url).hostname;
      const n = this.externalPerHost.get(host) ?? 0;
      if (n >= this.o.links.externalFirstN) return;
      this.externalPerHost.set(host, n + 1);
    }
    this.linkSeen.add(url);
    this.linkQueue.push(url);
  }

  private async crawl() {
    const workers = Math.max(1, Math.min(config.pageConcurrency, this.fo.throttle.limit + 1));
    let inFlight = 0;
    await new Promise<void>((resolve) => {
      const pump = () => {
        if (this.shouldStop()) {
          if (inFlight === 0) resolve();
          return;
        }
        while (inFlight < workers && this.frontier.length && this.pagesDone + inFlight < this.maxPages) {
          const item = this.frontier.shift()!;
          inFlight++;
          this.processUrl(item)
            .catch((e) => console.error(`[scan ${this.scan.id}] ${item.url}`, e))
            .finally(() => {
              inFlight--;
              this.saveState();
              pump();
            });
        }
        if (inFlight === 0 && (!this.frontier.length || this.pagesDone >= this.maxPages)) {
          this.skippedForLimit = this.frontier.filter((f) => classify(f.url).subtype === 'HTML').length;
          resolve();
        }
      };
      pump();
    });
    this.saveState(true);
  }

  private async processUrl(item: QueueItem) {
    const t0 = Date.now();
    this.setCurrent(item.url);
    const res = await fetchUrl(item.url, this.fo);
    const ct = (res.contentType ?? '').toLowerCase();
    const finalUrl = this.normalizeUrl(res.finalUrl) ?? item.url;
    this.recordResource(item.url, res, classify(item.url, ct));

    if (item.seed && res.status !== 200) return; // optional Shopify seeds that do not exist on this store
    if (finalUrl !== item.url && this.seen.has(finalUrl) && item.depth > 0) return; // redirect onto a page already queued
    if (finalUrl !== item.url && !inCrawlScope(finalUrl, this.scope)) return; // redirected off-site: link-checked only

    if (res.status === null || res.status >= 400) {
      if (res.status !== null && res.status >= 500 && item.depth === 0) {
        const pageId = this.insertPage(item, finalUrl, res, null, null);
        this.insertFindings(pageId, [{ ruleId: 'errors.server-error', detail: `HTTP ${res.status}` }]);
      } else if (res.timedOut && item.depth === 0) {
        const pageId = this.insertPage(item, finalUrl, res, null, null);
        this.insertFindings(pageId, [{ ruleId: 'errors.timeout', detail: res.error }]);
      }
      if (item.depth === 0 && res.status === null) throw new Error(`Start page could not be loaded: ${res.error}`);
      return;
    }

    if (ct.includes('application/pdf') || classify(finalUrl, ct).subtype === 'PDF') {
      if (this.o.rules.accessibility.enabled && this.o.rules.accessibility.pdfStandards && res.body) {
        const findings = pdfAnalyzer(res.body);
        const pageId = this.insertPage(item, finalUrl, res, null, null);
        this.insertFindings(pageId, findings);
      }
      return;
    }
    if (!ct.includes('html') || !res.body) return;

    this.pagesDone++;
    const raw = decodeBody(res.body, ct);
    const isHome = item.depth === 0;
    let rendered: RenderResult | null = null;
    if (this.chromeOk) {
      rendered = await renderPage(finalUrl, {
        domMode: this.o.reports.domMode,
        timeoutMs: this.o.crawler.pageTimeoutMs,
        authHeaders: this.fo.headers,
        authHosts: this.scope.allowedHosts,
        cookies: this.fo.jar.entries(),
        rawHtml: raw,
        axeTags: this.axeTags,
        axeDisabledRules: this.axeDisabled,
        wantScreenshot: isHome,
        usability: this.o.rules.usability.enabled && this.o.rules.usability.bestPractices,
        cssTechniques: this.o.rules.accessibility.enabled,
        cssCache: this.cssCache,
      });
      if (rendered.error) {
        console.warn(`[scan ${this.scan.id}] render failed for ${finalUrl}: ${rendered.error}`);
        this.diag('render-failed', `Could not render in Chrome (static checks only): ${rendered.error.slice(0, 160)}`, finalUrl);
        rendered = null;
      }
    }

    const $raw = loadWithLocations(raw);
    const $dom = rendered?.html ? loadWithLocations(rendered.html) : $raw;
    const ctx: PageContext = {
      url: item.url,
      finalUrl,
      status: res.status,
      headers: res.headers,
      raw,
      src: new SourceMap(raw),
      $raw,
      $dom,
      rendered,
      renderFailed: this.chromeOk && !rendered,
      options: this.o,
      shopify: this.shopify,
      isHome,
      text: visibleText($dom),
      redirects: res.redirects,
    };

    const findings: Finding[] = [];
    for (const analyzer of [accessibilityAnalyzer, errorsAnalyzer, standardsAnalyzer, usabilityAnalyzer, compatibilityAnalyzer]) {
      try {
        findings.push(...(await analyzer(ctx)));
      } catch (e) {
        console.error(`[scan ${this.scan.id}] analyzer failed on ${finalUrl}`, e);
      }
    }
    findings.push(...searchAnalyzer(ctx, this.facts));
    findings.push(...this.brokenAnchors(ctx));

    const title = ($dom('head title').first().text() || $raw('title').first().text()).replace(/\s+/g, ' ').trim().slice(0, 300);
    const pageId = this.insertPage(item, finalUrl, res, rendered, { title, words: ctx.text.split(/\s+/).filter(Boolean).length });
    this.insertFindings(pageId, findings);
    for (const f of findings) {
      if (f.ruleId === 'errors.spelling' && f.detail) {
        const word = /^"([^"]+)"/.exec(f.detail)?.[1];
        if (word) {
          const set = this.spellingWords.get(word.toLowerCase()) ?? new Set<number>();
          set.add(pageId);
          this.spellingWords.set(word.toLowerCase(), set);
        }
      }
    }

    if (rendered?.screenshot) {
      const file = path.join(config.screenshotsDir, `scan-${this.scan.id}.jpg`);
      fs.writeFileSync(file, rendered.screenshot);
      const rel = `/media/screenshots/scan-${this.scan.id}.jpg`;
      q.run('UPDATE scans SET thumbnail = ? WHERE id = ?', [rel, this.scan.id]);
      q.run('UPDATE sites SET thumbnail = ? WHERE id = ?', [rel, this.scan.site_id]);
    }

    // Outbound references: links (crawl candidates) and embedded resources (inventory + status).
    this.collectRefs(ctx, pageId, item);
    for (const r of rendered?.resources ?? []) {
      const u = this.normalizeUrl(r.url);
      if (!u || this.linkSeen.has(u) || this.seen.has(u)) continue;
      this.linkSeen.add(u);
      this.recordResourceRaw(u, r.status, r.bytes, r.mime, isInternal(u, this.scope), null, null, null);
    }

    const ms = Date.now() - t0;
    this.avgMs = this.avgMs ? this.avgMs * 0.8 + ms * 0.2 : ms;
    this.emitProgress();
  }

  private brokenAnchors(ctx: PageContext): Finding[] {
    const out: Finding[] = [];
    const ids = new Set<string>();
    ctx.$dom('[id],a[name]').each((_, el) => {
      const $el = ctx.$dom(el);
      const id = $el.attr('id') ?? $el.attr('name');
      if (id) ids.add(id);
    });
    ctx.$raw('a[href^="#"]').each((_, el) => {
      const frag = decodeURIComponent((ctx.$raw(el).attr('href') ?? '').slice(1));
      if (!frag || frag === 'top' || frag.startsWith('!') || frag.startsWith('/') || ids.has(frag)) return;
      out.push({ ruleId: 'errors.broken-anchor', line: lineOf(el), snippet: snippetOf(ctx.$raw, el), detail: `#${frag}` });
    });
    return out.slice(0, 20);
  }

  private collectRefs(ctx: PageContext, pageId: number, item: QueueItem) {
    const refs: { url: string; kind: 'link' | 'resource'; line: number | null; snippet: string }[] = [];
    const base = ctx.$raw('base[href]').attr('href') ?? ctx.finalUrl;
    const add = (href: string | undefined, kind: 'link' | 'resource', el: Parameters<typeof lineOf>[0], $ = ctx.$raw) => {
      if (!href || /^(mailto|tel|javascript|data|sms|whatsapp|blob|about):/i.test(href.trim()) || href.trim().startsWith('#')) return;
      const u = this.normalizeUrl(href.trim(), safeBase(base, ctx.finalUrl));
      if (!u) return;
      refs.push({ url: this.scope.shopify ? shopifyCanonical(u) : u, kind, line: $ === ctx.$raw ? lineOf(el) : null, snippet: el ? snippetOf($, el, 240) : '' });
    };
    ctx.$raw('a[href], area[href]').each((_, el) => add(ctx.$raw(el).attr('href'), 'link', el));
    // Links injected by JavaScript (menus, product grids) only exist in the rendered DOM.
    if (ctx.$dom !== ctx.$raw) {
      const rawHrefs = new Set(refs.map((r) => r.url));
      ctx.$dom('a[href]').each((_, el) => {
        const href = ctx.$dom(el).attr('href');
        const u = href ? this.normalizeUrl(href, ctx.finalUrl) : null;
        if (u && !rawHrefs.has(u)) add(href, 'link', el, ctx.$dom);
      });
    }
    ctx.$raw('link[rel~="stylesheet"][href], link[rel~="icon"][href], script[src], img[src], iframe[src], video[src], audio[src], source[src], embed[src], object[data]').each((_, el) => {
      const $el = ctx.$raw(el);
      add($el.attr('href') ?? $el.attr('src') ?? $el.attr('data'), 'resource', el);
    });
    ctx.$raw('img[srcset], source[srcset]').each((_, el) => {
      for (const part of (ctx.$raw(el).attr('srcset') ?? '').split(',').slice(0, 2)) add(part.trim().split(/\s+/)[0], 'resource', el);
    });

    const seenRef = new Set<string>();
    tx(() => {
      for (const r of refs) {
        const key = `${r.kind}|${r.url}`;
        if (seenRef.has(key)) continue;
        seenRef.add(key);
        q.run('INSERT INTO page_refs (scan_id, page_id, url, kind, line, snippet) VALUES (?,?,?,?,?,?)', [this.scan.id, pageId, r.url, r.kind, r.line, r.snippet]);
      }
    });
    for (const r of refs) {
      if (r.kind === 'link') this.enqueue({ url: r.url, depth: item.depth + 1, parent: ctx.finalUrl });
      else this.queueLinkCheck(r.url);
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  private insertPage(item: QueueItem, finalUrl: string, res: FetchResult, rendered: RenderResult | null, meta: { title: string; words: number } | null): number {
    const existing = q.get<{ id: number }>('SELECT id FROM scan_pages WHERE scan_id = ? AND url = ?', [this.scan.id, item.url]);
    if (existing) return existing.id;
    return q.run(
      'INSERT INTO scan_pages (scan_id, url, final_url, title, status, content_type, depth, parent_url, bytes, load_ms, word_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [this.scan.id, item.url, finalUrl, meta?.title ?? null, res.status, res.contentType ?? 'text/html', item.depth, item.parent, rendered?.totalBytes || res.bytes, rendered?.loadMs ?? res.elapsedMs, meta?.words ?? null],
    ).lastId;
  }

  insertFindings(pageId: number, findings: Finding[]) {
    const perRule = new Map<string, number>();
    const counts: Record<Severity, number> = { priority: 0, other: 0, warning: 0 };
    tx(() => {
      for (const f of findings) {
        const rule = getRule(f.ruleId);
        if (!rule) continue;
        if (!this.o.rules[rule.category].enabled) continue;
        const n = (perRule.get(f.ruleId) ?? 0) + 1;
        perRule.set(f.ruleId, n);
        if (n > MAX_OCCURRENCES_PER_RULE_PER_PAGE) continue;
        const severity = f.severity ?? rule.severity;
        counts[severity]++;
        q.run('INSERT INTO issues (scan_id, page_id, rule_id, category, severity, line, snippet, selector, detail) VALUES (?,?,?,?,?,?,?,?,?)', [
          this.scan.id,
          pageId,
          rule.id,
          rule.category,
          severity,
          f.line ?? null,
          f.snippet?.slice(0, 1000) ?? null,
          f.selector?.slice(0, 500) ?? null,
          f.detail?.slice(0, 1000) ?? null,
        ]);
      }
      q.run('UPDATE scan_pages SET priority_count = priority_count + ?, other_count = other_count + ?, warning_count = warning_count + ? WHERE id = ?', [counts.priority, counts.other, counts.warning, pageId]);
    });
  }

  private recordResource(url: string, res: FetchResult, cls: ReturnType<typeof classify>) {
    this.recordResourceRaw(url, res.status, res.bytes, res.contentType, isInternal(url, this.scope), res.headers['cache-control'] ?? null, res.headers.server ?? null, res.error, cls);
  }

  private recordResourceRaw(url: string, status: number | null, bytes: number, contentType: string | null, internal: boolean, cache: string | null, server: string | null, error: string | null, cls = classify(url, contentType)) {
    q.run(
      `INSERT INTO scan_resources (scan_id, url, kind, subtype, status, bytes, internal, cache_control, server, error) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scan_id, url) DO UPDATE SET status = excluded.status, bytes = excluded.bytes, cache_control = excluded.cache_control, server = excluded.server, error = excluded.error`,
      [this.scan.id, url, cls.kind, cls.subtype, status, bytes, internal ? 1 : 0, cache, server, error],
    );
  }

  private diag(code: string, message: string, url: string | null = null, detail: string | null = null) {
    q.run('INSERT INTO diagnostics (scan_id, code, message, url, detail) VALUES (?,?,?,?,?)', [this.scan.id, code, message, url, detail]);
  }

  // ── Link checking ───────────────────────────────────────────────────────────
  private async checkLinks() {
    const concurrency = 8;
    let i = 0;
    // On a resume, links checked before the interruption still count towards progress.
    const before = Number(q.value('SELECT links_done FROM scans WHERE id = ?', [this.scan.id]) ?? 0);
    let done = before;
    const total = before + this.linkQueue.length;
    q.run('UPDATE scans SET links_total = ?, links_done = ?, links_started_at = COALESCE(links_started_at, ?) WHERE id = ?', [total, done, nowIso(), this.scan.id]);
    this.setCurrent(`Checking links (${done} of ${total})`);
    this.emitProgress(true);
    const budgetMs = this.o.crawler.pageTimeoutMs + 30_000;
    const worker = async () => {
      while (i < this.linkQueue.length && !this.shouldStop()) {
        const url = this.linkQueue[i++]!;
        try {
          // Hard per-link budget: a server that never answers can't hold up the whole scan.
          await withTimeout(this.checkOne(url), budgetMs);
        } catch {
          this.recordResourceRaw(url, null, 0, null, isInternal(url, this.scope), null, null, `Timed out after ${Math.round(budgetMs / 1000)}s`);
        }
        done++;
        if (done % 5 === 0 || done === total) {
          q.run('UPDATE scans SET links_done = ? WHERE id = ?', [done, this.scan.id]);
          this.setCurrent(`Checking links (${done} of ${total})`);
          this.emitProgress();
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    q.run('UPDATE scans SET links_done = ? WHERE id = ?', [done, this.scan.id]);
  }

  private async checkOne(url: string) {
    const internal = isInternal(url, this.scope);
    const fo = internal ? this.fo : this.externalFoFor(url);
    let res = await fetchUrl(url, fo, 'HEAD', false);
    // Many servers mishandle HEAD — confirm failures with GET (pointless for rate limits).
    if ((res.status === null && !res.timedOut) || (res.status !== null && res.status >= 400 && res.status !== 429)) res = await fetchUrl(url, fo, 'GET', true);
    this.recordResource(url, { ...res, body: null }, classify(url, res.contentType));
    if (internal && res.body && (res.contentType ?? '').includes('text/css') && this.o.rules.standards.enabled && !isShopifyAppAsset(url)) {
      await this.analyzeCss(url, res);
    }
  }

  private externalFoFor(url: string): FetcherOptions {
    const host = new URL(url).hostname;
    let t = this.externalThrottles.get(host);
    if (!t) {
      t = new Throttle({ limit: 2, delayMs: 0, maxDelayMs: 3000 });
      this.externalThrottles.set(host, t);
    }
    return { ...this.externalFo, throttle: t };
  }

  private async analyzeCss(url: string, res: FetchResult) {
    const css = res.body!.toString('utf8');
    const findings: Finding[] = [];
    if (this.o.rules.standards.validateCss) findings.push(...validateCss(css));
    if (this.o.rules.compatibility.enabled) findings.push(...checkCssCompat(cssFeatures(css), this.o.rules.compatibility.browsers));
    if (!findings.length) return;
    const pageId = this.insertPage({ url, depth: 99, parent: null }, url, { ...res, contentType: 'text/css' }, null, { title: url.split('/').pop()?.split('?')[0] ?? url, words: 0 });
    this.insertFindings(pageId, findings);
  }

  // ── Site-level checks (need the whole crawl) ────────────────────────────────
  private async siteLevelChecks() {
    this.setCurrent('Analysing site-wide results');
    this.emitProgress(true);
    const scanId = this.scan.id;
    const pageIdOf = (url: string) => q.get<{ id: number }>('SELECT id FROM scan_pages WHERE scan_id = ? AND url = ?', [scanId, url])?.id;
    const homeId = pageIdOf(this.startFinal) ?? q.get<{ id: number }>('SELECT id FROM scan_pages WHERE scan_id = ? ORDER BY id LIMIT 1', [scanId])?.id;

    // Broken links and resources → issues on every referring page, with line numbers.
    if (this.o.rules.errors.enabled) {
      const broken = q.all<{ page_id: number; url: string; kind: 'link' | 'resource'; line: number | null; snippet: string | null; status: number | null; error: string | null }>(
        `SELECT pr.page_id, pr.url, pr.kind, pr.line, pr.snippet, r.status, r.error FROM page_refs pr
           JOIN scan_resources r ON r.scan_id = pr.scan_id AND r.url = pr.url
          WHERE pr.scan_id = ? AND ${BROKEN_SQL}`,
        [scanId],
      );
      const byPage = new Map<number, Finding[]>();
      for (const b of broken) {
        const list = byPage.get(b.page_id) ?? [];
        list.push({ ruleId: b.kind === 'link' ? 'errors.broken-link' : 'errors.broken-resource', line: b.line, snippet: b.snippet, detail: `${b.url} → ${b.status ?? b.error}` });
        byPage.set(b.page_id, list);
      }
      for (const [pageId, list] of byPage) this.insertFindings(pageId, list);
    }

    if (this.o.rules.search.enabled) {
      const byTitle = new Map<string, string[]>();
      const byDesc = new Map<string, string[]>();
      for (const [url, f] of this.facts) {
        if (f.noindex) continue;
        if (f.title) byTitle.set(f.title.toLowerCase(), [...(byTitle.get(f.title.toLowerCase()) ?? []), url]);
        if (f.description) byDesc.set(f.description.toLowerCase(), [...(byDesc.get(f.description.toLowerCase()) ?? []), url]);
      }
      const dupes = (map: Map<string, string[]>, ruleId: string, label: string) => {
        for (const urls of map.values()) {
          if (urls.length < 2) continue;
          for (const u of urls) {
            const id = pageIdOf(u);
            if (id) this.insertFindings(id, [{ ruleId, detail: `${label} shared with ${urls.length - 1} other page${urls.length > 2 ? 's' : ''}: ${urls.filter((x) => x !== u).slice(0, 3).join(', ')}` }]);
          }
        }
      };
      if (this.o.rules.search.engines.includes('google')) {
        dupes(byTitle, 'search.title-duplicate', 'Title');
        dupes(byDesc, 'search.description-duplicate', 'Description');
      }
      if (this.o.rules.search.robotsGuidelines && homeId) {
        if (this.robotsMissing) this.insertFindings(homeId, [{ ruleId: 'search.robots-missing' }]);
        else if (this.robotsText && !/^\s*sitemap\s*:/im.test(this.robotsText)) this.insertFindings(homeId, [{ ruleId: 'search.robots-no-sitemap' }]);
        for (const url of [...this.robotsBlocked].slice(0, 200)) {
          const refs = q.all<{ page_id: number; line: number | null; snippet: string | null }>("SELECT page_id, line, snippet FROM page_refs WHERE scan_id = ? AND url = ? AND kind = 'link' LIMIT 20", [scanId, url]);
          for (const r of refs) this.insertFindings(r.page_id, [{ ruleId: 'search.robots-blocked', line: r.line, snippet: r.snippet, detail: url }]);
        }
      }
      // Canonical targets that are broken.
      for (const [url, f] of this.facts) {
        if (!f.canonical || f.canonical === url) continue;
        const target = q.get<{ status: number | null }>('SELECT status FROM scan_resources WHERE scan_id = ? AND url = ?', [scanId, this.normalizeUrl(f.canonical) ?? f.canonical]);
        if (target?.status && target.status >= 300) {
          const id = pageIdOf(url);
          if (id) this.insertFindings(id, [{ ruleId: 'search.canonical-invalid', detail: `${f.canonical} → ${target.status}` }]);
        }
      }
    }

    if (this.o.rules.usability.enabled && this.o.rules.usability.bestPractices && homeId && this.scan.scope === 'site') {
      const origin = new URL(this.startFinal).origin;
      const homeHasIcon = Number(q.value("SELECT COUNT(*) FROM page_refs WHERE page_id = ? AND kind = 'resource' AND (snippet LIKE '%rel=\"icon%' OR snippet LIKE '%rel=\"shortcut icon%' OR snippet LIKE '%rel=icon%')", [homeId])) > 0;
      if (!homeHasIcon) {
        const fav = await fetchUrl(`${origin}/favicon.ico`, this.fo, 'HEAD', false);
        if (!fav.status || fav.status >= 400) this.insertFindings(homeId, [{ ruleId: 'usability.no-favicon' }]);
      }
      const probe = await fetchUrl(`${origin}/sortsite-check-${Date.now().toString(36)}`, this.fo);
      if (probe.status === 200) {
        if (this.o.rules.errors.enabled) this.insertFindings(homeId, [{ ruleId: 'errors.soft-404', detail: `A made-up address (${probe.url}) returned status 200.` }]);
      } else if (probe.status === 404 && probe.body && !/<a\s[^>]*href/i.test(probe.body.toString('utf8'))) {
        this.insertFindings(homeId, [{ ruleId: 'usability.no-custom-404', detail: 'The 404 page has no links back into the site.' }]);
      }
    }

    // Smart dictionary: words used on many pages are brand/product names, not typos.
    const pages = Math.max(1, this.pagesDone);
    const brandWords = [...this.spellingWords].filter(([, set]) => set.size >= Math.max(3, pages * 0.3)).map(([w]) => w);
    if (brandWords.length) {
      tx(() => {
        for (const w of brandWords) {
          const rows = q.all<{ id: number; page_id: number; severity: Severity }>("SELECT id, page_id, severity FROM issues WHERE scan_id = ? AND rule_id = 'errors.spelling' AND lower(detail) LIKE ?", [scanId, `"${w}"%`]);
          for (const r of rows) {
            q.run('DELETE FROM issues WHERE id = ?', [r.id]);
            q.run(`UPDATE scan_pages SET ${r.severity}_count = MAX(0, ${r.severity}_count - 1) WHERE id = ?`, [r.page_id]);
          }
        }
      });
      this.diag('spelling-brand-words', `Ignored ${brandWords.length} word(s) used across many pages as likely brand or product names: ${brandWords.slice(0, 20).join(', ')}`);
    }
    this.buildDiagnostics();
  }

  private buildDiagnostics() {
    const id = this.scan.id;
    const home = q.get<{ server: string | null; cache_control: string | null }>("SELECT server, cache_control FROM scan_resources WHERE scan_id = ? AND url = ?", [id, this.startFinal]);
    if (home?.server) this.diag('server-info', `Web server: ${home.server}`, this.startFinal);
    const noCacheCss = q.all<{ url: string }>("SELECT url FROM scan_resources WHERE scan_id = ? AND internal = 1 AND subtype IN ('CSS','JavaScript') AND (cache_control IS NULL OR cache_control NOT LIKE '%max-age%')", [id]);
    for (const r of noCacheCss.slice(0, 200)) this.diag('cache-static', 'CSS/JavaScript served without a max-age cache header', r.url);
    const htmlNoCache = q.all<{ url: string }>("SELECT url FROM scan_resources WHERE scan_id = ? AND internal = 1 AND subtype = 'HTML' AND cache_control IS NULL", [id]);
    for (const r of htmlNoCache.slice(0, 200)) this.diag('cache-html', 'HTML page without a Cache-Control header', r.url);
    for (const u of [...this.robotsBlocked].slice(0, 500)) this.diag('robots-blocked', 'Link not followed: blocked by robots.txt', u);
    for (const u of [...this.blockedByScanner].slice(0, 500)) this.diag('scanner-blocked', 'Link not checked: matches a blocked-links pattern in scan options', u);
    const internalLinks = Number(q.value("SELECT COUNT(DISTINCT pr.url) FROM page_refs pr JOIN scan_resources r ON r.scan_id = pr.scan_id AND r.url = pr.url WHERE pr.scan_id = ? AND pr.kind = 'link' AND r.internal = 1", [id]));
    const externalLinks = Number(q.value("SELECT COUNT(DISTINCT pr.url) FROM page_refs pr JOIN scan_resources r ON r.scan_id = pr.scan_id AND r.url = pr.url WHERE pr.scan_id = ? AND pr.kind = 'link' AND r.internal = 0", [id]));
    this.diag('link-counts', `${internalLinks} internal and ${externalLinks} external link targets checked`);
    if (this.fo.throttle.rateLimitedHits + this.externalFo.throttle.rateLimitedHits > 0) {
      this.diag('rate-limited', `The server asked the scanner to slow down ${this.fo.throttle.rateLimitedHits} time(s) (HTTP 429/503); the crawl rate was reduced automatically.`);
    }
    for (const r of q.all<{ url: string; status: number }>("SELECT url, status FROM scan_resources WHERE scan_id = ? AND status BETWEEN 300 AND 399", [id]).slice(0, 300)) this.diag('unexpected-status', `Unexpected status code ${r.status}`, r.url);
    for (const r of q.all<{ url: string; status: number | null; error: string | null; internal: number }>('SELECT url, status, error, internal FROM scan_resources WHERE scan_id = ? AND (status >= 400 OR (status IS NULL AND error IS NOT NULL))', [id]).slice(0, 800)) {
      const verdict = linkVerdict(r.status, r.error, !!r.internal);
      if (verdict === 'broken') this.diag('broken-link', `Broken: ${r.status ?? r.error}`, r.url);
      else if (r.status === 403) this.diag('forbidden-403', '403 Forbidden response — the site may be blocking automated checks, so the link could not be verified (allowlist the scanner IP addresses if this is your site)', r.url);
      else this.diag('unverified-link', `Could not verify (${r.status ?? r.error}) — rate limiting or bot protection; not reported as broken`, r.url);
    }
    if (this.skippedForLimit > 0) this.diag('page-limit', `Page limit of ${this.maxPages} reached; ${this.skippedForLimit} more pages were found but not scanned.`);
    if (!this.chromeOk) this.diag('no-chrome', 'Google Chrome was not found, so pages were checked without rendering JavaScript (contrast and rendered-DOM checks skipped).');
  }

  private async finish(status: 'completed' | 'stopped') {
    const stats = computeStats(this.scan.id, this.o);
    const disk = estimateDisk(this.scan.id);
    q.run(
      `UPDATE scans SET status = ?, finished_at = ?, current_url = NULL, pages_found = MAX(pages_found, ?), pages_done = ?, pages_checked = ?, files_checked = ?, rules_checked = ?,
        issue_pct = ?, priority_pct = ?, other_pct = ?, compliance_score = ?, stats_json = ?, disk_bytes = ?, crawl_state = ? WHERE id = ?`,
      [
        status,
        nowIso(),
        this.pagesDone,
        this.pagesDone,
        stats.pagesChecked,
        stats.filesChecked,
        stats.rulesChecked,
        stats.issuePct,
        stats.priorityPct,
        stats.otherPct,
        stats.complianceScore,
        JSON.stringify(stats),
        disk,
        status === 'stopped' ? JSON.stringify({ frontier: this.frontier, linkQueue: this.linkQueue, startFinal: this.startFinal, shopify: this.shopify, elapsedMs: this.elapsed() }) : null,
        this.scan.id,
      ],
    );
    this.emitProgress(true);
    bus.emitEvent({ type: 'scan.finished', accountId: this.accountId, scanId: this.scan.id, siteId: this.scan.site_id, status });
    await afterScanFinished(this.scan.id);
  }

  // ── Progress ────────────────────────────────────────────────────────────────
  private setCurrent(url: string) {
    q.run('UPDATE scans SET current_url = ? WHERE id = ?', [url.slice(0, 500), this.scan.id]);
  }

  emitProgress(force = false) {
    if (!force && Date.now() - this.lastEmit < 800) return;
    this.lastEmit = Date.now();
    const found = Math.min(this.maxPages, this.pagesDone + this.frontier.filter((f) => classify(f.url).subtype === 'HTML').length);
    q.run('UPDATE scans SET pages_found = ?, pages_done = ? WHERE id = ?', [found, this.pagesDone, this.scan.id]);
    bus.emitEvent({ type: 'scan.progress', accountId: this.accountId, progress: progressOf(this.scan.id, this.avgMs) });
  }
}

/** axe rules PowerMapper/SortSite does not test; skipped in PowerMapper compatibility mode so results line up. */
const POWERMAPPER_SKIPPED_AXE_RULES = ['list', 'listitem', 'target-size'];

function allAriaRuleIds(): string[] {
  return q.all<{ id: string }>("SELECT id FROM rules WHERE id LIKE 'axe.aria-%'").map((r) => r.id.slice(4));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function decodeBody(buf: Buffer, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1];
  const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function safeBase(base: string, fallback: string): string {
  try {
    return new URL(base, fallback).toString();
  } catch {
    return fallback;
  }
}

/** Approximate storage for quota accounting: rows × typical size + stored files. */
export function estimateDisk(scanId: number): number {
  const issues = Number(q.value('SELECT COALESCE(SUM(LENGTH(COALESCE(snippet,\'\')) + LENGTH(COALESCE(detail,\'\')) + LENGTH(COALESCE(selector,\'\')) + 64), 0) FROM issues WHERE scan_id = ?', [scanId]));
  const pages = Number(q.value('SELECT COALESCE(SUM(LENGTH(url) + LENGTH(COALESCE(title,\'\')) + 96), 0) FROM scan_pages WHERE scan_id = ?', [scanId]));
  const resources = Number(q.value('SELECT COALESCE(SUM(LENGTH(url) + 64), 0) FROM scan_resources WHERE scan_id = ?', [scanId]));
  const refs = Number(q.value('SELECT COALESCE(SUM(LENGTH(url) + LENGTH(COALESCE(snippet,\'\')) + 32), 0) FROM page_refs WHERE scan_id = ?', [scanId]));
  const shot = path.join(config.screenshotsDir, `scan-${scanId}.jpg`);
  const exports = Number(q.value('SELECT COALESCE(SUM(bytes), 0) FROM report_exports WHERE scan_id = ?', [scanId]));
  return issues + pages + resources + refs + (fs.existsSync(shot) ? fs.statSync(shot).size : 0) + exports;
}

export function progressOf(scanId: number, avgMs = 0): ScanProgress {
  const s = q.get<{ id: number; site_id: number; status: ScanStatus; pages_found: number; pages_done: number; current_url: string | null; started_at: string | null; links_total: number; links_done: number; links_started_at: string | null }>(
    'SELECT id, site_id, status, pages_found, pages_done, current_url, started_at, links_total, links_done, links_started_at FROM scans WHERE id = ?',
    [scanId],
  )!;
  const running = s.status === 'running';
  const finishing = running && (s.current_url ?? '').startsWith('Analysing site-wide');
  const phase: ScanProgress['phase'] = s.status === 'queued' ? 'queued' : !running ? 'done' : finishing ? 'finishing' : s.links_total > 0 ? 'links' : 'crawl';
  // Progress is split across phases so the bar keeps moving: pages 0–80%, links 80–98%, site-wide 98–99%.
  const target = Math.max(s.pages_found, s.pages_done, 1);
  let percent: number;
  let eta: number | null = null;
  if (phase === 'crawl') {
    percent = Math.round((s.pages_done / target) * 80);
    const elapsed = s.started_at ? Date.now() - Date.parse(s.started_at) : 0;
    const perPage = s.pages_done ? elapsed / s.pages_done : avgMs;
    if (perPage) eta = Math.round(((target - s.pages_done) * perPage) / 1000 + 30);
  } else if (phase === 'links') {
    percent = 80 + Math.round((s.links_done / Math.max(1, s.links_total)) * 18);
    const elapsed = s.links_started_at ? Date.now() - Date.parse(s.links_started_at) : 0;
    if (s.links_done > 0 && elapsed > 0) eta = Math.round(((s.links_total - s.links_done) * elapsed) / s.links_done / 1000 + 10);
  } else if (phase === 'finishing') {
    percent = 99;
    eta = 15;
  } else {
    percent = s.status === 'completed' ? 100 : Math.min(99, Math.round((s.pages_done / target) * 100));
  }
  return {
    scanId: s.id,
    siteId: s.site_id,
    status: s.status,
    phase,
    pagesFound: s.pages_found,
    pagesDone: s.pages_done,
    linksTotal: s.links_total,
    linksDone: s.links_done,
    currentUrl: s.current_url,
    etaSeconds: running ? eta : null,
    percent: Math.max(0, Math.min(s.status === 'completed' ? 100 : 99, percent)),
    startedAt: s.started_at,
  };
}
