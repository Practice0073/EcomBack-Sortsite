/**
 * HTML/PDF rendering of the "Issue Report" format — the same structure as the Word export
 * (issueReportDocx.ts), so every format a client receives reads the same way.
 */
import { CATEGORY_LABELS } from '../../shared/options.js';
import { logoDataUri, PRODUCT_NAME, toDataUri } from './branding.js';
import { severityIcon, SEVERITY_ICON_LABEL } from './icons.js';
import { buildIssueReport, foundOnText, sectionCountText, type IssueEntry, type Segment } from './issueReport.js';
import type { ReportModel } from './model.js';
import { GENERIC_FIX } from './issueReportDocx.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const segs = (list: Segment[]) => list.map((s) => (s.marked ? `<code class="mark">${esc(s.text)}</code>` : s.code ? `<code>${esc(s.text)}</code>` : esc(s.text))).join('');

const iconImg = (sev: IssueEntry['severity']) => `<img class="sev" src="${toDataUri(severityIcon(sev), 'image/png')}" alt="${SEVERITY_ICON_LABEL[sev]}" width="15" height="15">`;

function issueHtml(issue: IssueEntry, showOccurrences: boolean): string {
  const guides = issue.guidelines.map((g) => (g.url ? `<a href="${esc(g.url)}">${esc(g.label)}</a>` : esc(g.label))).join(' ');
  const parts = [
    `<p class="issue">${iconImg(issue.severity)}<span>${segs(issue.title)}</span></p>`,
    `<p class="details">${segs(issue.description)}</p>`,
    issue.fix && !GENERIC_FIX.test(issue.fix) ? `<p class="details"><strong>How to fix:</strong> ${esc(issue.fix)}</p>` : '',
    guides || issue.templateLevel ? `<p class="details">${guides}${issue.templateLevel ? `${guides ? ' &nbsp; ' : ''}<em class="theme">Theme-level: fix once in a shared template</em>` : ''}</p>` : '',
  ];
  if (!showOccurrences) {
    parts.push(`<p class="details page-link"><em>${foundOnText(issue)}</em></p>`);
  } else {
    for (const page of issue.pages) {
      for (const line of page.lines) {
        if (line.segments.length || line.line) parts.push(`<p class="snippet">${segs(line.segments)}${line.line ? ` line ${line.line}` : ''}</p>`);
        if (line.detail) parts.push(`<p class="details note">${esc(line.detail)}</p>`);
      }
      if (page.more) parts.push(`<p class="details note">and ${page.more} more on this page</p>`);
      parts.push(`<p class="details page-link"><a href="${esc(page.url)}">${esc(page.url)}</a></p>`);
    }
    if (issue.morePages) parts.push(`<p class="details page-link note">and ${issue.morePages.toLocaleString()} more ${issue.morePages === 1 ? 'page' : 'pages'} (raise “Max pages shown per issue” in scan options to list them)</p>`);
  }
  return `<div class="issue-block">${parts.join('')}</div>`;
}

export function renderIssueReportHtml(m: ReportModel, opts: { print: boolean }): string {
  const r = buildIssueReport(m);
  const bar = (pct: number) => `<span class="bar" role="img" aria-label="${Math.round(pct)}% of pages"><span style="width:${Math.max(pct > 0 ? 4 : 0, Math.min(100, pct))}%"></span></span>`;
  const summary = `<table class="summary"><caption class="sr-only">Summary</caption><tbody>
    ${r.summary.map((s) => `<tr><th scope="row">${esc(s.label)}</th><td>${bar(s.pct)}</td><td>${esc(s.text)}</td></tr>`).join('')}
    <tr><th scope="row">Totals</th><td></td><td>${r.totalUrls.toLocaleString()} URLs checked</td></tr></tbody></table>`;

  const body: string[] = [`<h1 class="title">${esc(r.title)}</h1>`, `<p class="intro">${esc(r.intro)}</p>`, summary];
  if (m.type === 'executive') {
    body.push(`<h2 class="h1 break">Top issues to fix</h2><p>The highest-impact fixes for the effort they take.</p>`);
    for (const f of r.topFixes) body.push(`<div class="issue-block"><p class="issue">${iconImg(f.severity)}<span>${esc(f.title)}</span></p><p class="details note">${f.pages.toLocaleString()} ${f.pages === 1 ? 'page' : 'pages'} · estimated effort ${f.effort}${f.templateLevel ? ' · theme-level' : ''}</p></div>`);
  }
  for (const [ci, cat] of r.categories.entries()) {
    body.push(`<section aria-labelledby="cat-${cat.category}"><h2 class="h1 ${ci === 0 || m.type !== 'summary' ? 'break' : ''}" id="cat-${cat.category}">${esc(CATEGORY_LABELS[cat.category])}</h2><p>${esc(cat.intro)}</p>`);
    for (const sec of cat.sections) {
      body.push(`<h3 class="h2">${esc(sec.name)}</h3><p class="count">${esc(sectionCountText(sec))}</p>`);
      for (const issue of sec.issues) body.push(issueHtml(issue, r.showOccurrences));
    }
    body.push('</section>');
  }

  const screenHeader = opts.print
    ? ''
    : `<header class="screen-head"><img src="${logoDataUri()}" alt="Ecomback" height="22"><span>${esc(r.url)}</span><span>${esc(r.date)}</span></header>`;
  const screenFooter = opts.print ? '' : `<footer class="screen-foot">${PRODUCT_NAME}</footer>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)} — ${esc(r.url)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #111; font: 12pt/1.45 Calibri, Carlito, 'Segoe UI', Arial, sans-serif; }
  main { max-width: ${opts.print ? 'none' : '820px'}; margin: 0 auto; padding: ${opts.print ? '0' : '24px 20px 48px'}; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .title, .h1, .h2 { font-family: 'Calibri Light', Calibri, Carlito, 'Segoe UI', Arial, sans-serif; }
  .title { font-size: 28pt; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em; }
  .intro { margin: 12px 0 22px; }
  .summary { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
  .summary th { text-align: left; font-weight: 400; width: 21%; padding: 0 8px 5px 0; vertical-align: middle; }
  .summary td { padding: 0 8px 5px 0; vertical-align: middle; }
  .summary td:nth-child(2) { width: 30%; }
  .bar { display: block; height: 13px; background: #eee; }
  .bar > span { display: block; height: 100%; background: #d02020; }
  .h1 { font-size: 18pt; font-weight: 700; margin: 12pt 0 4pt; page-break-after: avoid; }
  .h1.break { page-break-before: always; break-before: page; }
  .h2 { font-size: 15pt; font-weight: 700; margin: 12pt 0 4pt; page-break-after: avoid; }
  .count { margin: 0 0 14pt; }
  .issue-block { margin-bottom: 4pt; }
  .issue { display: flex; gap: 10px; align-items: baseline; margin: 0 0 6pt; page-break-after: avoid; }
  .issue .sev { flex: none; position: relative; top: 2px; }
  .details, .snippet { margin: 0 0 6pt 25px; }
  .snippet { page-break-after: avoid; }
  .page-link { margin-bottom: 15pt; }
  .note { color: #555; font-style: italic; font-size: 10.5pt; }
  .theme { color: #1a1ca8; }
  code { font: inherit; background: #fafafa; border: 1px solid #e8e8e8; padding: 0 2px; word-break: break-word; }
  code.mark { color: #800000; text-decoration: underline dotted #f00000; }
  a { color: #0563c1; word-break: break-all; }
  .screen-head { display: flex; align-items: center; gap: 14px; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid #e3e5ee; font-size: 10pt; color: #444; }
  .screen-head span:first-of-type { flex: 1; }
  .screen-foot { text-align: center; color: #666; font-size: 9pt; padding: 24px; border-top: 1px solid #e3e5ee; }
  @media print { a { color: #0563c1; } }
</style></head>
<body>${screenHeader}<main>${body.join('\n')}</main>${screenFooter}</body></html>`;
}
