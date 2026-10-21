import axe from 'axe-core';
import { q } from '../../db/index.js';
import { wcagUrl, WCAG_BY_NUM } from '../../../shared/wcag.js';
import type { Category } from '../../../shared/options.js';
import type { GuidelineRef, Severity } from '../../../shared/types.js';
import type { RuleDef } from './types.js';

export const ENGINE_VERSION = '1.0.0';

const g = {
  wcag: (num: string): GuidelineRef => {
    const sc = WCAG_BY_NUM.get(num);
    return { label: `WCAG ${sc?.level || ''} ${num}`.replace(/\s+/g, ' '), url: wcagUrl(num) };
  },
  google: (label: string, url: string): GuidelineRef => ({ label: `Google ${label}`, url }),
  bing: (label: string): GuidelineRef => ({ label: `Bing ${label}`, url: 'https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a' }),
  ddg: (label: string): GuidelineRef => ({ label: `DuckDuckGo ${label}`, url: 'https://duckduckgo.com/duckduckgo-help-pages/results/sources/' }),
  html: (label: string, url = 'https://html.spec.whatwg.org/multipage/'): GuidelineRef => ({ label: `HTML ${label}`, url }),
  css: (label: string, url = 'https://www.w3.org/Style/CSS/'): GuidelineRef => ({ label: `CSS ${label}`, url }),
  http: (label: string, url: string): GuidelineRef => ({ label, url }),
  pdfua: (label: string): GuidelineRef => ({ label: `PDF/UA-1 ${label}`, url: 'https://pdfa.org/resource/pdfua-in-a-nutshell/' }),
  sr: (label: string): GuidelineRef => ({ label, url: 'https://webaim.org/projects/screenreadersurvey10/' }),
  bp: (label: string): GuidelineRef => ({ label: `Best practice ${label}`, url: null }),
};

const RULES = new Map<string, RuleDef>();

function def(
  id: string,
  category: Category,
  severity: Severity,
  section: string,
  title: string,
  description: string,
  fix: string,
  guidelines: GuidelineRef[],
  effortMinutes = 10,
  helpUrl: string | null = null,
): RuleDef {
  const rule: RuleDef = { id, category, severity, section, title, description, fix, guidelines, effortMinutes, helpUrl, version: ENGINE_VERSION };
  RULES.set(id, rule);
  return rule;
}

// ── Errors ────────────────────────────────────────────────────────────────────
def('errors.broken-link', 'errors', 'priority', 'Broken links', 'Broken link', 'A link points to a page or file that returns an error (4xx/5xx) or cannot be reached. Visitors and search engines hit a dead end.', 'Update the link to the correct address, restore the missing page, or remove the link. For moved pages add a 301 redirect.', [g.http('HTTP 4xx/5xx', 'https://httpwg.org/specs/rfc9110.html#status.codes')], 5);
def('errors.broken-resource', 'errors', 'priority', 'Broken links', 'Missing image, script or stylesheet', 'The page loads a file (image, CSS, JavaScript, font) that returns an error. Parts of the page may look broken or stop working.', 'Re-upload the missing file or update the reference. In Shopify, check theme assets and app embeds that reference deleted files.', [g.http('HTTP 4xx/5xx', 'https://httpwg.org/specs/rfc9110.html#status.codes')], 10);
def('errors.broken-anchor', 'errors', 'other', 'Broken links', 'Link to a missing in-page anchor', 'A link points to #fragment that does not exist on the target page, so the browser does not scroll anywhere.', 'Add a matching id to the target element or correct the fragment in the link.', [g.html('fragment', 'https://html.spec.whatwg.org/multipage/browsing-the-web.html#scroll-to-fragid')], 5);
def('errors.server-error', 'errors', 'priority', 'Server and configuration', 'Page returns a server error', 'The server answered with a 5xx status. Visitors see an error page and search engines may drop the page.', 'Check server and application logs for this URL. On Shopify, check apps and Liquid errors in the theme.', [g.http('HTTP 5xx', 'https://httpwg.org/specs/rfc9110.html#status.5xx')], 30);
def('errors.redirect-chain', 'errors', 'other', 'Server and configuration', 'Long redirect chain', 'Reaching this page takes more than two redirects. Every hop slows the page and wastes crawl budget.', 'Point links and redirects straight at the final URL.', [g.google('redirects', 'https://developers.google.com/search/docs/crawling-indexing/301-redirects')], 10);
def('errors.redirect-loop', 'errors', 'priority', 'Server and configuration', 'Redirect loop', 'The page redirects back to itself, so it can never load.', 'Fix the redirect rules so they end at a page that returns 200.', [g.http('HTTP 3xx', 'https://httpwg.org/specs/rfc9110.html#status.3xx')], 20);
def('errors.mixed-content', 'errors', 'priority', 'Server and configuration', 'Insecure (http) content on a secure page', 'An https page loads a resource over plain http. Browsers block or warn about it, and the padlock is lost.', 'Change the resource address to https, or use a protocol-relative/secure CDN URL.', [g.http('Mixed Content', 'https://www.w3.org/TR/mixed-content/')], 5);
def('errors.no-charset', 'errors', 'other', 'Server and configuration', 'Character encoding not declared', 'Neither the Content-Type header nor a <meta charset> declares the encoding, so some characters may display incorrectly.', 'Add <meta charset="utf-8"> as the first element in <head>.', [g.html('charset', 'https://html.spec.whatwg.org/multipage/semantics.html#charset')], 5);
def('errors.soft-404', 'errors', 'other', 'Server and configuration', 'Error page returns status 200 (soft 404)', 'A "page not found" page is served with status 200, so search engines index it as real content.', 'Return status 404 for missing pages. Shopify returns 404 by default — check custom apps or redirects.', [g.google('soft 404', 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors#soft-404-errors')], 20);
def('errors.empty-page', 'errors', 'other', 'Content', 'Empty page', 'The page has no visible text or images.', 'Add content, or remove the page and links to it.', [g.bp('content')], 15);
def('errors.meta-refresh', 'errors', 'other', 'Server and configuration', 'Page uses meta refresh', 'The page reloads or redirects with <meta http-equiv="refresh">, which disorients users and is ignored by some search engines.', 'Use a server-side 301 redirect instead.', [g.wcag('2.2.1')], 10);
def('errors.spelling', 'errors', 'other', 'Spelling', 'Possible spelling mistake', 'A word on the page is not in the dictionary for the chosen language.', 'Correct the spelling, or ignore it if it is a brand or product name.', [g.bp('spelling')], 2);
def('errors.forbidden-text', 'errors', 'priority', 'Content rules', 'Forbidden text found', 'The page contains text from your forbidden-text list.', 'Remove or replace the text.', [g.bp('content policy')], 5);
def('errors.required-text', 'errors', 'priority', 'Content rules', 'Required text missing', 'The page does not contain text from your required-text list.', 'Add the required text (for example a legal notice or footer statement) to the page or template.', [g.bp('content policy')], 5);
def('errors.page-weight', 'errors', 'other', 'Page weight', 'Page is too heavy', 'The page and its resources together exceed the size limit set in scan options. Large pages load slowly on mobile networks.', 'Compress and resize images (Shopify image_url with width), lazy-load below-the-fold media and remove unused apps and scripts.', [g.google('Core Web Vitals', 'https://web.dev/articles/vitals')], 45);
def('errors.timeout', 'errors', 'priority', 'Server and configuration', 'Page timed out', 'The page did not finish loading within the page timeout.', 'Check slow server responses, heavy scripts and third-party apps.', [g.bp('performance')], 30);

// ── Search ────────────────────────────────────────────────────────────────────
const GSEO = 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide';
def('search.title-missing', 'search', 'priority', 'Google', 'Page title missing', 'The page has no <title>. Search engines show the title as the clickable headline in results.', 'Add a unique, descriptive <title> under 60 characters. In Shopify set it in the page/product SEO section.', [g.google('title links', 'https://developers.google.com/search/docs/appearance/title-link'), g.wcag('2.4.2')], 5);
def('search.title-long', 'search', 'other', 'Google', 'Page title too long', 'The title is longer than about 60 characters and will be cut off in Google results.', 'Shorten the title, keeping the most important words first.', [g.google('title links', 'https://developers.google.com/search/docs/appearance/title-link')], 3);
def('search.title-long-bing', 'search', 'other', 'Bing', 'Page title too long for Bing', 'Bing truncates titles longer than about 65 characters.', 'Shorten the title to 65 characters or fewer.', [g.bing('title')], 3);
def('search.title-short', 'search', 'other', 'Best practices', 'Page title too short', 'The title has fewer than 15 characters and probably does not describe the page.', 'Write a descriptive title, for example "Product name – Category – Brand".', [g.google('title links', 'https://developers.google.com/search/docs/appearance/title-link')], 3);
def('search.title-duplicate', 'search', 'other', 'Google', 'Duplicate page title', 'Several pages share the same title, so search engines struggle to tell them apart.', 'Give each page a unique title that reflects its content.', [g.google('title links', 'https://developers.google.com/search/docs/appearance/title-link')], 4);
def('search.description-missing', 'search', 'other', 'Google', 'Meta description missing', 'There is no meta description, so search engines pick a random snippet of page text.', 'Add a 70–160 character meta description that summarises the page.', [g.google('snippets', 'https://developers.google.com/search/docs/appearance/snippet')], 4);
def('search.description-missing-bing', 'search', 'priority', 'Bing', 'Meta description missing (Bing)', 'Bing relies heavily on the meta description for result snippets.', 'Add a 70–160 character meta description.', [g.bing('meta description')], 4);
def('search.description-long', 'search', 'other', 'Google', 'Meta description too long', 'The meta description is longer than about 160 characters and will be truncated.', 'Shorten the description to 160 characters or fewer.', [g.google('snippets', 'https://developers.google.com/search/docs/appearance/snippet')], 3);
def('search.description-short', 'search', 'other', 'Best practices', 'Meta description too short', 'The meta description is under 50 characters and gives searchers little reason to click.', 'Expand it to 70–160 characters.', [g.google('snippets', 'https://developers.google.com/search/docs/appearance/snippet')], 3);
def('search.description-duplicate', 'search', 'other', 'Google', 'Duplicate meta description', 'Several pages share the same meta description.', 'Write a unique description for each page.', [g.google('snippets', 'https://developers.google.com/search/docs/appearance/snippet')], 4);
def('search.h1-missing', 'search', 'other', 'Best practices', 'No main heading (h1)', 'The page has no <h1>. The main heading helps search engines and people understand the topic.', 'Add a single <h1> that names the page topic.', [g.google('headings', GSEO)], 5);
def('search.h1-multiple', 'search', 'warning', 'Best practices', 'More than one h1 heading', 'The page has several <h1> elements. This is allowed but often a sign of a theme that marks the logo or sections as h1.', 'Keep one h1 for the page topic and use h2–h6 for sections.', [g.google('headings', GSEO)], 10);
def('search.canonical-missing', 'search', 'warning', 'Google', 'Canonical URL missing', 'There is no <link rel="canonical">, so duplicate URLs (filters, tracking parameters) may compete in search.', 'Add a canonical link pointing at the preferred URL. Shopify themes output {{ canonical_url }}.', [g.google('canonicalization', 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls')], 10);
def('search.canonical-invalid', 'search', 'other', 'Google', 'Canonical URL is broken', 'The canonical link points to a URL that returns an error or redirects.', 'Point the canonical at a live page that returns 200.', [g.google('canonicalization', 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls')], 10);
def('search.noindex', 'search', 'warning', 'Google', 'Page excluded from search (noindex)', 'A robots meta tag or X-Robots-Tag header tells search engines not to index this page.', 'Remove noindex if the page should appear in search results.', [g.google('robots meta', 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag')], 5);
def('search.viewport-missing', 'search', 'priority', 'Google', 'Not mobile-friendly: no viewport', 'Without <meta name="viewport">, phones render the desktop layout zoomed out. Google indexes the mobile version first.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', [g.google('mobile-first indexing', 'https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing')], 5);
def('search.lang-missing', 'search', 'other', 'Bing', 'Page language not declared', 'The <html> element has no lang attribute; Bing uses it to target results by language and region.', 'Add lang, e.g. <html lang="en">. Shopify themes use {{ request.locale.iso_code }}.', [g.bing('language'), g.wcag('3.1.1')], 3);
def('search.structured-data-invalid', 'search', 'priority', 'Google', 'Structured data cannot be parsed', 'A JSON-LD block contains invalid JSON, so rich results (price, rating, stock) cannot be shown.', 'Fix the JSON syntax (often an unescaped quote from a product description in Liquid — use | json).', [g.google('structured data', 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data')], 15);
def('search.product-schema-missing', 'search', 'other', 'Google', 'Product page without Product structured data', 'This looks like a product page but has no schema.org Product markup, so it cannot earn price and availability rich results.', 'Output Product JSON-LD with name, image, offers (price, currency, availability). Most Shopify 2.0 themes support it.', [g.google('product snippets', 'https://developers.google.com/search/docs/appearance/structured-data/product')], 30);
def('search.og-missing', 'search', 'warning', 'Best practices', 'Social sharing tags missing', 'There are no Open Graph tags (og:title, og:image), so links shared on social media get a poor preview.', 'Add Open Graph tags; Shopify themes include them in social-meta-tags snippets.', [g.bp('Open Graph')], 10);
def('search.robots-blocked', 'search', 'other', 'robots.txt', 'Linked page blocked by robots.txt', 'Your own pages link to this URL but robots.txt stops search engines crawling it.', 'Unblock the path in robots.txt, or remove internal links to it if it should stay hidden.', [g.google('robots.txt', 'https://developers.google.com/search/docs/crawling-indexing/robots/intro')], 10);
def('search.robots-missing', 'search', 'other', 'robots.txt', 'robots.txt missing', 'The site has no robots.txt file. Search engines request it on every visit.', 'Add /robots.txt. Shopify generates one automatically and lets you customise it with robots.txt.liquid.', [g.google('robots.txt', 'https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt')], 10);
def('search.robots-no-sitemap', 'search', 'warning', 'robots.txt', 'robots.txt does not list a sitemap', 'robots.txt has no Sitemap: line, which helps search engines discover all pages.', 'Add "Sitemap: https://your-domain/sitemap.xml" to robots.txt.', [g.google('sitemaps', 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap')], 5);
def('search.url-uppercase', 'search', 'warning', 'Best practices', 'URL contains uppercase letters', 'URLs are case-sensitive; mixed-case URLs cause duplicate content and broken links.', 'Use lowercase URLs and redirect the uppercase versions.', [g.google('URL structure', 'https://developers.google.com/search/docs/crawling-indexing/url-structure')], 10);
def('search.url-underscore', 'search', 'warning', 'Google', 'URL uses underscores', 'Google treats hyphens, not underscores, as word separators in URLs.', 'Use hyphens in URL handles.', [g.google('URL structure', 'https://developers.google.com/search/docs/crawling-indexing/url-structure')], 10);
def('search.url-long', 'search', 'warning', 'Best practices', 'URL is very long', 'The URL is longer than 115 characters; long URLs are truncated in results and harder to share.', 'Use shorter, descriptive handles.', [g.google('URL structure', 'https://developers.google.com/search/docs/crawling-indexing/url-structure')], 10);
def('search.link-text-generic', 'search', 'other', 'Google', 'Non-descriptive link text', 'Links like "click here" or "read more" tell search engines nothing about the target page.', 'Use link text that describes the destination, e.g. "Read our sizing guide".', [g.google('anchor text', 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable#anchor-text-placement'), g.wcag('2.4.4')], 3);
def('search.thin-content', 'search', 'warning', 'Bing', 'Thin content', 'The page has fewer than 150 words of text. Bing and Google rank pages with substantial original content higher.', 'Add useful, original content — product details, FAQs, sizing, care instructions.', [g.bing('content')], 30);
def('search.hreflang-invalid', 'search', 'other', 'Google', 'Invalid hreflang value', 'An alternate-language link uses a language code that is not valid ISO 639-1 (optionally with ISO 3166-1 region).', 'Use codes like "en", "en-gb", "fr-ca" or "x-default".', [g.google('localized versions', 'https://developers.google.com/search/docs/specialty/international/localized-versions')], 10);
def('search.ddg-description', 'search', 'other', 'DuckDuckGo', 'No summary for DuckDuckGo', 'DuckDuckGo builds results from Bing plus its own sources and needs a meta description or clear opening paragraph.', 'Add a meta description and make the first paragraph summarise the page.', [g.ddg('results')], 5);
def('search.keyword-title', 'search', 'other', 'Keywords', 'Keyword missing from title', 'A keyword you asked to optimise does not appear in the page title.', 'Work the keyword naturally into the title.', [g.google('title links', 'https://developers.google.com/search/docs/appearance/title-link')], 5);
def('search.keyword-h1', 'search', 'warning', 'Keywords', 'Keyword missing from main heading', 'A keyword you asked to optimise does not appear in the h1.', 'Use the keyword in the main heading where it reads naturally.', [g.google('headings', GSEO)], 5);
def('search.keyword-description', 'search', 'warning', 'Keywords', 'Keyword missing from meta description', 'A keyword you asked to optimise does not appear in the meta description.', 'Mention the keyword in the description; Google bolds matching terms.', [g.google('snippets', 'https://developers.google.com/search/docs/appearance/snippet')], 5);

// ── Standards ─────────────────────────────────────────────────────────────────
def('standards.doctype-legacy', 'standards', 'warning', 'DOCTYPE', 'Legacy DOCTYPE', 'The page declares an HTML 4 or XHTML DOCTYPE. It was validated with the legacy parser.', 'Switch to <!doctype html>.', [g.html('DOCTYPE', 'https://html.spec.whatwg.org/multipage/syntax.html#the-doctype')], 10);
def('standards.doctype-legacy-modern', 'standards', 'other', 'DOCTYPE', 'Legacy DOCTYPE validated as HTML5', 'The page declares an old DOCTYPE but the scan is set to validate everything as modern HTML.', 'Switch to <!doctype html>.', [g.html('DOCTYPE', 'https://html.spec.whatwg.org/multipage/syntax.html#the-doctype')], 10);
def('standards.doctype-missing', 'standards', 'other', 'DOCTYPE', 'DOCTYPE missing', 'Without a DOCTYPE, browsers render the page in quirks mode with inconsistent layout.', 'Add <!doctype html> as the very first line.', [g.html('DOCTYPE', 'https://html.spec.whatwg.org/multipage/syntax.html#the-doctype')], 5);
def('standards.css-syntax', 'standards', 'other', 'CSS validation', 'CSS syntax error', 'The stylesheet contains a syntax error; browsers skip the broken rule.', 'Fix the syntax at the reported line.', [g.css('Syntax Level 3', 'https://www.w3.org/TR/css-syntax-3/')], 5);
def('standards.css-invalid-value', 'standards', 'warning', 'CSS validation', 'Invalid CSS property value', 'A CSS declaration has a value that does not match the property grammar, so browsers ignore it.', 'Correct the value or remove the declaration.', [g.css('Values and Units', 'https://www.w3.org/TR/css-values-4/')], 5);
def('standards.css-unknown-property', 'standards', 'warning', 'CSS validation', 'Unknown CSS property', 'The property name is not defined in any CSS specification (and is not vendor-prefixed or a custom property).', 'Check the spelling of the property.', [g.css('property index', 'https://www.w3.org/Style/CSS/all-properties.en.html')], 5);

// ── Usability ─────────────────────────────────────────────────────────────────
def('usability.new-window', 'usability', 'warning', 'Best practices', 'Link opens a new window without warning', 'The link uses target="_blank" but its text does not say it opens a new window, which disorients screen reader and mobile users.', 'Add "(opens in new tab)" visually or as visually-hidden text, or open links in the same tab.', [g.wcag('3.2.5')], 3);
def('usability.small-text', 'usability', 'other', 'Best practices', 'Text is too small to read', 'Text is rendered smaller than 12px, which is hard to read on phones.', 'Use at least 16px for body text and 12px for small print.', [g.google('mobile usability', 'https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing')], 10);
def('usability.horizontal-scroll', 'usability', 'priority', 'Best practices', 'Page scrolls sideways on phones', 'At 375px wide the page is wider than the screen, so visitors must scroll horizontally.', 'Find the element wider than the viewport (often a table, image or carousel) and make it responsive.', [g.wcag('1.4.10')], 30);
def('usability.no-favicon', 'usability', 'warning', 'Best practices', 'Site has no favicon', 'No favicon is declared or found at /favicon.ico; browser tabs and bookmarks show a blank icon.', 'Upload a favicon (Shopify: Theme settings › Logo › Favicon).', [g.bp('favicon')], 5);
def('usability.no-custom-404', 'usability', 'other', 'Best practices', 'Missing pages are not handled', 'Requesting a page that does not exist does not return a helpful 404 page with navigation.', 'Provide a 404 page with search and links to popular pages.', [g.bp('404 page')], 30);
def('usability.image-dimensions', 'usability', 'warning', 'Best practices', 'Image without width and height', 'Images without width and height attributes cause the layout to jump while loading (Cumulative Layout Shift).', 'Add width and height attributes (Shopify image_tag outputs them automatically).', [g.google('CLS', 'https://web.dev/articles/cls')], 3);
def('usability.too-many-links', 'usability', 'warning', 'Best practices', 'Page has too many links', 'The page has more than 300 links, which overwhelms visitors and dilutes link value.', 'Simplify the mega-menu and footer; paginate long lists.', [g.bp('navigation')], 60);
def('usability.pdf-link-unmarked', 'usability', 'warning', 'Best practices', 'Link to a document does not say so', 'A link to a PDF or Office file does not mention the file type, so visitors are surprised by a download.', 'Add the file type and size to the link text, e.g. "Size guide (PDF, 1 MB)".', [g.bp('links to documents')], 3);
def('usability.autocomplete-missing', 'usability', 'warning', 'Best practices', 'Form field without autocomplete', 'Name, email, address and phone fields without autocomplete make checkout and sign-up slower on mobile.', 'Add autocomplete values, e.g. autocomplete="email".', [g.wcag('1.3.5')], 3);
def('usability.long-sentences', 'usability', 'other', 'Readability', 'Long sentences', 'The page has several sentences longer than 30 words, which are hard to scan.', 'Split long sentences; aim for 15–20 words on average.', [g.bp('plain language')], 20);
def('usability.hard-to-read', 'usability', 'other', 'Readability', 'Text is hard to read', 'The Flesch reading ease score is below 50 (fairly difficult).', 'Use shorter words and sentences, and bullet lists for features.', [g.bp('plain language')], 30);

// ── Accessibility extras (beyond axe-core) ────────────────────────────────────
def('accessibility.reading-age', 'accessibility', 'warning', 'Reading age', 'Reading level above target', 'The text needs a higher reading level than the target set in scan options (WCAG 3.1.5, Level AAA advises supplemental content).', 'Simplify the wording or add a plain-language summary.', [g.wcag('3.1.5')], 45);
def('accessibility.sr-title-only', 'accessibility', 'other', 'Screen readers', 'Control labelled only by a title attribute', 'The title attribute is read inconsistently by JAWS, NVDA and VoiceOver and never shown on touch screens.', 'Give the control visible text, a <label>, or aria-label.', [g.sr('JAWS / NVDA / VoiceOver'), g.wcag('4.1.2')], 5);
def('accessibility.sr-aria-label-generic', 'accessibility', 'other', 'Screen readers', 'aria-label on an element without a role', 'aria-label on a plain <div> or <span> is ignored by NVDA and VoiceOver because the element has no role.', 'Move the label to an interactive element or add an appropriate role.', [g.sr('NVDA / VoiceOver'), { label: 'ARIA 1.3 naming prohibited', url: 'https://w3c.github.io/aria/#namefromprohibited' }], 5);
def('accessibility.sr-role-application', 'accessibility', 'warning', 'Screen readers', 'role="application" changes screen reader mode', 'role="application" switches JAWS and NVDA out of browse mode, so normal reading keys stop working.', 'Remove role="application" unless the widget implements all keyboard interaction itself.', [g.sr('JAWS / NVDA'), { label: 'ARIA 1.3 application', url: 'https://w3c.github.io/aria/#application' }], 20);
def('accessibility.sr-alt-filename', 'accessibility', 'priority', 'Screen readers', 'Image alt text is a file name', 'Screen readers read out alt text such as "IMG_2034.jpg" or "product-1_large.png", which is meaningless.', 'Describe the image, e.g. "Navy linen shirt, front view". In Shopify edit the alt text in Files or the product media.', [g.wcag('1.1.1')], 3);
def('accessibility.sr-layout-table', 'accessibility', 'warning', 'Screen readers', 'Table used for layout', 'A table without headers is used for layout; screen readers announce rows and columns that do not exist.', 'Use CSS for layout, or add role="presentation" to the table.', [g.wcag('1.3.1')], 30);
def('accessibility.pdf-untagged', 'accessibility', 'priority', 'PDF/UA', 'PDF is not tagged', 'The PDF has no structure tags, so screen readers cannot follow headings, lists or reading order.', 'Re-export the PDF with tags (Word: Save as PDF › Document structure tags) or remediate in Acrobat.', [g.pdfua('7.1'), g.wcag('1.3.1')], 60);
def('accessibility.pdf-no-lang', 'accessibility', 'other', 'PDF/UA', 'PDF language not set', 'The PDF does not declare its language, so screen readers may use the wrong pronunciation.', 'Set the document language in File › Properties › Advanced.', [g.pdfua('7.2'), g.wcag('3.1.1')], 5);
def('accessibility.pdf-no-title', 'accessibility', 'other', 'PDF/UA', 'PDF has no title', 'The PDF has no document title or does not display it, so the window shows only the file name.', 'Set a title in Properties and enable "Show document title" in Initial View.', [g.pdfua('7.1'), g.wcag('2.4.2')], 5);
def('accessibility.pdf-image-only', 'accessibility', 'priority', 'PDF/UA', 'PDF contains no text (scanned image)', 'The PDF has no text layer — it is a scanned image that screen readers cannot read.', 'Run OCR and tag the document, or publish the content as an HTML page.', [g.pdfua('7.3'), g.wcag('1.1.1')], 90);
// WCAG failure techniques and sufficient-technique checks (implemented from the W3C technique documents).
const wcagF = (id: string, sc: string): GuidelineRef => ({ label: `WCAG ${WCAG_BY_NUM.get(sc)?.level ?? ''} ${id}`.replace(/\s+/g, ' '), url: `https://www.w3.org/WAI/WCAG22/Techniques/failures/${id}` });
def('accessibility.f24-colors', 'accessibility', 'other', 'Level AA', 'Text colour set without a background colour (or the reverse)', 'People with low vision often set their own text and background colours. When a page sets only one of the two, the other comes from the user and the combination can become unreadable.', 'Whenever you set a text colour, also set a background colour on the same element or an ancestor, and vice versa (W3C failure F24).', [wcagF('F24', '1.4.3'), g.wcag('1.4.3'), g.wcag('1.4.6'), g.wcag('1.4.8')], 10);
def('accessibility.f78-focus', 'accessibility', 'other', 'Level AA', 'Focus outline removed without a visible replacement', 'The CSS turns off the keyboard focus outline (outline: none or 0) and gives no other focus style, so keyboard users cannot see where they are on the page.', 'Keep the default outline, or add a clearly visible :focus-visible style (outline, box-shadow or border) for the element (W3C failure F78).', [wcagF('F78', '2.4.7'), g.wcag('2.4.7')], 10);
def('accessibility.animation-5s', 'accessibility', 'priority', 'Level A', 'CSS animation runs for more than 5 seconds with no way to stop it', 'Moving content that starts automatically and lasts more than five seconds distracts people with attention or vestibular disorders, and there is no pause control or reduced-motion alternative.', 'Stop the animation within 5 seconds, add a visible pause button, or disable it in an @media (prefers-reduced-motion: reduce) rule.', [g.wcag('2.2.2')], 20);
def('accessibility.f87-css-content', 'accessibility', 'priority', 'Level A', 'Text is inserted with CSS', 'Text added with CSS ::before or ::after content is lost for people who turn off or override styles, and some screen readers skip it.', 'Put meaningful text in the HTML; use CSS-generated content only for decoration (W3C failure F87).', [wcagF('F87', '1.3.1'), g.wcag('1.3.1')], 10);
def('accessibility.link-purpose', 'accessibility', 'priority', 'Level A', "Link text like 'Read more' does not describe its purpose", "Screen reader users often move from link to link; 'Read more', 'Click here' or 'Learn more' heard on their own do not say where the link goes.", "Make the link text descriptive (e.g. 'Read more about Echinacea root'), or add visually hidden text or an aria-label that includes the destination.", [g.wcag('2.4.4')], 3);
def('accessibility.title-placeholder', 'accessibility', 'priority', 'Level A', 'Page title is a placeholder', "The page title is generic (e.g. 'Untitled', 'Blog' or a file name), so people using screen readers or many tabs cannot tell pages apart.", 'Give every page a unique title that describes its content, e.g. "Pet health articles – Glacier Peak Holistics".', [g.wcag('2.4.2')], 5);
def('accessibility.password-autocomplete', 'accessibility', 'other', 'Level AA', 'Password field without autocomplete', 'Without autocomplete="current-password" or "new-password", password managers and browsers cannot fill the field, which is a barrier for people with memory or motor impairments.', 'Add autocomplete="current-password" for sign-in fields and autocomplete="new-password" for new passwords.', [g.wcag('1.3.5')], 3);
def('accessibility.aria-redundant', 'accessibility', 'warning', 'Warnings', 'Redundant ARIA attribute or role', 'The ARIA attribute or role repeats what the HTML already says (for example aria-disabled on a disabled button, or role="heading" on an h2). It adds noise and can conflict with native semantics.', 'Remove the redundant ARIA and rely on the native HTML attribute or element.', [{ label: 'ARIA in HTML', url: 'https://www.w3.org/TR/html-aria/' }], 2);
def('accessibility.aria-disabled-link', 'accessibility', 'warning', 'Warnings', 'aria-disabled="true" used on a link', 'A link marked aria-disabled still works when activated, so assistive technology says it is disabled while it is not.', 'Remove the href (or use a button with the disabled attribute) when the link really is unavailable; otherwise drop aria-disabled.', [{ label: 'ARIA in HTML', url: 'https://www.w3.org/TR/html-aria/' }], 3);

def('accessibility.nested-interactive', 'accessibility', 'priority', 'Level A', 'Interactive element inside a link or button', 'HTML does not allow a link or button to contain another interactive element (button, link, form field, or anything focusable). Screen readers announce the pair unpredictably, and keyboard users meet two tab stops for one control.', 'Move the inner control outside the link or button, or turn the outer element into a plain container.', [g.wcag('4.1.2')], 3);

def('accessibility.static-fallback', 'accessibility', 'warning', 'Warnings', 'Accessibility checked without a browser', 'Chrome was not available, so only static accessibility checks ran. Contrast and rendered-DOM checks were skipped.', 'Install Google Chrome (or set CHROME_PATH) and rescan.', [g.bp('scanner')], 0);

// ── Axe-core (accessibility & ARIA) — imported from the bundled axe rule metadata ─────
const AXE_EFFORT: Record<string, number> = {
  'color-contrast': 10,
  'image-alt': 3,
  label: 5,
  'link-name': 4,
  'button-name': 4,
  region: 30,
  'landmark-one-main': 15,
  'heading-order': 10,
  'duplicate-id': 5,
  'target-size': 10,
};

/** WCAG level of an axe rule from its tags (highest-priority level wins). */
export function axeLevel(tags: string[]): 'A' | 'AA' | 'AAA' | null {
  if (tags.some((t) => /^wcag2\d?a$/.test(t))) return 'A';
  if (tags.some((t) => /^wcag2\d?aa$/.test(t))) return 'AA';
  if (tags.some((t) => /^wcag2\d?aaa$/.test(t))) return 'AAA';
  return null;
}

export function axeGuidelines(tags: string[], ruleId: string): GuidelineRef[] {
  const out: GuidelineRef[] = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    if (m) out.push(g.wcag(`${m[1]}.${m[2]}.${m[3]}`));
  }
  if (tags.includes('cat.aria') || ruleId.startsWith('aria-')) out.push({ label: 'WAI-ARIA 1.3', url: 'https://w3c.github.io/aria/' });
  if (tags.some((t) => t.startsWith('section508'))) out.push({ label: 'Section 508', url: 'https://www.section508.gov/develop/guide-accessible-web-design-development/' });
  if (tags.some((t) => t.startsWith('EN-301-549'))) out.push({ label: 'EN 301 549', url: 'https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf' });
  if (tags.includes('best-practice')) out.push(g.bp('(Deque axe)'));
  return out;
}

export const isAriaRule = (ruleId: string, tags: string[]) => ruleId.startsWith('aria-') || tags.includes('cat.aria');

export function axeSection(tags: string[], ruleId: string): string {
  const level = axeLevel(tags);
  if (level) return `Level ${level}`;
  if (isAriaRule(ruleId, tags)) return 'ARIA';
  return 'Warnings';
}

for (const r of axe.getRules()) {
  const level = axeLevel(r.tags);
  const severity: Severity = level === 'A' ? 'priority' : level ? 'other' : 'warning';
  def(
    `axe.${r.ruleId}`,
    'accessibility',
    severity,
    axeSection(r.tags, r.ruleId),
    r.help,
    `${r.description}.`,
    'See the affected elements below and the linked guidance for how to fix them. Automated testing finds only part of accessibility problems; review with a keyboard and a screen reader too.',
    axeGuidelines(r.tags, r.ruleId),
    AXE_EFFORT[r.ruleId] ?? 8,
    r.helpUrl.replace(/\?application=axeAPI$/, ''),
  );
}

// ── Dynamic registration (html-validate rules, browser compatibility features) ────
export function registerRule(rule: Omit<RuleDef, 'version'> & { version?: string }): RuleDef {
  const existing = RULES.get(rule.id);
  if (existing) return existing;
  const full = { ...rule, version: rule.version ?? ENGINE_VERSION };
  RULES.set(full.id, full);
  persistRule(full);
  return full;
}

export const getRule = (id: string) => RULES.get(id);
export const allRules = () => [...RULES.values()];

function persistRule(r: RuleDef) {
  q.run(
    `INSERT INTO rules (id, category, severity, section, title, description, fix, guidelines_json, effort_minutes, help_url, version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET category=excluded.category, severity=excluded.severity, section=excluded.section, title=excluded.title,
       description=excluded.description, fix=excluded.fix, guidelines_json=excluded.guidelines_json, effort_minutes=excluded.effort_minutes,
       help_url=excluded.help_url, version=excluded.version`,
    [r.id, r.category, r.severity, r.section, r.title, r.description, r.fix, JSON.stringify(r.guidelines), r.effortMinutes, r.helpUrl, r.version],
  );
}

/** Loads dynamically registered rules saved by earlier scans, then persists the static catalog. */
export function syncRuleCatalog() {
  for (const row of q.all<{ id: string; category: Category; severity: Severity; section: string; title: string; description: string; fix: string; guidelines_json: string; effort_minutes: number; help_url: string | null; version: string }>('SELECT * FROM rules')) {
    if (!RULES.has(row.id)) {
      RULES.set(row.id, { id: row.id, category: row.category, severity: row.severity, section: row.section, title: row.title, description: row.description, fix: row.fix, guidelines: JSON.parse(row.guidelines_json), effortMinutes: row.effort_minutes, helpUrl: row.help_url, version: row.version });
    }
  }
  for (const r of RULES.values()) persistRule(r);
}

/** Number of rules applicable to a scan's options (shown as "checked by N rules"). */
export function countActiveRules(enabled: Record<Category, boolean>): number {
  return allRules().filter((r) => enabled[r.category]).length;
}
