import nspell from 'nspell';
import type { Finding } from '../rules/types.js';
import type { PageContext } from '../context.js';
import { lineOf, snippetOf } from '../source.js';
import type { SpellLanguage } from '../../../shared/options.js';

type Speller = ReturnType<typeof nspell>;
const spellers = new Map<SpellLanguage, Promise<Speller>>();

const DICTIONARY_MODULE: Record<SpellLanguage, string> = { 'en-US': 'dictionary-en', 'en-GB': 'dictionary-en-gb', es: 'dictionary-es', fr: 'dictionary-fr', de: 'dictionary-de' };

/** E-commerce vocabulary that general dictionaries miss. */
const COMMERCE_WORDS = ['ecommerce', 'checkout', 'wishlist', 'subtotal', 'shopify', 'paypal', 'klarna', 'afterpay', 'gpay', 'applepay', 'sku', 'skus', 'faq', 'faqs', 'login', 'signup', 'unsubscribe', 'cart', 'favicon', 'instagram', 'tiktok', 'pinterest', 'youtube', 'whatsapp', 'linkedin', 'email', 'emails', 'online', 'website', 'websites', 'homepage', 'url', 'urls', 'app', 'apps', 'ok', 'vs', 'eg', 'ie', 'etc', 'inc', 'llc', 'ltd', 'usd', 'eur', 'gbp', 'cad', 'aud', 'oz', 'lbs', 'kg', 'cm', 'mm', 'ml', 'xl', 'xxl', 'xs'];

export function getSpeller(lang: SpellLanguage): Promise<Speller> {
  let p = spellers.get(lang);
  if (!p) {
    p = import(DICTIONARY_MODULE[lang]).then((m: { default: { aff: Uint8Array; dic: Uint8Array } }) => {
      const sp = nspell(Buffer.from(m.default.aff), Buffer.from(m.default.dic));
      for (const w of COMMERCE_WORDS) sp.add(w);
      return sp;
    });
    spellers.set(lang, p);
  }
  return p;
}

const SOFT_404 = /\b(page not found|404 not found|not be found|doesn['’]?t exist|does not exist|no longer available)\b/i;

export async function errorsAnalyzer(ctx: PageContext): Promise<Finding[]> {
  const o = ctx.options.rules.errors;
  if (!o.enabled) return [];
  const out: Finding[] = [];
  const $ = ctx.$raw;

  // Character encoding.
  const ct = ctx.headers['content-type'] ?? '';
  if (!/charset=/i.test(ct) && !$('meta[charset]').length && !$('meta[http-equiv="Content-Type" i]').attr('content')?.includes('charset')) {
    out.push({ ruleId: 'errors.no-charset', line: lineOf($('head').get(0)) });
  }

  // Redirect chain and meta refresh.
  if (ctx.redirects.length > 2) out.push({ ruleId: 'errors.redirect-chain', detail: [...ctx.redirects.map((r) => `${r.status} ${r.url}`), `200 ${ctx.finalUrl}`].join(' → ') });
  $('meta[http-equiv="refresh" i]').each((_, el) => void out.push({ ruleId: 'errors.meta-refresh', line: lineOf(el), snippet: snippetOf($, el) }));

  // Mixed content on https pages (only active/visible content — links to http pages are fine).
  if (ctx.finalUrl.startsWith('https:')) {
    $('img[src^="http:"],script[src^="http:"],link[rel~="stylesheet"][href^="http:"],iframe[src^="http:"],video[src^="http:"],audio[src^="http:"],source[src^="http:"]').each((_, el) => {
      out.push({ ruleId: 'errors.mixed-content', line: lineOf(el), snippet: snippetOf($, el) });
    });
  }

  // Soft 404 and empty pages.
  const title = $('title').first().text().trim();
  const h1 = $('h1').first().text().trim();
  if (ctx.status === 200 && !ctx.isHome && (SOFT_404.test(title) || SOFT_404.test(h1))) out.push({ ruleId: 'errors.soft-404', detail: `Title: "${title}"` });
  if (ctx.text.length < 5 && !ctx.$dom('img,video,picture,canvas,iframe').length) out.push({ ruleId: 'errors.empty-page' });

  // Forbidden and required text (one phrase per line, case-insensitive).
  const lowerText = ctx.text.toLowerCase();
  for (const phrase of lines(o.forbiddenText)) {
    if (lowerText.includes(phrase.toLowerCase())) out.push({ ruleId: 'errors.forbidden-text', line: ctx.src.find(phrase), detail: `Found: "${phrase}"`, snippet: contextAround(ctx.text, phrase) });
  }
  for (const phrase of lines(o.requiredText)) {
    if (!lowerText.includes(phrase.toLowerCase())) out.push({ ruleId: 'errors.required-text', detail: `Missing: "${phrase}"` });
  }

  // Page weight (HTML + every resource the browser downloaded).
  if (o.pageWeightLimitKb !== null) {
    const bytes = ctx.rendered?.totalBytes || Buffer.byteLength(ctx.raw);
    if (bytes > o.pageWeightLimitKb * 1024) {
      const heaviest = [...(ctx.rendered?.resources ?? [])].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
      out.push({ ruleId: 'errors.page-weight', detail: `${Math.round(bytes / 1024)} KB (limit ${o.pageWeightLimitKb} KB). Largest: ${heaviest.map((r) => `${shortUrl(r.url)} ${Math.round(r.bytes / 1024)} KB`).join(', ')}` });
    }
  }

  if (o.spellCheck) out.push(...(await spelling(ctx)));
  return out;
}

async function spelling(ctx: PageContext): Promise<Finding[]> {
  const o = ctx.options.rules.errors;
  const lang = (ctx.$raw('html').attr('lang') ?? '').toLowerCase();
  const scanLang = o.spellLanguage.slice(0, 2);
  if (lang && !lang.startsWith(scanLang)) return []; // page in another language — don't flag every word
  const sp = await getSpeller(o.spellLanguage);
  const words = ctx.text.match(/[\p{L}][\p{L}'’-]*[\p{L}]/gu) ?? [];
  const bad = new Map<string, number>();
  for (const raw of words) {
    const w = raw.replace(/[’]/g, "'").replace(/^'+|'+$/g, '');
    if (w.length < 3 || w.length > 30) continue;
    if (/\d/.test(w) || /^[A-Z0-9]+$/.test(w)) continue; // acronyms
    if (o.ignoreCapitalized && /^\p{Lu}/u.test(w)) continue;
    if (/\p{Ll}\p{Lu}/u.test(w)) continue; // camelCase brand names (iPhone, PayPal)
    const parts = w.split('-');
    if (parts.every((p) => p.length < 2 || sp.correct(p) || sp.correct(p.toLowerCase()))) continue;
    bad.set(w, (bad.get(w) ?? 0) + 1);
  }
  const out: Finding[] = [];
  for (const [word] of [...bad].slice(0, 30)) {
    const suggestions = sp.suggest(word).slice(0, 3);
    out.push({
      ruleId: 'errors.spelling',
      line: ctx.src.find(word),
      snippet: contextAround(ctx.text, word),
      detail: `"${word}"${suggestions.length ? ` — did you mean: ${suggestions.join(', ')}?` : ''}`,
    });
  }
  return out;
}

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const shortUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname.split('/').pop() || x.hostname;
  } catch {
    return u;
  }
};
function contextAround(text: string, needle: string, radius = 60): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return needle;
  return `${i > radius ? '…' : ''}${text.slice(Math.max(0, i - radius), i + needle.length + radius)}${i + needle.length + radius < text.length ? '…' : ''}`;
}
