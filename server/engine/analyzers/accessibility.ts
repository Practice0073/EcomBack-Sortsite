import { axeLevel, getRule } from '../rules/catalog.js';
import type { Finding } from '../rules/types.js';
import type { PageContext } from '../context.js';
import { lineOf, readability, snippetOf } from '../source.js';
import type { Severity } from '../../../shared/types.js';
import type { ReadingAge } from '../../../shared/options.js';

/**
 * Severity follows the WCAG level, like SortSite/PowerMapper reports: Level A failures are priority (red),
 * Level AA/AAA failures are other (amber), and anything that is not a WCAG success-criterion failure
 * (best practices, "needs review") is a warning that is listed but never counted as a failing page.
 */
const LEVEL_SEVERITY: Record<'A' | 'AA' | 'AAA', Severity> = { A: 'priority', AA: 'other', AAA: 'other' };
const READING_GRADE: Record<ReadingAge, number> = { universal: 7, teen: 9, adult: 12 };

export function accessibilityAnalyzer(ctx: PageContext): Finding[] {
  const a11y = ctx.options.rules.accessibility;
  if (!a11y.enabled) return [];
  // Chrome is available but this page could not be rendered: checking the raw HTML instead would report labels,
  // names and hidden fields that the page's scripts provide. The page is listed under Diagnostics instead.
  if (ctx.renderFailed) return [];
  const out: Finding[] = [];

  if (ctx.rendered?.axe) {
    const { violations, incomplete } = ctx.rendered.axe;
    for (const v of violations) {
      const rule = getRule(`axe.${v.id}`);
      if (!rule) continue;
      const level = axeLevel(v.tags);
      for (const n of v.nodes) {
        const severity: Severity = level ? LEVEL_SEVERITY[level] : 'warning';
        out.push({ ruleId: rule.id, severity, line: ctx.src.locate(n.html), snippet: n.html, selector: n.target, detail: n.failureSummary ?? null });
      }
    }
    // "Needs review" results are reported as warnings — automated tools cannot decide them.
    for (const v of incomplete) {
      const rule = getRule(`axe.${v.id}`);
      if (!rule) continue;
      for (const n of v.nodes.slice(0, 20)) {
        out.push({ ruleId: rule.id, severity: 'warning', line: ctx.src.locate(n.html), snippet: n.html, selector: n.target, detail: `Needs manual review. ${n.failureSummary ?? ''}`.trim() });
      }
    }
  } else {
    out.push(...staticFallback(ctx));
  }

  out.push(...techniqueChecks(ctx));
  if (a11y.screenReaders) out.push(...screenReaderChecks(ctx));

  const r = readability(ctx.text);
  if (r && r.grade > READING_GRADE[a11y.readingAge]) {
    out.push({ ruleId: 'accessibility.reading-age', detail: `Flesch–Kincaid grade ${r.grade} (target ≤ ${READING_GRADE[a11y.readingAge]}), ${r.words} words.` });
  }
  return out;
}

const CSS_RULE: Record<string, string> = { F24: 'accessibility.f24-colors', F78: 'accessibility.f78-focus', anim: 'accessibility.animation-5s', F87: 'accessibility.f87-css-content' };
const GENERIC_LINK = /^(click here|here|read more|more|learn more|more info|more information|details|continue|go|link|this|view more|see more|find out more|shop now|buy now)$/i;
const PLACEHOLDER_TITLE = /^(untitled( document)?|new page|page|document|index|default|test|title|home ?page|blog|welcome|[\w-]+\.(html?|php|aspx?|jsp))$/i;
/** Elements whose implicit ARIA role equals the explicit role (ARIA in HTML). */
const IMPLICIT_ROLE: Record<string, string> = { h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', button: 'button', nav: 'navigation', main: 'main', ul: 'list', ol: 'list', li: 'listitem', table: 'table', form: 'form', aside: 'complementary', article: 'article', dialog: 'dialog' };

/**
 * WCAG technique checks: CSS-cascade failures found in the rendered page (F24, F78, 2.2.2, F87) and
 * static checks on the rendered DOM (2.4.4 link purpose, 2.4.2 placeholder title, 1.3.5 password
 * autocomplete, redundant ARIA).
 */
function techniqueChecks(ctx: PageContext): Finding[] {
  const out: Finding[] = [];
  for (const f of ctx.rendered?.cssFindings ?? []) {
    out.push({ ruleId: CSS_RULE[f.technique]!, line: ctx.src.locate(f.html), snippet: f.html, selector: f.selector, detail: f.detail });
  }
  const $ = ctx.$dom;
  const title = $('head title').first().text().replace(/\s+/g, ' ').trim();
  if (title && PLACEHOLDER_TITLE.test(title)) {
    const el = $('head title').get(0);
    out.push({ ruleId: 'accessibility.title-placeholder', line: ctx.src.find('<title') , snippet: el ? snippetOf($, el) : `<title>${title}</title>`, detail: `Title: "${title}"` });
  }
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const text = $a.text().replace(/\s+/g, ' ').trim();
    if (!GENERIC_LINK.test(text) || $a.attr('aria-label') || $a.attr('aria-labelledby') || $a.attr('aria-describedby') || $a.find('.sr-only, .visually-hidden').length) return;
    out.push({ ruleId: 'accessibility.link-purpose', line: ctx.src.locate($.html(el) ?? ''), snippet: snippetOf($, el), detail: `Link text "${text}"` });
  });
  $('input[type=password]:not([data-ss-hidden])').each((_, el) => {
    const ac = ($(el).attr('autocomplete') ?? '').toLowerCase();
    if (!/\b(current-password|new-password|one-time-code)\b/.test(ac)) out.push({ ruleId: 'accessibility.password-autocomplete', line: ctx.src.locate($.html(el) ?? ''), snippet: snippetOf($, el) });
  });
  $('[aria-disabled="true"][disabled], [aria-required="true"][required]').each((_, el) => {
    out.push({ ruleId: 'accessibility.aria-redundant', line: ctx.src.locate($.html(el) ?? ''), snippet: snippetOf($, el), detail: $(el).is('[aria-disabled]') ? 'aria-disabled is unnecessary with the disabled attribute' : 'aria-required is unnecessary with the required attribute' });
  });
  $('[role]').each((_, el) => {
    const tag = el.type === 'tag' ? el.tagName.toLowerCase() : '';
    const role = ($(el).attr('role') ?? '').trim().toLowerCase();
    if (IMPLICIT_ROLE[tag] === role || (tag === 'a' && $(el).attr('href') !== undefined && role === 'link')) {
      out.push({ ruleId: 'accessibility.aria-redundant', line: ctx.src.locate($.html(el) ?? ''), snippet: snippetOf($, el), detail: `The ${role} role is unnecessary for element ${tag}` });
    }
  });
  // HTML content model: <a> and <button> must not contain interactive content (checked on the rendered DOM,
  // so controls injected by apps are included).
  $('a[href], button').find('a[href], button, input:not([type=hidden]), select, textarea, details, iframe, embed, label, [tabindex]:not([tabindex="-1"])').each((_, el) => {
    const outer = $(el).parents('a[href], button').first();
    const outerTag = outer.get(0)?.type === 'tag' ? (outer.get(0) as { tagName: string }).tagName.toLowerCase() : 'a';
    const tag = el.type === 'tag' ? el.tagName.toLowerCase() : 'element';
    out.push({ ruleId: 'accessibility.nested-interactive', line: ctx.src.locate($.html(el) ?? ''), snippet: snippetOf($, el), detail: `The element ${tag} must not appear as a descendant of the ${outerTag} element.` });
  });
  $('a[href][aria-disabled="true"]').each((_, el) => {
    out.push({ ruleId: 'accessibility.aria-disabled-link', line: ctx.src.locate($.html(el) ?? ''), snippet: snippetOf($, el) });
  });
  return out;
}

/** Screen-reader compatibility heuristics for JAWS, NVDA and VoiceOver (beyond axe-core). */
function screenReaderChecks(ctx: PageContext): Finding[] {
  const $ = ctx.$raw;
  const out: Finding[] = [];
  const interactive = 'a[href],button,input:not([type=hidden]),select,textarea';
  $(interactive).each((_, el) => {
    const $el = $(el);
    const title = $el.attr('title')?.trim();
    if (!title) return;
    const text = $el.text().trim();
    const labelled = $el.attr('aria-label') || $el.attr('aria-labelledby') || text || $el.find('img[alt]:not([alt=""])').length || (el.tagName === 'input' && $el.attr('id') && $(`label[for="${$el.attr('id')}"]`).length) || $el.closest('label').length;
    if (!labelled) out.push({ ruleId: 'accessibility.sr-title-only', line: lineOf(el), snippet: snippetOf($, el) });
  });
  $('div[aria-label],span[aria-label]').each((_, el) => {
    if (!$(el).attr('role')) out.push({ ruleId: 'accessibility.sr-aria-label-generic', line: lineOf(el), snippet: snippetOf($, el) });
  });
  $('[role="application"]').each((_, el) => {
    out.push({ ruleId: 'accessibility.sr-role-application', line: lineOf(el), snippet: snippetOf($, el) });
  });
  $('img[alt]').each((_, el) => {
    const alt = $(el).attr('alt')?.trim() ?? '';
    if (/^[\w\s-]+\.(jpe?g|png|gif|webp|svg|avif)$/i.test(alt) || /^(img|image|dsc|photo|screenshot)[_-]?\d+/i.test(alt)) {
      out.push({ ruleId: 'accessibility.sr-alt-filename', line: lineOf(el), snippet: snippetOf($, el), detail: `alt="${alt}"` });
    }
  });
  $('table').each((_, el) => {
    const $t = $(el);
    if ($t.attr('role') === 'presentation' || $t.attr('role') === 'none') return;
    if (!$t.find('th,caption,thead').length && $t.find('table').length + $t.find('td > div, td > img, td > form').length > 2) {
      out.push({ ruleId: 'accessibility.sr-layout-table', line: lineOf(el), snippet: snippetOf($, el) });
    }
  });
  return out;
}

/** Minimal static checks used only when Chrome is not available (no rendered DOM, no contrast). */
function staticFallback(ctx: PageContext): Finding[] {
  const $ = ctx.$raw;
  const out: Finding[] = [{ ruleId: 'accessibility.static-fallback' }];
  const add = (id: string, el: Parameters<typeof lineOf>[0], severity?: Severity) => {
    if (getRule(id) && el) out.push({ ruleId: id, line: lineOf(el), snippet: snippetOf($, el), severity });
  };
  $('img:not([alt])').each((_, el) => add('axe.image-alt', el, 'priority'));
  if (!$('html').attr('lang')) add('axe.html-has-lang', $('html').get(0), 'priority');
  if (!$('title').text().trim()) add('axe.document-title', $('head').get(0), 'priority');
  $('a[href]').each((_, el) => {
    const $a = $(el);
    if (!$a.text().trim() && !$a.attr('aria-label') && !$a.attr('aria-labelledby') && !$a.find('img[alt]:not([alt=""])').length) add('axe.link-name', el, 'priority');
  });
  $('button').each((_, el) => {
    const $b = $(el);
    if (!$b.text().trim() && !$b.attr('aria-label') && !$b.attr('aria-labelledby') && !$b.attr('title')) add('axe.button-name', el, 'priority');
  });
  $('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]),select,textarea').each((_, el) => {
    const $i = $(el);
    const id = $i.attr('id');
    if (!$i.attr('aria-label') && !$i.attr('aria-labelledby') && !$i.closest('label').length && !(id && $(`label[for="${id}"]`).length) && !$i.attr('title')) add('axe.label', el, 'priority');
  });
  const ids = new Map<string, number>();
  $('[id]').each((_, el) => {
    const id = $(el).attr('id')!;
    ids.set(id, (ids.get(id) ?? 0) + 1);
    if (ids.get(id) === 2) add('axe.duplicate-id', el, 'other');
  });
  return out;
}
