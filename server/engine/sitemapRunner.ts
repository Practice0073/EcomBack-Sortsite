import fs from 'node:fs';
import path from 'node:path';
import robotsParser from 'robots-parser';
import * as cheerio from 'cheerio';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { bus } from '../lib/events.js';
import { CookieJar, Throttle, fetchUrl } from './fetcher.js';
import { bareHost, compileBlockPatterns, normalizeUrl, SHOPIFY_BLOCKS, shopifyCanonical, classify } from './url.js';
import { parseSitemapOptions } from './sitemapService.js';
import { browserAvailable, renderPage } from './browser.js';

interface Item { url: string; depth: number; parent: string | null }

/** Builds a visual site map: a fast link-only crawl (no rule checks), recording the click-depth tree. */
export async function runSitemap(runId: number) {
  const run = q.get<{ id: number; sitemap_id: number }>('SELECT id, sitemap_id FROM sitemap_runs WHERE id = ?', [runId]);
  if (!run) return;
  const map = q.get<{ id: number; account_id: number; url: string; options_json: string }>('SELECT * FROM sitemaps WHERE id = ?', [run.sitemap_id]);
  if (!map) return;
  const o = parseSitemapOptions(map.options_json);
  const emit = (status: string, found: number, done: number, current: string | null) =>
    bus.emitEvent({ type: 'sitemap.progress', accountId: map.account_id, sitemapId: map.id, runId, status, pagesFound: found, pagesDone: done, currentUrl: current });

  try {
    q.run("UPDATE sitemap_runs SET status = 'running', started_at = COALESCE(started_at, ?), error = NULL WHERE id = ?", [nowIso(), runId]);
    const throttle = new Throttle('auto');
    const fo = { timeoutMs: 30_000, retries: 1, headers: {}, jar: new CookieJar(), throttle, authHosts: new Set<string>() };
    const first = await fetchUrl(map.url, fo);
    if (first.status === null) throw new Error(`Could not reach ${map.url}: ${first.error}`);
    const start = normalizeUrl(first.finalUrl) ?? map.url;
    const host = bareHost(new URL(start).hostname);
    fo.authHosts.add(host);
    const shopify = /cdn\.shopify\.com|Shopify\.theme/.test(first.body?.toString('utf8') ?? '') || !!first.headers['x-shopid'];
    const blocks = [...compileBlockPatterns(o.blocks), ...(shopify ? SHOPIFY_BLOCKS : [])];
    const folder = new URL(start).pathname.replace(/[^/]*$/, '');
    let robots: ReturnType<typeof robotsParser> | null = null;
    if (o.obeyRobots) {
      const r = await fetchUrl(new URL('/robots.txt', start).toString(), fo);
      if (r.status === 200 && r.body) robots = robotsParser(new URL('/robots.txt', start).toString(), r.body.toString('utf8'));
    }

    // A run interrupted by a restart is rebuilt from scratch — a map crawl is quick and must be complete.
    q.run('DELETE FROM sitemap_nodes WHERE run_id = ?', [runId]);
    {
      // Thumbnail of the home page for the list view.
      if (browserAvailable()) {
        const shot = await renderPage(start, { domMode: 'smart', timeoutMs: 30_000, authHeaders: {}, authHosts: new Set([host]), cookies: [], rawHtml: null, axeTags: null, axeDisabledRules: [], wantScreenshot: true, usability: false }).catch(() => null);
        if (shot?.screenshot) {
          fs.writeFileSync(path.join(config.screenshotsDir, `map-${map.id}.jpg`), shot.screenshot);
          q.run('UPDATE sitemaps SET thumbnail = ? WHERE id = ?', [`/media/screenshots/map-${map.id}.jpg`, map.id]);
        }
      }
    }

    const seen = new Set<string>([start]);
    const queue: Item[] = [{ url: start, depth: 0, parent: null }];
    let done = 0;
    let lastEmit = 0;

    const inScope = (u: string) => {
      const x = new URL(u);
      if (bareHost(x.hostname) !== host) return false;
      if (o.scope === 'folder' && !x.pathname.startsWith(folder)) return false;
      if (blocks.some((re) => re.test(u))) return false;
      if (robots && robots.isAllowed(u, 'SortSiteTools') === false) return false;
      return classify(u).subtype === 'HTML';
    };

    let inFlight = 0;
    const worker = async () => {
      for (;;) {
        if (done >= o.maxPages || Number(q.value('SELECT stop_requested FROM sitemap_runs WHERE id = ?', [runId]))) return;
        const item = queue.shift();
        if (!item) {
          if (inFlight === 0) return;
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        inFlight++;
        try {
        const res = await fetchUrl(item.url, fo);
        const ct = res.contentType ?? '';
        let title: string | null = null;
        if (res.body && ct.includes('html')) {
          const $ = cheerio.load(res.body.toString('utf8'));
          title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 300) || null;
          if (o.depthMode === 'entire' || item.depth < o.maxDepth) {
            $('a[href]').each((_, el) => {
              let u = normalizeUrl($(el).attr('href') ?? '', res.finalUrl);
              if (!u) return;
              if (shopify) u = shopifyCanonical(u);
              if (seen.has(u) || !inScope(u) || seen.size >= o.maxPages) return;
              seen.add(u);
              queue.push({ url: u, depth: item.depth + 1, parent: item.url });
            });
          }
        }
        q.run('INSERT OR IGNORE INTO sitemap_nodes (run_id, url, parent_url, title, status, depth, content_type, last_modified) VALUES (?,?,?,?,?,?,?,?)', [
          runId,
          item.url,
          item.parent,
          title,
          res.status,
          item.depth,
          ct.split(';')[0] || null,
          res.headers['last-modified'] ?? null,
        ]);
        done++;
        if (Date.now() - lastEmit > 700) {
          lastEmit = Date.now();
          q.run('UPDATE sitemap_runs SET pages_found = ?, pages_done = ?, current_url = ? WHERE id = ?', [seen.size, done, item.url, runId]);
          emit('running', seen.size, done, item.url);
        }
        } finally {
          inFlight--;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    const stopped = Number(q.value('SELECT stop_requested FROM sitemap_runs WHERE id = ?', [runId])) === 1;
    const disk = Number(q.value('SELECT COALESCE(SUM(LENGTH(url) + LENGTH(COALESCE(title, \'\')) + 64), 0) FROM sitemap_nodes WHERE run_id = ?', [runId]));
    const status = stopped ? 'stopped' : 'completed';
    q.run('UPDATE sitemap_runs SET status = ?, finished_at = ?, pages_found = ?, pages_done = ?, current_url = NULL, disk_bytes = ? WHERE id = ?', [status, nowIso(), seen.size, done, disk, runId]);
    emit(status, seen.size, done, null);
  } catch (e) {
    q.run("UPDATE sitemap_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", [nowIso(), (e as Error).message.slice(0, 500), runId]);
    emit('failed', 0, 0, null);
  }
}
