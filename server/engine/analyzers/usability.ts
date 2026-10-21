import type { Finding } from '../rules/types.js';
import type { PageContext } from '../context.js';
import { lineOf, readability, snippetOf } from '../source.js';

const NEW_WINDOW_HINT = /new (tab|window)|opens in|external|↗|⧉/i;
const DOC_LINK = /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|#|$)/i;
const DOC_HINT = /\b(pdf|word|excel|powerpoint|zip|download|doc|xls|ppt|kb|mb)\b/i;
const AUTOCOMPLETE_FIELDS: [RegExp, string][] = [
  [/e-?mail/i, 'email'],
  [/phone|tel\b|mobile/i, 'tel'],
  [/first.?name|given/i, 'given-name'],
  [/last.?name|surname|family/i, 'family-name'],
  [/zip|postal|postcode/i, 'postal-code'],
  [/address/i, 'street-address'],
  [/city|town/i, 'address-level2'],
];

export function usabilityAnalyzer(ctx: PageContext): Finding[] {
  const o = ctx.options.rules.usability;
  if (!o.enabled) return [];
  const $ = ctx.$raw;
  const out: Finding[] = [];

  if (o.bestPractices) {
    $('a[target="_blank"]').each((_, el) => {
      const $a = $(el);
      const label = `${$a.text()} ${$a.attr('aria-label') ?? ''} ${$a.attr('title') ?? ''} ${$a.find('img').attr('alt') ?? ''}`;
      if (!NEW_WINDOW_HINT.test(label) && !$a.find('svg,.icon-external,[class*="external"]').length) {
        out.push({ ruleId: 'usability.new-window', line: lineOf(el), snippet: snippetOf($, el) });
      }
    });
    $('a[href]').each((_, el) => {
      const $a = $(el);
      if (DOC_LINK.test($a.attr('href') ?? '') && !DOC_HINT.test(`${$a.text()} ${$a.attr('aria-label') ?? ''}`)) {
        out.push({ ruleId: 'usability.pdf-link-unmarked', line: lineOf(el), snippet: snippetOf($, el) });
      }
    });
    $('img').each((_, el) => {
      const $i = $(el);
      if ((!$i.attr('width') || !$i.attr('height')) && !/aspect-ratio|width\s*:|height\s*:/.test($i.attr('style') ?? '') && !$i.attr('src')?.startsWith('data:')) {
        out.push({ ruleId: 'usability.image-dimensions', line: lineOf(el), snippet: snippetOf($, el) });
      }
    });
    const linkCount = ctx.$dom('a[href]').length;
    if (linkCount > 300) out.push({ ruleId: 'usability.too-many-links', detail: `${linkCount} links` });
    $('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=search])').each((_, el) => {
      const $i = $(el);
      if ($i.attr('autocomplete')) return;
      const key = `${$i.attr('name') ?? ''} ${$i.attr('id') ?? ''} ${$i.attr('type') ?? ''}`;
      const hit = AUTOCOMPLETE_FIELDS.find(([re]) => re.test(key));
      if (hit) out.push({ ruleId: 'usability.autocomplete-missing', line: lineOf(el), snippet: snippetOf($, el), detail: `Suggested: autocomplete="${hit[1]}"` });
    });
    for (const t of ctx.rendered?.smallText ?? []) {
      out.push({ ruleId: 'usability.small-text', line: ctx.src.locate(t.snippet), snippet: t.snippet, selector: t.selector, detail: `${t.size}px at 375px viewport` });
    }
    if (ctx.rendered?.horizontalScroll) {
      const h = ctx.rendered.horizontalScroll;
      out.push({ ruleId: 'usability.horizontal-scroll', snippet: h.culprit, line: h.culprit ? ctx.src.locate(h.culprit) : null, detail: `Page is ${h.scrollWidth}px wide at a 375px viewport` });
    }
  }

  if (o.readability) {
    const r = readability(ctx.text);
    if (r) {
      if (r.ease < 50) out.push({ ruleId: 'usability.hard-to-read', detail: `Flesch reading ease ${r.ease} (grade ${r.grade})` });
      if (r.longSentences.length >= 3) {
        out.push({ ruleId: 'usability.long-sentences', detail: `${r.longSentences.length} sentences over 30 words`, snippet: r.longSentences[0]!.slice(0, 280) });
      }
    }
  }
  return out;
}
