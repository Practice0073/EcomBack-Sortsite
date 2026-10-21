import fs from 'node:fs';
import puppeteer, { type Browser, type Page, type HTTPRequest } from 'puppeteer-core';
import axeCore from 'axe-core';
import { config } from '../config.js';
import { runCssTechniques, unreadableStylesheets, type CssFinding } from './cssTechniques.js';
import type { DomMode, ScanOptions } from '../../shared/options.js';

let browserPromise: Promise<Browser> | null = null;
/** Set by closeBrowser(): this thread is finishing, so no new Chrome may be launched (it would be orphaned). */
let closed = false;

const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((fn) => fn);';

export const browserAvailable = () => config.chromePath !== null;

export async function getBrowser(): Promise<Browser> {
  if (!config.chromePath) throw new Error('Chrome not found');
  if (closed) throw new Error('Browser is shut down');
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.connected) return b;
  }
  browserPromise = puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    acceptInsecureCerts: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--hide-scrollbars'],
  });
  const b = await browserPromise;
  // A dropped connection (e.g. after the computer sleeps) can leave Chrome running with the scan's open
  // pages; end that process so the next getBrowser() starts clean instead of leaking a Chrome.
  b.on('disconnected', () => {
    browserPromise = null;
    const proc = b.process();
    if (proc && proc.exitCode === null && !proc.killed) proc.kill('SIGKILL');
  });
  return b;
}

/** Final close for this thread (end of scan, worker or server shutdown); later getBrowser() calls fail. */
export async function closeBrowser() {
  closed = true;
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => undefined);
}

export interface AxeNode { html: string; target: string; failureSummary?: string; impact?: string | null }
export interface AxeRuleResult { id: string; impact: string | null; tags: string[]; nodes: AxeNode[] }
export interface NetResource { url: string; status: number; type: string; bytes: number; mime: string }

export interface RenderResult {
  html: string;
  finalUrl: string;
  title: string;
  axe: { violations: AxeRuleResult[]; incomplete: AxeRuleResult[] } | null;
  resources: NetResource[];
  totalBytes: number;
  loadMs: number;
  smallText: { selector: string; snippet: string; size: number }[];
  horizontalScroll: { scrollWidth: number; culprit: string | null } | null;
  screenshot: Buffer | null;
  /** WCAG failure techniques that need the CSS cascade (F24, F78, 2.2.2 animations, F87). */
  cssFindings: CssFinding[];
  error: string | null;
}

export interface RenderOptions {
  domMode: DomMode;
  timeoutMs: number;
  authHeaders: Record<string, string>;
  authHosts: Set<string>;
  cookies: [string, string][];
  rawHtml: string | null; // used for DOM mode "none"
  axeTags: string[] | null; // null = accessibility disabled
  axeDisabledRules: string[];
  wantScreenshot: boolean;
  usability: boolean;
  /** Run the CSS-based accessibility techniques (needs accessibility enabled). */
  cssTechniques?: boolean;
  /** Per-scan cache of cross-origin stylesheet text, keyed by URL. */
  cssCache?: Map<string, Promise<string>>;
}

/** Map the scan's accessibility options to axe-core tags (Plan.md §7). */
export function axeTagsFor(a11y: ScanOptions['rules']['accessibility']): string[] {
  const levels = a11y.wcagLevel === 'A' ? ['a'] : a11y.wcagLevel === 'AA' ? ['a', 'aa'] : ['a', 'aa', 'aaa'];
  const versions = a11y.wcagVersion === '2.0' ? ['2'] : a11y.wcagVersion === '2.1' ? ['2', '21'] : ['2', '21', '22'];
  const tags = versions.flatMap((v) => levels.map((l) => `wcag${v}${l}`));
  tags.push('best-practice');
  if (a11y.usStandards) tags.push('section508');
  if (a11y.euStandards) tags.push('EN-301-549');
  return tags;
}

const stripScripts = (html: string) => html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');

/** Errors caused by the page navigating or reloading itself mid-analysis (JS redirects, consent walls). */
const TRANSIENT = /detached Frame|Execution context was destroyed|Target closed|Session closed|frame was detached/i;
/** Local network blips (Wi-Fi change, reset connection); worth retrying after a short pause. */
const NETWORK = /net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|INTERNET_DISCONNECTED|NETWORK_IO_SUSPENDED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE)/;

/** Render with retries: once for transient navigation errors, up to twice (3 s, 10 s apart) for network blips. */
export async function renderPage(url: string, ro: RenderOptions): Promise<RenderResult> {
  let result = await renderOnce(url, ro);
  if (result.error && TRANSIENT.test(result.error)) return renderOnce(url, ro);
  for (const waitMs of [3000, 10_000]) {
    if (!result.error || !NETWORK.test(result.error)) break;
    await new Promise((r) => setTimeout(r, waitMs));
    result = await renderOnce(url, ro);
  }
  return result;
}

async function renderOnce(url: string, ro: RenderOptions): Promise<RenderResult> {
  const browser = await getBrowser();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const started = Date.now();
  const resources = new Map<string, NetResource>();
  let totalBytes = 0;
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(config.userAgent);
    await page.setBypassCSP(true);
    page.setDefaultNavigationTimeout(ro.timeoutMs);

    const host = new URL(url).hostname;
    if (ro.cookies.length) {
      await browser.setCookie(...ro.cookies.map(([name, value]) => ({ name, value, domain: host, path: '/' })));
    }

    // Network accounting through CDP (encoded bytes = what actually crossed the wire).
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    const pending = new Map<string, { url: string; status: number; type: string; mime: string }>();
    cdp.on('Network.responseReceived', (e) => pending.set(e.requestId, { url: e.response.url, status: e.response.status, type: e.type, mime: e.response.mimeType }));
    cdp.on('Network.loadingFinished', (e) => {
      totalBytes += e.encodedDataLength;
      const r = pending.get(e.requestId);
      if (r && !r.url.startsWith('data:')) resources.set(r.url, { ...r, bytes: e.encodedDataLength });
    });

    // Interception: credentials only to the site's own hosts; DOM mode "none" serves the raw source without scripts.
    await page.setRequestInterception(true);
    let servedMain = false;
    page.on('request', (req: HTTPRequest) => {
      if (req.isInterceptResolutionHandled()) return;
      const reqHost = safeHost(req.url());
      const headers = { ...req.headers(), ...(reqHost && ro.authHosts.has(reqHost.replace(/^www\./, '')) ? ro.authHeaders : {}) };
      if (ro.domMode === 'none') {
        if (!servedMain && req.isNavigationRequest() && ro.rawHtml !== null) {
          servedMain = true;
          void req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: stripScripts(ro.rawHtml) });
          return;
        }
        if (req.resourceType() === 'script') return void req.abort('blockedbyclient');
      }
      void req.continue({ headers });
    });

    // The TS runtime (esbuild keepNames) wraps functions with a __name helper; define it in the page
    // so functions passed to page.evaluate run unchanged.
    await page.evaluateOnNewDocument(NAME_SHIM);
    await page.goto(url, { waitUntil: ro.domMode === 'smart' ? 'domcontentloaded' : 'load', timeout: ro.timeoutMs });
    await page.evaluate(NAME_SHIM);
    if (ro.domMode === 'smart') {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => undefined);
    } else if (ro.domMode === 'all') {
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 }).catch(() => undefined);
      await autoScroll(page);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => undefined);
    }
    const loadMs = Date.now() - started;

    const screenshot = ro.wantScreenshot ? Buffer.from(await page.screenshot({ type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: 1280, height: 800 } })) : null;

    let axeResult: RenderResult['axe'] = null;
    if (ro.axeTags) {
      await page.evaluate(axeCore.source);
      axeResult = await page.evaluate(
        async (tags: string[], disabled: string[]) => {
          const w = window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: unknown[]; incomplete: unknown[] }> } };
          const rules: Record<string, { enabled: boolean }> = {};
          for (const id of disabled) rules[id] = { enabled: false };
          const r = await w.axe.run(document, { runOnly: { type: 'tag', values: tags }, rules, resultTypes: ['violations', 'incomplete'], elementRef: false, xpath: false, ancestry: false });
          type N = { html: string; target: unknown[]; failureSummary?: string; impact?: string | null };
          type R = { id: string; impact: string | null; tags: string[]; nodes: N[] };
          const slim = (list: unknown[]) =>
            (list as R[]).map((x) => ({ id: x.id, impact: x.impact, tags: x.tags, nodes: x.nodes.slice(0, 60).map((n) => ({ html: n.html.slice(0, 600), target: n.target.map(String).join(' '), failureSummary: n.failureSummary?.slice(0, 600), impact: n.impact })) }));
          return { violations: slim(r.violations), incomplete: slim(r.incomplete) };
        },
        ro.axeTags,
        ro.axeDisabledRules,
      );
    }

    let cssFindings: CssFinding[] = [];
    if (ro.cssTechniques) {
      try {
        const hrefs = await unreadableStylesheets(page);
        const list = hrefs.slice(0, 40);
        const texts = await Promise.all(list.map((h) => cachedCss(h, ro.cssCache)));
        const names = list.map((h) => (h.split('?')[0] ?? h).split('/').pop() || h);
        cssFindings = await runCssTechniques(page, texts.filter(Boolean), names.filter((_, i) => !!texts[i]));
      } catch (e) {
        console.warn('[css techniques]', url, (e as Error).message);
      }
    }

    // Password fields hidden by CSS (e.g. inside a closed sign-up popup) are not checked for autocomplete,
    // matching PowerMapper; mark them in the snapshot so the DOM-based check can tell.
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('input[type=password]'))) {
        if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') el.setAttribute('data-ss-hidden', '');
      }
    });
    const html = await page.content();
    const title = await page.title();

    let smallText: RenderResult['smallText'] = [];
    let horizontalScroll: RenderResult['horizontalScroll'] = null;
    if (ro.usability) {
      await page.setViewport({ width: 375, height: 740, isMobile: true, hasTouch: true });
      await new Promise((r) => setTimeout(r, 250));
      const mobile = await page.evaluate(() => {
        const sel = (el: Element): string => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const parts: string[] = [];
          let cur: Element | null = el;
          while (cur && cur !== document.body && parts.length < 4) {
            const parent: Element | null = cur.parentElement;
            const idx = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName).indexOf(cur) + 1 : 1;
            parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
            cur = parent;
          }
          return parts.join(' > ');
        };
        const small: { selector: string; snippet: string; size: number }[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set<Element>();
        while (walker.nextNode() && small.length < 8) {
          const t = walker.currentNode.textContent?.trim();
          const el = walker.currentNode.parentElement;
          if (!t || t.length < 3 || !el || seen.has(el)) continue;
          seen.add(el);
          const cs = getComputedStyle(el);
          const size = parseFloat(cs.fontSize);
          const r = el.getBoundingClientRect();
          if (size < 12 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"],.visually-hidden,.sr-only')) {
            small.push({ selector: sel(el), snippet: el.outerHTML.slice(0, 300), size });
          }
        }
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        let culprit: string | null = null;
        if (sw > vw + 2) {
          for (const el of Array.from(document.body.querySelectorAll('*'))) {
            const r = el.getBoundingClientRect();
            if (r.right > vw + 2 && r.width > 0 && getComputedStyle(el).position !== 'fixed') {
              culprit = el.outerHTML.slice(0, 300);
              break;
            }
          }
        }
        const bodyOverflow = getComputedStyle(document.body).overflowX;
        const htmlOverflow = getComputedStyle(document.documentElement).overflowX;
        const clipped = ['hidden', 'clip'].includes(bodyOverflow) || ['hidden', 'clip'].includes(htmlOverflow);
        return { small, scroll: sw > vw + 2 && !clipped ? { scrollWidth: sw, culprit } : null };
      });
      smallText = mobile.small;
      horizontalScroll = mobile.scroll;
    }

    return { html, finalUrl: page.url(), title, axe: axeResult, resources: [...resources.values()], totalBytes, loadMs, smallText, horizontalScroll, screenshot, cssFindings, error: null };
  } catch (e) {
    return { html: '', finalUrl: url, title: '', axe: null, resources: [...resources.values()], totalBytes, loadMs: Date.now() - started, smallText: [], horizontalScroll: null, screenshot: null, cssFindings: [], error: (e as Error).message };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Fetch a cross-origin stylesheet once per scan (bounded size and time). */
function cachedCss(href: string, cache?: Map<string, Promise<string>>): Promise<string> {
  const hit = cache?.get(href);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(href, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok || !(res.headers.get('content-type') ?? 'text/css').includes('css')) return '';
      const text = await res.text();
      return text.length > 3_000_000 ? '' : text;
    } catch {
      return '';
    }
  })();
  cache?.set(href, p);
  return p;
}

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.9;
    for (let y = 0, i = 0; y < document.body.scrollHeight && i < 30; y += step, i++) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

/** Renders HTML to PDF (used by the report exporter). */
export async function htmlToPdf(html: string, outFile: string, footerLabel: string) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 15_000 }).catch(() => undefined);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#5b6170;padding:0 14mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif"><span>${footerLabel}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    fs.writeFileSync(outFile, pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Screenshot arbitrary HTML (used to rasterise the logo for email clients that block SVG). */
export async function screenshotHtml(html: string, width: number, height: number): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true }));
  } finally {
    await page.close().catch(() => undefined);
  }
}
