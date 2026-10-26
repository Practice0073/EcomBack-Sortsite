/**
 * `npm run check:rules` — known-answer checks for the rule corrections of 1.1 against fixtures,
 * so a regression in any of them fails loudly instead of inflating a client report:
 *   1. title detection with an <img> inside <head>;
 *   2. CSS at-rule descriptors (@font-face src/font-display/unicode-range, @viewport) are not "unknown";
 *   3. cursor/resize are not browser-compatibility findings for touch browsers;
 *   4. (with Chrome) F87 ignores text generated into screen-reader-only elements and small-text ignores font-size 0.
 */
import { config } from '../config.js';
import { loadWithLocations, SourceMap, visibleText } from '../engine/source.js';
import { searchAnalyzer } from '../engine/analyzers/search.js';
import { accessibilityAnalyzer } from '../engine/analyzers/accessibility.js';
import { validateCss } from '../engine/analyzers/standards.js';
import { compatibilityAnalyzer, cssFeatures, checkCssCompat } from '../engine/analyzers/compatibility.js';
import { browserAvailable, closeBrowser, renderPage } from '../engine/browser.js';
import { DEFAULT_SCAN_OPTIONS } from '../../shared/options.js';
import type { PageContext } from '../engine/context.js';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Title inside a <head> that also contains an <img> (tracking pixel): the title must still be found.
{
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><img height="1" width="1" src="https://www.facebook.com/tr?id=1"><title>Hello World</title><meta name="description" content="A page about things that are described here at length."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"></head><body><h1>Hi</h1><p>Body text.</p></body></html>';
  const $ = loadWithLocations(html);
  const ctx: PageContext = { url: 'https://example.com/', finalUrl: 'https://example.com/', status: 200, headers: {}, raw: html, src: new SourceMap(html), $raw: $, $dom: $, rendered: null, renderFailed: false, options: DEFAULT_SCAN_OPTIONS, shopify: false, isHome: true, text: visibleText($), redirects: [] };
  const facts = new Map();
  const findings = searchAnalyzer(ctx, facts);
  check('title found despite <img> in <head>', !findings.some((f) => f.ruleId === 'search.title-missing') && facts.get('https://example.com/')?.title === 'Hello World', findings.map((f) => f.ruleId).join(', '));
}

// 2. At-rule descriptors are validated as descriptors; real property errors are still reported.
{
  const css = '@font-face{font-family:A;src:url(a.woff2) format("woff2");font-display:swap;unicode-range:U+0-7F} @viewport{width:device-width} @-ms-viewport{width:device-width} p{color:red;max-height:auto;background-color:none} @media (min-width:600px){a{colour:blue}}';
  const findings = validateCss(css);
  const unknown = findings.filter((f) => f.ruleId === 'standards.css-unknown-property').map((f) => f.detail);
  const invalid = findings.filter((f) => f.ruleId === 'standards.css-invalid-value').map((f) => f.detail);
  check('@font-face descriptors are not unknown properties', !unknown.some((d) => /"(src|font-display|unicode-range)"/.test(d ?? '')), unknown.join(' | '));
  check('@viewport width is not an invalid value', !invalid.some((d) => /device-width/.test(d ?? '')), invalid.join(' | '));
  check('real property errors still reported', invalid.length === 2 && unknown.some((d) => /"colour"/.test(d ?? '')), `${invalid.length} invalid, ${unknown.length} unknown`);
}

// 3. Pointer-only CSS on touch browsers; virtual-keyboard attributes on desktop browsers.
{
  const set = cssFeatures('a{cursor:pointer;resize:vertical;user-select:none}');
  const touch = checkCssCompat(set, ['safari_ios', 'chrome_android']).map((f) => f.ruleId);
  const desktop = checkCssCompat(set, ['safari']).map((f) => f.ruleId);
  check('cursor/resize skipped for iPhone/iPad and Android', !touch.some((id) => /cursor|resize/.test(id)), touch.join(', '));
  check('user-select still checked (unprefixed only) on Safari', desktop.some((id) => /user-select/.test(id)), desktop.join(', '));
  const html = '<!doctype html><html lang="en"><head><title>t</title></head><body><form><input type="search" name="q" autocapitalize="off" inputmode="search"></form></body></html>';
  const $ = loadWithLocations(html);
  const opts = structuredClone(DEFAULT_SCAN_OPTIONS);
  opts.rules.compatibility.browsers = ['safari', 'chrome', 'firefox'];
  const ctx: PageContext = { url: 'https://example.com/', finalUrl: 'https://example.com/', status: 200, headers: {}, raw: html, src: new SourceMap(html), $raw: $, $dom: $, rendered: null, renderFailed: false, options: opts, shopify: false, isHome: true, text: visibleText($), redirects: [] };
  const attrs = compatibilityAnalyzer(ctx).map((f) => f.ruleId).filter((id) => /autocapitalize|inputmode/.test(id));
  check('autocapitalize/inputmode not reported for desktop browsers', attrs.length === 0, attrs.join(', '));
}

// 3b. `<ul role="list">` is not redundant ARIA; `<h2 role="heading">` still is.
{
  const html = '<!doctype html><html lang="en"><head><title>t</title></head><body><ul role="list"><li role="listitem">a</li></ul><h2 role="heading">x</h2></body></html>';
  const $ = loadWithLocations(html);
  const ctx: PageContext = { url: 'https://example.com/', finalUrl: 'https://example.com/', status: 200, headers: {}, raw: html, src: new SourceMap(html), $raw: $, $dom: $, rendered: null, renderFailed: false, options: DEFAULT_SCAN_OPTIONS, shopify: false, isHome: true, text: visibleText($), redirects: [] };
  const redundant = accessibilityAnalyzer(ctx).filter((f) => f.ruleId === 'accessibility.aria-redundant').map((f) => f.detail ?? '');
  check('role="list"/"listitem" not reported as redundant', !redundant.some((d) => /list/.test(d)), redundant.join(' | '));
  check('role="heading" on h2 still reported', redundant.some((d) => /heading/.test(d)), redundant.join(' | '));
}

// 4. In-browser checks need Chrome.
if (browserAvailable()) {
  const html = `<!doctype html><html lang="en"><head><title>F87 fixture</title><style>
      .screen-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
      .screen-only::after{content:"desktop"}
      .unit::after{content:" miles"}
      .text-hide{font:0/0 a;color:transparent}
      .tiny{font-size:9px}
      body{color:#121212;background:#fff}
      .card a{color:currentColor;text-decoration:none}
      .box{background:#eee}
    </style></head><body>
      <span class="screen-only"></span>
      <label class="unit">5</label>
      <a href="/" class="text-hide">Brand name</a>
      <p class="tiny">Fine print that really is tiny.</p>
      <p>Normal paragraph text that is long enough to be counted as real text on the page.</p>
      <div class="card"><a href="/p1" id="inherits">Product card link (author colour via currentColor)</a></div>
      <div class="box"><a href="/p2" id="browser">Bare link on an author background</a></div>
    </body></html>`;
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const r = await renderPage(url, { domMode: 'smart', timeoutMs: 30_000, authHeaders: {}, authHosts: new Set(), cookies: [], rawHtml: null, axeTags: null, axeDisabledRules: [], wantScreenshot: false, usability: true, cssTechniques: true, cssCache: new Map() });
  await closeBrowser();
  check('page rendered', !r.error, r.error ?? '');
  const f87 = r.cssFindings.filter((f) => f.technique === 'F87');
  check('F87 ignores screen-reader-only generated text', !f87.some((f) => /screen-only/.test(f.html)), f87.map((f) => f.detail).join(' | '));
  check('F87 still reports visible generated text', f87.some((f) => /miles/.test(f.detail)), f87.map((f) => f.detail).join(' | '));
  check('small text ignores font-size 0', !r.smallText.some((t) => t.size === 0), r.smallText.map((t) => `${t.size}px ${t.selector}`).join(' | '));
  check('small text still reports 9px text', r.smallText.some((t) => t.size === 9), r.smallText.map((t) => `${t.size}px`).join(' | '));
  const f24 = r.cssFindings.filter((f) => f.technique === 'F24');
  check('F24 ignores links coloured with currentColor', !f24.some((f) => f.selector === '#inherits'), f24.map((f) => `${f.selector}: ${f.detail}`).join(' | '));
  check('F24 still reports a browser-coloured link on an author background', f24.some((f) => f.selector === '#browser'), f24.map((f) => f.selector).join(', '));
} else {
  console.log('skip in-browser checks (Chrome not found)');
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll rule checks pass.');
