import { CATEGORY_LABELS } from '../../shared/options.js';
import { SEVERITY_LABELS, type IssueGroup, type Severity } from '../../shared/types.js';
import { BRAND, PRODUCT_NAME, formatBytes, formatDate, formatMinutes, logoDataUri } from './branding.js';
import { buildModel, narrative, REPORT_TYPE_LABELS, type ReportModel, type ReportType } from './model.js';

export interface HtmlOptions {
  /** Print mode adds page breaks for the PDF renderer (header/footer come from the PDF templates). */
  print?: boolean;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SEV_COLOR: Record<Severity, string> = { priority: BRAND.red, other: BRAND.amber, warning: '#4B5563' };
const BUCKET_LABEL = { 'quick-win': 'Quick win', major: 'Major project', 'fill-in': 'Fill-in', later: 'Later' } as const;

export function buildReportHtml(scanId: number, reportType: ReportType, opts: HtmlOptions = {}): string {
  return renderReportHtml(buildModel(scanId, reportType), opts);
}

export function renderReportHtml(m: ReportModel, opts: HtmlOptions = {}): string {
  const title = `${REPORT_TYPE_LABELS[m.type]} — ${m.site.url}`;
  const sections: string[] = [cover(m), overview(m)];
  if (m.type === 'summary' || m.type === 'full') sections.push(tested(m), categoryIssueLists(m));
  if (m.type === 'issues-only' || m.type === 'full') sections.push(issuesWithOccurrences(m));
  if (m.type === 'full') sections.push(pagesTable(m), inventoryTable(m), diagnosticsList(m));
  if (m.type === 'full') sections.push(fixPlanTable(m, m.fixPlan.items.length));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${css(opts.print === true)}</style>
</head>
<body>
<main id="report">
${sections.join('\n')}
</main>
<footer class="doc-footer"><p>${esc(PRODUCT_NAME)} · ${esc(m.client?.name ?? '')}${m.client ? ' · ' : ''}Generated ${esc(formatDate(new Date().toISOString()))} · <a href="https://www.ecomback.com">ecomback.com</a></p></footer>
</body>
</html>`;
}

function css(print: boolean): string {
  return `
:root{--navy:${BRAND.navy};--coral:${BRAND.coral};--red:${BRAND.red};--amber:${BRAND.amber};--green:${BRAND.green};--ink:${BRAND.ink};--muted:${BRAND.muted};--line:${BRAND.line};--soft:${BRAND.soft}}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:var(--ink);font-family:Poppins,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55}
main{max-width:1000px;margin:0 auto;padding:${print ? '0' : '32px 24px'}}
h1,h2,h3,h4{color:var(--navy);line-height:1.25;margin:0 0 .5em}
h1{font-size:30px;font-weight:700}
h2{font-size:21px;font-weight:600;margin-top:1.6em;padding-bottom:6px;border-bottom:3px solid var(--coral)}
h3{font-size:16px;font-weight:600;margin-top:1.3em}
h4{font-size:14px;font-weight:600;margin-top:1em;color:var(--ink)}
a{color:var(--navy)}
p{margin:.4em 0 .8em}
.muted{color:var(--muted)}
section{margin-bottom:28px}
.cover{min-height:${print ? '235mm' : '520px'};display:flex;flex-direction:column;justify-content:space-between;padding:${print ? '10mm 0 0' : '40px'};${print ? '' : 'border:1px solid var(--line);border-radius:16px;'}${print ? 'page-break-after:always;break-after:page;' : ''}}
.cover-top{display:flex;justify-content:space-between;align-items:center;gap:24px}
.cover-top img.logo{width:200px;height:auto}
.cover-top img.client-logo{max-height:56px;max-width:180px}
.cover-title{margin-top:auto}
.cover-title .kicker{color:var(--coral);font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
.cover-title h1{font-size:38px;margin:.2em 0 .3em}
.cover-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 32px;margin-top:28px;padding:20px;background:var(--soft);border-radius:12px}
.cover-meta dt{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.cover-meta dd{margin:2px 0 0;font-weight:600;word-break:break-all}
.cover-band{height:10px;background:linear-gradient(90deg,var(--navy) 0 70%,var(--coral) 70% 100%);border-radius:6px;margin-top:28px}
.kpis{display:grid;grid-template-columns:220px 1fr;gap:28px;align-items:center}
.kpi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.kpi{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.kpi .v{font-size:22px;font-weight:700;color:var(--navy)}
.kpi .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid currentColor}
.badge.better{color:var(--green)}.badge.worse{color:var(--red)}.badge.average{color:var(--amber)}
.bars{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 28px}
.bar-card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;break-inside:avoid}
.bar-card h3{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between}
.bar{margin:6px 0}
.bar .lbl{display:flex;justify-content:space-between;font-size:12px}
.bar .track{height:8px;background:#ECEEF4;border-radius:999px;overflow:hidden}
.bar .fill{height:100%;background:var(--red);border-radius:999px}
.bar .fill.ok{background:var(--green)}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:12px}
caption{text-align:left;font-weight:600;color:var(--navy);padding:4px 0 8px}
th{background:var(--navy);color:#fff;text-align:left;font-weight:600;padding:7px 9px}
td{padding:6px 9px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
tr{break-inside:avoid}
tbody tr:nth-child(even) td{background:#FAFBFD}
td.num,th.num{text-align:right;white-space:nowrap}
.sev{font-weight:600;white-space:nowrap}
.sev::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:currentColor;vertical-align:middle}
.chip{display:inline-block;margin:1px 4px 1px 0;padding:1px 7px;border-radius:6px;background:#EEF0FF;color:var(--navy);font-size:11px;font-weight:500;white-space:nowrap;text-decoration:none}
.tmpl{display:inline-block;padding:1px 7px;border-radius:6px;background:#FFF1EE;color:#8A2A1A;font-size:11px;font-weight:600}
.issue{border:1px solid var(--line);border-left:5px solid var(--red);border-radius:10px;padding:12px 14px;margin:12px 0;break-inside:avoid-page}
.issue.other{border-left-color:var(--amber)}.issue.warning{border-left-color:#6B7280}
.issue h4{margin:0 0 4px}
.issue .fix{background:#F1FAF4;border-radius:8px;padding:8px 10px;margin:8px 0}
.occ{margin:8px 0 0}
.occ .url{font-weight:600;word-break:break-all}
pre{margin:4px 0 8px;padding:8px 10px;background:#0F1330;color:#E8EAF6;border-radius:8px;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-all;font-family:"SFMono-Regular",Menlo,Consolas,monospace}
.ln{color:var(--muted);font-size:11px}
.narrative{font-size:14px;background:var(--soft);border-radius:12px;padding:14px 16px}
.nowrap{white-space:nowrap}
.check{color:var(--green);font-weight:700}.cross{color:var(--muted)}
tr.off td{color:var(--muted)}
.doc-footer{max-width:1000px;margin:24px auto 0;padding:14px 24px;border-top:3px solid var(--coral);color:var(--muted);font-size:11px}
@media print{
  main{max-width:none}
  h2,h3,h4{break-after:avoid}
  .page-break{break-before:page}
  .doc-footer{display:none}
}`;
}

function cover(m: ReportModel): string {
  const s = m.summary;
  return `<section class="cover" aria-label="Report cover">
  <div class="cover-top">
    <img class="logo" src="${logoDataUri()}" alt="Ecomback">
    ${m.client?.logo ? `<img class="client-logo" src="${m.client.logo.dataUri}" alt="${esc(m.client.name)}">` : ''}
  </div>
  <div class="cover-title">
    <p class="kicker">${esc(PRODUCT_NAME)}</p>
    <h1>${esc(REPORT_TYPE_LABELS[m.type])}</h1>
    <p class="muted" style="font-size:16px;word-break:break-all">${esc(m.site.url)}</p>
    <dl class="cover-meta">
      ${m.client ? `<div><dt>Client</dt><dd>${esc(m.client.name)}</dd></div>` : ''}
      <div><dt>Scan date</dt><dd>${esc(formatDate(m.scanDate))}</dd></div>
      <div><dt>Scope</dt><dd>${esc(m.scopeLabel)}</dd></div>
      <div><dt>Pages and files checked</dt><dd>${s.pagesChecked}</dd></div>
      <div><dt>Rules applied</dt><dd>${s.rulesChecked}</dd></div>
      <div><dt>Standard</dt><dd>WCAG ${esc(m.options.rules.accessibility.wcagVersion)} Level ${esc(m.options.rules.accessibility.wcagLevel)}</dd></div>
      ${m.scan.status !== 'completed' ? `<div><dt>Scan status</dt><dd>${esc(m.scan.status)} — partial results</dd></div>` : ''}
    </dl>
    <div class="cover-band" aria-hidden="true"></div>
  </div>
</section>`;
}

function gauge(pct: number, label: string): string {
  const r = 70;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  const color = v <= 10 ? BRAND.green : v <= 40 ? BRAND.amber : BRAND.red;
  return `<svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="${esc(label)}">
  <circle cx="100" cy="100" r="${r}" fill="none" stroke="#ECEEF4" stroke-width="20"/>
  <circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round" stroke-dasharray="${((v / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 100 100)"/>
  <text x="100" y="98" text-anchor="middle" font-family="Poppins,Arial,sans-serif" font-size="34" font-weight="700" fill="${BRAND.navy}">${Math.round(v)}%</text>
  <text x="100" y="122" text-anchor="middle" font-family="Poppins,Arial,sans-serif" font-size="12" fill="${BRAND.muted}">pages with issues</text>
</svg>`;
}

function overview(m: ReportModel): string {
  const s = m.summary;
  const bench = s.benchmark;
  const benchText = bench.label === 'average' ? 'About average' : bench.label === 'better' ? 'Better than average' : 'Worse than average';
  const cards = s.categories
    .filter((c) => c.enabled)
    .map(
      (c) => `<div class="bar-card"><h3><span>${esc(CATEGORY_LABELS[c.category])}</span><span class="muted" style="font-weight:500">${c.issuePct}% of pages</span></h3>
      ${c.bars.map((b) => `<div class="bar"><div class="lbl"><span>${esc(b.label)}</span><span>${b.pct}%</span></div><div class="track"><div class="fill${b.pct === 0 ? ' ok' : ''}" style="width:${Math.max(b.pct, b.pct > 0 ? 2 : 0)}%"></div></div></div>`).join('')}
      <p class="muted" style="margin:8px 0 0;font-size:11px">${c.priorityCount} priority · ${c.otherCount} other · ${c.warningCount} warnings</p></div>`,
    )
    .join('');
  return `<section aria-labelledby="h-overview" class="${m.type === 'executive' ? '' : ''}">
  <h2 id="h-overview">Overview</h2>
  <div class="kpis">
    <div>${gauge(s.scan.issuePct, `${s.scan.issuePct}% of pages have quality issues`)}</div>
    <div>
      <p style="font-size:16px;margin-top:0"><strong>${s.pagesWithIssues}</strong> pages with quality issues out of <strong>${s.pagesChecked}</strong> pages and files checked by <strong>${s.rulesChecked}</strong> rules.</p>
      <div class="kpi-grid">
        <div class="kpi"><div class="l">ADA / WCAG score</div><div class="v">${s.complianceScore}<span class="muted" style="font-size:14px"> / 100 · ${esc(m.grade)}</span></div></div>
        <div class="kpi"><div class="l">Priority issues</div><div class="v" style="color:${BRAND.red}">${s.scan.priorityPct}%</div><div class="muted" style="font-size:11px">of pages</div></div>
        <div class="kpi"><div class="l">Benchmark</div><div class="v" style="font-size:16px"><span class="badge ${bench.label}">${esc(benchText)}</span></div><div class="muted" style="font-size:11px">average ${bench.value}%</div></div>
      </div>
      <p class="muted" style="font-size:11px">${esc(bench.source)}</p>
    </div>
  </div>
  <h3>Summary</h3>
  <p class="narrative">${esc(narrative(m))}</p>
  <h3>Results by category</h3>
  <div class="bars">${cards}</div>
  ${m.type === 'full' ? '' : fixPlanTable(m, 10)}
</section>`;
}

function fixPlanTable(m: ReportModel, limit: number): string {
  const items = m.fixPlan.items.slice(0, limit);
  if (!items.length) return '';
  const heading = limit >= m.fixPlan.items.length ? 'Prioritized fix plan' : `Top ${items.length} fixes`;
  return `<section aria-labelledby="h-fix" class="${m.type === 'full' ? 'page-break' : ''}">
  <h2 id="h-fix">${heading}</h2>
  <p class="muted">Ranked by impact (severity × pages affected) per minute of estimated effort. Total estimated effort for all ${m.fixPlan.items.length} items: <strong>${esc(formatMinutes(m.fixPlan.totalMinutes))}</strong>.</p>
  <table>
    <thead><tr><th scope="col">#</th><th scope="col">Issue</th><th scope="col">Severity</th><th scope="col" class="num">Pages</th><th scope="col" class="num">Effort</th><th scope="col">Type</th></tr></thead>
    <tbody>${items
      .map(
        (it, i) => `<tr><td class="num">${i + 1}</td><td>${esc(it.title)}<br><span class="muted" style="font-size:11px">${esc(CATEGORY_LABELS[it.category])}</span>${it.templateLevel ? ' <span class="tmpl">Theme-level: fix once</span>' : ''}</td><td>${sev(it.severity)}</td><td class="num">${it.pageCount}</td><td class="num">${esc(formatMinutes(it.effortMinutes))}</td><td class="nowrap">${BUCKET_LABEL[it.bucket]}</td></tr>`,
      )
      .join('')}</tbody>
  </table>
</section>`;
}

const sev = (s: Severity) => `<span class="sev" style="color:${SEV_COLOR[s]}">${SEVERITY_LABELS[s]}</span>`;
const chips = (g: IssueGroup) => g.guidelines.map((x) => (x.url ? `<a class="chip" href="${esc(x.url)}">${esc(x.label)}</a>` : `<span class="chip">${esc(x.label)}</span>`)).join('');

function tested(m: ReportModel): string {
  if (!m.tested) return '';
  return `<section aria-labelledby="h-tested" class="page-break">
  <h2 id="h-tested">What was tested</h2>
  <table>
    <caption>Guidelines and checks</caption>
    <thead><tr><th scope="col">Guideline</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead>
    <tbody>${m.tested.guidelines.map((g) => `<tr class="${g.checked ? '' : 'off'}"><td>${esc(g.name)}</td><td class="nowrap">${g.checked ? '<span class="check" aria-hidden="true">✓</span> Checked' : '<span class="cross" aria-hidden="true">—</span> Not checked for this scan'}</td><td>${esc(g.note)}</td></tr>`).join('')}</tbody>
  </table>
  <table>
    <caption>Scan options</caption>
    <thead><tr><th scope="col">Option</th><th scope="col">Setting</th></tr></thead>
    <tbody>${m.tested.scanOptions.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody>
  </table>
</section>`;
}

function categoryIssueLists(m: ReportModel): string {
  const byCat = groupByCategory(m.groups);
  if (!byCat.length) return `<section aria-labelledby="h-issues"><h2 id="h-issues">Issues</h2><p>No issues were found.</p></section>`;
  return `<section aria-labelledby="h-issues" class="page-break">
  <h2 id="h-issues">Issues by category</h2>
  ${byCat
    .map(
      ([cat, groups]) => `<h3>${esc(CATEGORY_LABELS[cat])} <span class="muted" style="font-weight:400;font-size:13px">— ${groups.length} issue type${groups.length === 1 ? '' : 's'}</span></h3>
  <table>
    <thead><tr><th scope="col">Issue</th><th scope="col">Severity</th><th scope="col">Guidelines</th><th scope="col" class="num">Pages</th></tr></thead>
    <tbody>${groups.map((g) => `<tr><td>${esc(g.title)}${g.templateLevel ? ' <span class="tmpl">Theme-level</span>' : ''}<br><span class="muted" style="font-size:11px">${esc(g.section)}</span></td><td>${sev(g.severity)}</td><td>${chips(g)}</td><td class="num">${g.pageCount}</td></tr>`).join('')}</tbody>
  </table>`,
    )
    .join('')}
</section>`;
}

function groupByCategory(groups: IssueGroup[]) {
  const map = new Map<IssueGroup['category'], IssueGroup[]>();
  for (const g of groups) map.set(g.category, [...(map.get(g.category) ?? []), g]);
  return [...map.entries()];
}

function issuesWithOccurrences(m: ReportModel): string {
  const byCat = groupByCategory(m.groups);
  return `<section aria-labelledby="h-detail" class="page-break">
  <h2 id="h-detail">Issue details</h2>
  <p class="muted">Each issue lists up to ${m.options.reports.maxPagesPerIssue} pages and ${m.options.reports.maxLinesPerIssue} locations per page. Line numbers refer to the page source sent by the server; elements added by JavaScript have no line number.</p>
  ${byCat
    .map(
      ([cat, groups]) => `<h3>${esc(CATEGORY_LABELS[cat])}</h3>
  ${groups
    .map((g) => {
      const occ = m.occurrences.get(g.ruleId);
      return `<article class="issue ${g.severity}">
    <h4>${esc(g.title)}</h4>
    <p style="margin:2px 0 6px">${sev(g.severity)} · ${g.pageCount} page${g.pageCount === 1 ? '' : 's'} · ${g.occurrenceCount} occurrence${g.occurrenceCount === 1 ? '' : 's'} ${g.templateLevel ? '· <span class="tmpl">Theme-level: fix once</span>' : ''}</p>
    <p>${chips(g)}</p>
    <p>${esc(g.description)}</p>
    <div class="fix"><strong>How to fix:</strong> ${esc(g.fix)}</div>
    ${(occ?.pages ?? [])
      .map(
        (p) => `<div class="occ"><div class="url">${esc(p.url)}${p.total > p.lines.length ? ` <span class="muted" style="font-weight:400">(${p.total} occurrences, first ${p.lines.length} shown)</span>` : ''}</div>
      ${p.lines.map((l) => `<div class="ln">${l.line ? `Line ${l.line}` : 'Generated by JavaScript (no source line)'}${l.selector ? ` · ${esc(l.selector)}` : ''}${l.detail && l.detail !== l.snippet ? ` · ${esc(l.detail.slice(0, 300))}` : ''}</div>${l.snippet ? `<pre>${esc(l.snippet)}</pre>` : ''}`).join('')}
    </div>`,
      )
      .join('')}
    ${occ && occ.totalPages > occ.pages.length ? `<p class="muted">… and ${occ.totalPages - occ.pages.length} more pages.</p>` : ''}
  </article>`;
    })
    .join('')}`,
    )
    .join('') || '<p>No issues were found.</p>'}
</section>`;
}

function pagesTable(m: ReportModel): string {
  return `<section aria-labelledby="h-pages" class="page-break">
  <h2 id="h-pages">Issues by page</h2>
  ${
    m.pages.length
      ? `<table>
    <thead><tr><th scope="col">Page</th><th scope="col" class="num">Priority</th><th scope="col" class="num">Other</th><th scope="col" class="num">Warnings</th></tr></thead>
    <tbody>${m.pages.map((p) => `<tr><td>${p.title ? `${esc(p.title)}<br>` : ''}<span class="muted" style="font-size:11px;word-break:break-all">${esc(p.url)}</span></td><td class="num">${p.priority}</td><td class="num">${p.other}</td><td class="num">${p.warning}</td></tr>`).join('')}</tbody>
  </table>`
      : '<p>No pages have issues.</p>'
  }
</section>`;
}

function inventoryTable(m: ReportModel): string {
  if (!m.inventory) return '';
  return `<section aria-labelledby="h-inv" class="page-break">
  <h2 id="h-inv">Inventory</h2>
  <table>
    <thead><tr><th scope="col">Type</th><th scope="col" class="num">URLs</th><th scope="col" class="num">Broken</th><th scope="col" class="num">Size</th><th scope="col">Description</th></tr></thead>
    <tbody>${m.inventory
      .map((g) => `<tr><th scope="rowgroup" colspan="5" style="background:#EEF0FF;color:${BRAND.navy}">${esc(g.label)}</th></tr>${g.rows.map((r) => `<tr class="${r.count ? '' : 'off'}"><td>${esc(r.subtype)}</td><td class="num">${r.count}</td><td class="num">${r.broken}</td><td class="num">${esc(formatBytes(r.bytes))}</td><td>${esc(r.description)}</td></tr>`).join('')}`)
      .join('')}</tbody>
  </table>
</section>`;
}

function diagnosticsList(m: ReportModel): string {
  if (!m.diagnostics) return '';
  return `<section aria-labelledby="h-diag">
  <h2 id="h-diag">Diagnostics</h2>
  <p class="muted">Informative messages about the scan — these are not errors.</p>
  ${
    m.diagnostics.length
      ? `<table>
    <thead><tr><th scope="col">Message</th><th scope="col" class="num">Count</th><th scope="col">Examples</th></tr></thead>
    <tbody>${m.diagnostics.map((d) => `<tr><td><strong>${esc(d.label)}</strong><br><span class="muted" style="font-size:11px">${esc(d.message)}</span></td><td class="num">${d.count}</td><td style="font-size:11px;word-break:break-all">${d.urls.slice(0, 5).map(esc).join('<br>')}${d.urls.length > 5 ? `<br><span class="muted">+${d.urls.length - 5} more</span>` : ''}</td></tr>`).join('')}</tbody>
  </table>`
      : '<p>No diagnostics.</p>'
  }
</section>`;
}
