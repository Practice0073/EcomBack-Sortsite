import type { Finding } from '../rules/types.js';
import type { PageContext } from '../context.js';
import { lineOf, snippetOf } from '../source.js';

const GENERIC_LINK_TEXT = /^(click here|here|read more|more|learn more|this|link|continue|go|details|more info|view more|see more)$/i;
const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

export interface SearchFacts { title: string; description: string; noindex: boolean; canonical: string | null }

/** Per-page search checks. Site-level checks (duplicates, robots.txt) run in the scan finalizer. */
export function searchAnalyzer(ctx: PageContext, facts: Map<string, SearchFacts>): Finding[] {
  const o = ctx.options.rules.search;
  const $ = ctx.$dom; // post-JS DOM: search engines render JavaScript
  const $raw = ctx.$raw;
  const google = o.engines.includes('google');
  const bing = o.engines.includes('bing');
  const ddg = o.engines.includes('duckduckgo');
  const bp = o.bestPractices;
  const out: Finding[] = [];
  const at = (sel: string) => {
    const el = $raw(sel).get(0);
    return { line: lineOf(el), snippet: el ? snippetOf($raw, el) : null };
  };

  // `title`, not `head title`: an <img> or <div> inside <head> (tracking pixels, consent scripts) makes the
  // parser close <head> early and move the title into <body>, which read as "title missing" on every page.
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const description = ($('meta[name="description" i]').attr('content') ?? '').replace(/\s+/g, ' ').trim();
  const robotsMeta = `${$('meta[name="robots" i]').attr('content') ?? ''} ${ctx.headers['x-robots-tag'] ?? ''}`.toLowerCase();
  const noindex = robotsMeta.includes('noindex');
  const canonical = $('link[rel="canonical" i]').attr('href') ?? null;
  facts.set(ctx.url, { title, description, noindex, canonical: canonical ? safeResolve(canonical, ctx.finalUrl) : null });

  if (!o.enabled) return [];

  if (google || bing || ddg) {
    if (!title) out.push({ ruleId: 'search.title-missing', ...at('head') });
    else {
      if (google && title.length > 60) out.push({ ruleId: 'search.title-long', ...at('title'), detail: `${title.length} characters: "${title}"` });
      else if (bing && title.length > 65) out.push({ ruleId: 'search.title-long-bing', ...at('title'), detail: `${title.length} characters` });
    }
    if (!description) {
      if (google) out.push({ ruleId: 'search.description-missing', ...at('head') });
      if (bing) out.push({ ruleId: 'search.description-missing-bing', ...at('head') });
      if (ddg && !bing) out.push({ ruleId: 'search.ddg-description', ...at('head') });
    } else if (google && description.length > 160) {
      out.push({ ruleId: 'search.description-long', ...at('meta[name="description" i]'), detail: `${description.length} characters` });
    }
    if (noindex) out.push({ ruleId: 'search.noindex', ...at('meta[name="robots" i]'), detail: robotsMeta.trim() });
    if (google) {
      if (!$('meta[name="viewport" i]').length) out.push({ ruleId: 'search.viewport-missing', ...at('head') });
      if (!canonical) out.push({ ruleId: 'search.canonical-missing', ...at('head') });
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          JSON.parse($(el).text());
        } catch (e) {
          const rawEl = $raw('script[type="application/ld+json"]').get($('script[type="application/ld+json"]').index(el));
          out.push({ ruleId: 'search.structured-data-invalid', line: lineOf(rawEl), snippet: $(el).text().slice(0, 200), detail: (e as Error).message });
        }
      });
      if (ctx.shopify && /\/products\/[^/]+\/?$/.test(new URL(ctx.finalUrl).pathname)) {
        const ld = $('script[type="application/ld+json"]').text();
        if (!/"@type"\s*:\s*"Product"/.test(ld) && !$('[itemtype*="schema.org/Product"]').length) out.push({ ruleId: 'search.product-schema-missing' });
      }
      const path = new URL(ctx.finalUrl).pathname;
      if (path.includes('_')) out.push({ ruleId: 'search.url-underscore', detail: ctx.finalUrl });
      $('a[href]').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (GENERIC_LINK_TEXT.test(text) && !$(el).attr('aria-label')) {
          const rawEl = $raw(`a[href="${cssEscape($(el).attr('href') ?? '')}"]`).get(0);
          out.push({ ruleId: 'search.link-text-generic', line: lineOf(rawEl), snippet: snippetOf($, el), detail: `"${text}"` });
        }
      });
      $('link[rel="alternate" i][hreflang]').each((_, el) => {
        const v = $(el).attr('hreflang') ?? '';
        if (!HREFLANG.test(v)) out.push({ ruleId: 'search.hreflang-invalid', line: lineOf($raw(`link[hreflang="${cssEscape(v)}"]`).get(0)), snippet: snippetOf($, el), detail: `hreflang="${v}"` });
      });
    }
    if (bing) {
      if (!$('html').attr('lang')) out.push({ ruleId: 'search.lang-missing', ...at('html') });
      const words = ctx.text.split(/\s+/).filter(Boolean).length;
      if (words < 150 && !ctx.isHome) out.push({ ruleId: 'search.thin-content', detail: `${words} words` });
    }
  }

  if (bp) {
    if (title && title.length < 15) out.push({ ruleId: 'search.title-short', ...at('title'), detail: `"${title}"` });
    if (description && description.length < 50) out.push({ ruleId: 'search.description-short', ...at('meta[name="description" i]'), detail: `${description.length} characters` });
    const h1s = $('h1');
    if (!h1s.length) out.push({ ruleId: 'search.h1-missing' });
    else if (h1s.length > 1) out.push({ ruleId: 'search.h1-multiple', ...at('h1'), detail: `${h1s.length} h1 elements` });
    if (!$('meta[property="og:title"],meta[property="og:image"]').length) out.push({ ruleId: 'search.og-missing', ...at('head') });
    const path = new URL(ctx.finalUrl).pathname;
    if (/[A-Z]/.test(path)) out.push({ ruleId: 'search.url-uppercase', detail: ctx.finalUrl });
    if (ctx.finalUrl.length > 115) out.push({ ruleId: 'search.url-long', detail: `${ctx.finalUrl.length} characters` });
  }

  // Keyword optimisation.
  const keywords = o.keywords.split(/[\n,]+/).map((k) => k.trim()).filter(Boolean);
  if (keywords.length) {
    const h1 = $('h1').text().toLowerCase();
    const tl = title.toLowerCase();
    const dl = description.toLowerCase();
    for (const k of keywords) {
      const kl = k.toLowerCase();
      if (!tl.includes(kl)) out.push({ ruleId: 'search.keyword-title', ...at('title'), detail: `"${k}"` });
      if (!h1.includes(kl)) out.push({ ruleId: 'search.keyword-h1', ...at('h1'), detail: `"${k}"` });
      if (description && !dl.includes(kl)) out.push({ ruleId: 'search.keyword-description', ...at('meta[name="description" i]'), detail: `"${k}"` });
    }
  }
  return out;
}

const cssEscape = (s: string) => s.replace(/["\\]/g, '\\$&');
function safeResolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
