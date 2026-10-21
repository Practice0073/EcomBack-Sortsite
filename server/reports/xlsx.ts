import ExcelJS from 'exceljs';
import { q } from '../db/index.js';
import { CATEGORY_LABELS } from '../../shared/options.js';
import { SEVERITY_LABELS, type Severity } from '../../shared/types.js';
import { getRule } from '../engine/rules/catalog.js';
import { BRAND, PRODUCT_NAME, brandAssets, formatDate } from './branding.js';
import { allPages, buildModel, REPORT_TYPE_LABELS, type ReportModel } from './model.js';
import { diagnostics, inventory } from './data.js';

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const SEV_ARGB: Record<Severity, string> = { priority: argb(BRAND.red), other: argb(BRAND.amber), warning: 'FF4B5563' };

interface Col { header: string; key: string; width: number }

/** Adds a sheet with a branded title band (rows 1–2), a navy header row (row 4), frozen header and autofilter. */
function sheet(wb: ExcelJS.Workbook, name: string, title: string, m: ReportModel, cols: Col[], logoId: number) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }], properties: { tabColor: { argb: argb(BRAND.navy) } } });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  ws.mergeCells(1, 2, 1, Math.max(2, cols.length));
  const t = ws.getCell(1, 2);
  t.value = `${title} — ${m.site.url}`;
  t.font = { name: 'Poppins', size: 14, bold: true, color: { argb: argb(BRAND.navy) } };
  ws.mergeCells(2, 2, 2, Math.max(2, cols.length));
  const sub = ws.getCell(2, 2);
  sub.value = `${PRODUCT_NAME}${m.client ? ` · ${m.client.name}` : ''} · Scan date ${formatDate(m.scanDate)}`;
  sub.font = { name: 'Poppins', size: 10, color: { argb: argb(BRAND.muted) } };
  ws.getRow(1).height = 24;
  ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 34, height: 34 } });
  const header = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Poppins', bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.navy) } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: argb(BRAND.coral) } } };
  });
  header.height = 20;
  return ws;
}

function finish(ws: ExcelJS.Worksheet, colCount: number) {
  const last = Math.max(4, ws.rowCount);
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: colCount } };
  for (let r = 5; r <= last; r++) ws.getRow(r).alignment = { vertical: 'top', wrapText: true };
}

export async function buildReportXlsx(scanId: number): Promise<Buffer> {
  const m = buildModel(scanId, 'summary');
  const wb = new ExcelJS.Workbook();
  wb.creator = PRODUCT_NAME;
  wb.title = `${REPORT_TYPE_LABELS.full} — ${m.site.url}`;
  wb.created = new Date();
  const logoId = wb.addImage({ buffer: brandAssets().iconPng as unknown as ExcelJS.Buffer, extension: 'png' });

  // Summary
  const s = m.summary;
  const sum = sheet(wb, 'Summary', 'Scan summary', m, [{ header: 'Measure', key: 'k', width: 42 }, { header: 'Value', key: 'v', width: 60 }], logoId);
  const rows: [string, string | number][] = [
    ['Site', m.site.url],
    ...(m.client ? ([['Client', m.client.name]] as [string, string][]) : []),
    ['Scan date', formatDate(m.scanDate)],
    ['Scope', m.scopeLabel],
    ['Pages and files checked', s.pagesChecked],
    ['Pages with quality issues', s.pagesWithIssues],
    ['Pages with issues (%)', s.scan.issuePct],
    ['Pages with priority issues (%)', s.scan.priorityPct],
    ['ADA / WCAG compliance score', `${s.complianceScore} (${m.grade})`],
    ['Benchmark', `${s.benchmark.label} than average (${s.benchmark.value}%)`.replace('average than average', 'about average')],
    ['Rules applied', s.rulesChecked],
    ...s.categories.filter((c) => c.enabled).map((c) => [`${CATEGORY_LABELS[c.category]} — pages with issues (%)`, c.issuePct] as [string, number]),
  ];
  for (const [k, v] of rows) sum.addRow({ k, v });
  finish(sum, 2);

  // Issues — one row per occurrence.
  const iss = sheet(
    wb,
    'Issues',
    'Issues',
    m,
    [
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Severity', key: 'severity', width: 11 },
      { header: 'Rule ID', key: 'rule', width: 30 },
      { header: 'Issue', key: 'title', width: 44 },
      { header: 'Guidelines', key: 'guidelines', width: 30 },
      { header: 'Page URL', key: 'url', width: 50 },
      { header: 'Line', key: 'line', width: 8 },
      { header: 'Snippet', key: 'snippet', width: 60 },
      { header: 'Detail', key: 'detail', width: 50 },
    ],
    logoId,
  );
  const occ = q.all<{ rule_id: string; category: string; severity: Severity; url: string; line: number | null; snippet: string | null; detail: string | null }>(
    'SELECT i.rule_id, i.category, i.severity, p.url, i.line, i.snippet, i.detail FROM issues i JOIN scan_pages p ON p.id = i.page_id WHERE i.scan_id = ? ORDER BY CASE i.severity WHEN \'priority\' THEN 0 WHEN \'other\' THEN 1 ELSE 2 END, i.rule_id, p.url, i.line LIMIT 200000',
    [scanId],
  );
  for (const o of occ) {
    const rule = getRule(o.rule_id);
    const row = iss.addRow({
      category: CATEGORY_LABELS[o.category as keyof typeof CATEGORY_LABELS] ?? o.category,
      severity: SEVERITY_LABELS[o.severity],
      rule: o.rule_id,
      title: rule?.title ?? o.rule_id,
      guidelines: rule?.guidelines.map((g) => g.label).join(', ') ?? '',
      url: o.url,
      line: o.line ?? '',
      snippet: o.snippet ?? '',
      detail: o.detail ?? '',
    });
    row.getCell('severity').font = { bold: true, color: { argb: SEV_ARGB[o.severity] } };
  }
  finish(iss, 9);

  // Pages
  const pg = sheet(
    wb,
    'Pages',
    'Issues by page',
    m,
    [
      { header: 'URL', key: 'url', width: 60 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Status', key: 'status', width: 9 },
      { header: 'Depth', key: 'depth', width: 8 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Other', key: 'other', width: 10 },
      { header: 'Warnings', key: 'warning', width: 10 },
      { header: 'Total', key: 'total', width: 10 },
    ],
    logoId,
  );
  for (const p of allPages(scanId)) pg.addRow({ url: p.url, title: p.title ?? '', status: p.status ?? '', depth: p.depth, priority: p.priority, other: p.other, warning: p.warning, total: p.total });
  finish(pg, 8);

  // Inventory
  const inv = sheet(
    wb,
    'Inventory',
    'Inventory',
    m,
    [
      { header: 'Group', key: 'group', width: 14 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'URLs', key: 'count', width: 10 },
      { header: 'Internal', key: 'internal', width: 10 },
      { header: 'Broken', key: 'broken', width: 10 },
      { header: 'Bytes', key: 'bytes', width: 14 },
      { header: 'Description', key: 'description', width: 44 },
    ],
    logoId,
  );
  for (const g of inventory(scanId)) for (const r of g.rows) inv.addRow({ group: g.label, type: r.subtype, count: r.count, internal: r.internal, broken: r.broken, bytes: r.bytes, description: r.description });
  finish(inv, 7);

  // Diagnostics
  const dg = sheet(
    wb,
    'Diagnostics',
    'Diagnostics',
    m,
    [
      { header: 'Diagnostic', key: 'label', width: 36 },
      { header: 'Message', key: 'message', width: 60 },
      { header: 'Count', key: 'count', width: 9 },
      { header: 'URL', key: 'url', width: 60 },
    ],
    logoId,
  );
  for (const d of diagnostics(scanId)) {
    if (!d.urls.length) dg.addRow({ label: d.label, message: d.message, count: d.count, url: '' });
    for (const u of d.urls) dg.addRow({ label: d.label, message: d.message, count: d.count, url: u });
  }
  finish(dg, 4);

  // Fix plan
  const fp = sheet(
    wb,
    'Fix plan',
    'Prioritized fix plan',
    m,
    [
      { header: '#', key: 'rank', width: 6 },
      { header: 'Issue', key: 'title', width: 46 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Severity', key: 'severity', width: 11 },
      { header: 'Pages', key: 'pages', width: 9 },
      { header: 'Occurrences', key: 'occ', width: 12 },
      { header: 'Theme-level', key: 'template', width: 12 },
      { header: 'Impact', key: 'impact', width: 9 },
      { header: 'Effort (min)', key: 'effort', width: 12 },
      { header: 'Type', key: 'bucket', width: 14 },
    ],
    logoId,
  );
  const BUCKET = { 'quick-win': 'Quick win', major: 'Major project', 'fill-in': 'Fill-in', later: 'Later' } as const;
  m.fixPlan.items.forEach((it, i) => {
    const row = fp.addRow({ rank: i + 1, title: it.title, category: CATEGORY_LABELS[it.category], severity: SEVERITY_LABELS[it.severity], pages: it.pageCount, occ: it.occurrenceCount, template: it.templateLevel ? 'Yes' : 'No', impact: it.impact, effort: it.effortMinutes, bucket: BUCKET[it.bucket] });
    row.getCell('severity').font = { bold: true, color: { argb: SEV_ARGB[it.severity] } };
  });
  finish(fp, 10);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
