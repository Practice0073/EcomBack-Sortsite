import bcd from '@mdn/browser-compat-data';
import * as csstree from 'css-tree';
import { BROWSER_LABELS, type BrowserId } from '../../../shared/options.js';
import { registerRule } from '../rules/catalog.js';
import type { Finding } from '../rules/types.js';
import type { PageContext } from '../context.js';
import { lineOf, snippetOf } from '../source.js';

type Statement = { version_added: string | boolean | null; version_removed?: string | boolean | null; prefix?: string; alternative_name?: string; flags?: unknown[]; partial_implementation?: boolean; notes?: string | string[] };
type Compat = { __compat?: { support: Partial<Record<BrowserId, Statement | Statement[]>>; mdn_url?: string; status?: { deprecated?: boolean } } };
type Tree = Record<string, Compat & Record<string, unknown>>;

const data = bcd as unknown as { browsers: Record<string, { releases: Record<string, { status: string }> }>; css: { properties: Tree; selectors: Tree; 'at-rules': Tree }; html: { elements: Tree; global_attributes: Tree } };

/** Current stable version per browser, from the compat data's own release list. */
const CURRENT: Record<BrowserId, number> = Object.fromEntries(
  (Object.keys(BROWSER_LABELS) as BrowserId[]).map((b) => {
    const releases = data.browsers[b]?.releases ?? {};
    const current = Object.entries(releases).filter(([, r]) => r.status === 'current').map(([v]) => parseFloat(v));
    return [b, Math.max(...current, 0)];
  }),
) as Record<BrowserId, number>;

const versionNum = (v: string) => parseFloat(v.replace(/^≤/, ''));

/** 'yes' | 'partial' | 'no' for the current release of a browser (unprefixed, unflagged support only). */
function supportOf(compat: Compat['__compat'], browser: BrowserId, prefixedFallbacks?: Set<string>, name?: string): 'yes' | 'partial' | 'no' | 'unknown' {
  const raw = compat?.support[browser];
  if (!raw) return 'unknown';
  const all = Array.isArray(raw) ? raw : [raw];
  // A vendor-prefixed fallback that the stylesheet actually declares counts as support.
  if (prefixedFallbacks && name && all.some((s) => s.prefix && typeof s.version_added === 'string' && prefixedFallbacks.has(`${s.prefix}${name}`))) return 'yes';
  const statements = all.filter((s) => !s.prefix && !s.alternative_name && !s.flags);
  if (!statements.length) return 'no';
  let best: 'yes' | 'partial' | 'no' | 'unknown' = 'no';
  for (const s of statements) {
    if (s.version_added === null) return 'unknown';
    if (s.version_added === false) continue;
    if (s.version_removed && typeof s.version_removed === 'string' && versionNum(s.version_removed) <= CURRENT[browser]) continue;
    const added = typeof s.version_added === 'string' ? (s.version_added === 'preview' ? Infinity : versionNum(s.version_added)) : 0;
    if (added > CURRENT[browser]) continue;
    if (s.partial_implementation) best = best === 'no' ? 'partial' : best;
    else return 'yes';
  }
  return best;
}

function ruleFor(kind: string, name: string, browser: BrowserId, level: 'no' | 'partial', mdn: string | undefined) {
  const id = `compat.${kind}.${name.replace(/[^a-z0-9-]+/gi, '_')}.${browser}.${level}`;
  const label = BROWSER_LABELS[browser];
  const what = kind === 'css-prop' ? `CSS property "${name}"` : kind === 'css-value' ? `CSS value ${name}` : kind === 'css-selector' ? `CSS selector ":${name}"` : kind === 'css-at' ? `CSS @${name} rule` : kind === 'html-el' ? `HTML <${name}> element` : `HTML attribute ${name}`;
  return registerRule({
    id,
    category: 'compatibility',
    severity: level === 'no' ? 'other' : 'warning',
    section: label,
    title: `${what} ${level === 'no' ? 'not supported' : 'only partly supported'} in ${label}`,
    description: `The current version of ${label} ${level === 'no' ? 'does not support' : 'only partly supports'} the ${what}. Visitors using ${label} may see a different layout or missing functionality.`,
    fix: kind.startsWith('css') ? `Provide a fallback declaration before it, or wrap it in @supports so ${label} gets a working alternative.` : `Provide a fallback or progressive enhancement for ${label}.`,
    guidelines: [{ label: `MDN compat: ${name}`, url: mdn ?? 'https://developer.mozilla.org/' }],
    effortMinutes: 15,
    helpUrl: mdn ?? null,
  });
}

/** Cache of (feature → per-browser verdict) so each feature is evaluated once per process. */
const verdicts = new Map<string, [BrowserId, 'no' | 'partial'][]>();
function verdict(key: string, compat: Compat['__compat'], browsers: BrowserId[], prefixed?: Set<string>, name?: string) {
  const hasFallback = !!(prefixed && name && [...prefixed].some((p) => p.endsWith(`-${name}`)));
  const ck = `${key}|${browsers.join(',')}|${hasFallback ? [...prefixed!].filter((p) => p.endsWith(`-${name}`)).join(',') : ''}`;
  let v = verdicts.get(ck);
  if (!v) {
    v = [];
    for (const b of browsers) {
      const s = supportOf(compat, b, prefixed, name);
      if (s === 'no' || s === 'partial') v.push([b, s]);
    }
    verdicts.set(ck, v);
  }
  return v;
}

export interface CssCompatHit { kind: string; name: string; line: number | null; snippet: string }
export interface CssFeatureSet { hits: CssCompatHit[]; prefixed: Set<string> }

/** Walk a stylesheet and list features to check; skips anything inside @supports (already guarded). */
export function cssFeatures(css: string, lineOffset = 0): CssFeatureSet {
  const hits: CssCompatHit[] = [];
  const prefixed = new Set<string>();
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { positions: true, parseValue: false, parseCustomProperty: false, onParseError: () => undefined });
  } catch {
    return { hits, prefixed };
  }
  const seen = new Set<string>();
  const push = (kind: string, name: string, loc: csstree.CssLocation | undefined | null, snippet: string) => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ kind, name, line: loc ? loc.start.line + lineOffset : null, snippet: snippet.slice(0, 200) });
  };
  csstree.walk(ast, {
    enter(node: csstree.CssNode) {
      if (node.type === 'Atrule' && node.name === 'supports') return csstree.walk.skip;
      if (node.type === 'Atrule') push('css-at', node.name.toLowerCase(), node.loc, `@${node.name}`);
      if (node.type === 'PseudoClassSelector') push('css-selector', node.name.toLowerCase(), node.loc, `:${node.name}`);
      if (node.type === 'Declaration' && /^-[a-z]+-/.test(node.property)) prefixed.add(node.property.toLowerCase());
      if (node.type === 'Declaration' && !node.property.startsWith('--') && !node.property.startsWith('-')) {
        const prop = node.property.toLowerCase();
        const value = node.value.type === 'Raw' ? node.value.value : csstree.generate(node.value);
        push('css-prop', prop, node.loc, `${prop}: ${value}`);
        const sub = data.css.properties[prop];
        if (sub) {
          for (const key of Object.keys(sub)) {
            if (key === '__compat' || !/^[a-z][a-z-]*$/.test(key)) continue;
            if (new RegExp(`(^|[\\s,(])${key}($|[\\s,()])`, 'i').test(value)) push('css-value', `${prop}: ${key}`, node.loc, `${prop}: ${value}`);
          }
        }
      }
      return undefined;
    },
  });
  return { hits, prefixed };
}

export function checkCssCompat(set: CssFeatureSet, browsers: BrowserId[]): Finding[] {
  const out: Finding[] = [];
  for (const h of set.hits) {
    let compat: Compat['__compat'];
    let key = h.name;
    if (h.kind === 'css-prop') compat = data.css.properties[h.name]?.__compat;
    else if (h.kind === 'css-value') {
      const [prop, val] = h.name.split(': ') as [string, string];
      compat = (data.css.properties[prop]?.[val] as Compat | undefined)?.__compat;
    } else if (h.kind === 'css-selector') compat = data.css.selectors[h.name]?.__compat;
    else compat = data.css['at-rules'][h.name]?.__compat;
    if (!compat) continue;
    key = `${h.kind}:${h.name}`;
    for (const [b, level] of verdict(key, compat, browsers, h.kind === 'css-prop' ? set.prefixed : undefined, h.name)) {
      const rule = ruleFor(h.kind, h.name, b, level, compat.mdn_url);
      out.push({ ruleId: rule.id, line: h.line, snippet: h.snippet });
    }
  }
  return out;
}

export function compatibilityAnalyzer(ctx: PageContext): Finding[] {
  const opts = ctx.options.rules.compatibility;
  if (!opts.enabled) return [];
  const browsers = opts.browsers;
  const out: Finding[] = [];
  const seen = new Set<string>();
  const $ = ctx.$raw;

  $('body *, head *').each((_, el) => {
    if (el.type !== 'tag') return;
    const tag = el.tagName.toLowerCase();
    if (!seen.has(`el:${tag}`)) {
      seen.add(`el:${tag}`);
      const compat = data.html.elements[tag]?.__compat;
      if (compat) {
        for (const [b, level] of verdict(`html-el:${tag}`, compat, browsers)) {
          out.push({ ruleId: ruleFor('html-el', tag, b, level, compat.mdn_url).id, line: lineOf(el), snippet: snippetOf($, el) });
        }
      }
    }
    for (const attr of Object.keys(el.attribs ?? {})) {
      const a = attr.toLowerCase();
      if (a.startsWith('data-') || a.startsWith('aria-') || a.startsWith('on')) continue;
      const k = `attr:${tag}:${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const compat = ((data.html.elements[tag]?.[a] as Compat | undefined) ?? data.html.global_attributes[a])?.__compat;
      if (!compat) continue;
      for (const [b, level] of verdict(`html-attr:${tag}:${a}`, compat, browsers)) {
        out.push({ ruleId: ruleFor('html-attr', `${tag}[${a}]`, b, level, compat.mdn_url).id, line: lineOf(el), snippet: snippetOf($, el) });
      }
    }
  });

  // Inline <style> blocks and style="" attributes in the page itself.
  $('style').each((_, el) => {
    const line = lineOf(el) ?? 1;
    out.push(...checkCssCompat(cssFeatures($(el).text(), line - 1), browsers));
  });
  $('[style]').slice(0, 300).each((_, el) => {
    const css = `x{${$(el).attr('style') ?? ''}}`;
    const set = cssFeatures(css);
    out.push(...checkCssCompat({ hits: set.hits.map((h) => ({ ...h, line: lineOf(el), snippet: snippetOf($, el) })), prefixed: set.prefixed }, browsers));
  });
  return dedupe(out);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.ruleId}|${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
