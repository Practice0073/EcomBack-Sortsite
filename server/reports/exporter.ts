import fs from 'node:fs';
import path from 'node:path';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { browserAvailable, getBrowser } from '../engine/browser.js';
import { estimateDisk } from '../engine/scanRunner.js';
import { openOptions } from '../lib/options.js';
import { FOOTER_TEXT, PRODUCT_NAME, formatDate, hostOf, logoDataUri } from './branding.js';
import { buildModel, allOccurrences, allPages, loadScan, type ReportType } from './model.js';
import { renderReportHtml } from './html.js';
import { renderIssueReportDocx } from './issueReportDocx.js';
import { renderIssueReportHtml } from './issueReportHtml.js';
import { buildReportXlsx } from './xlsx.js';
import { csvIssues, csvPages } from './csv.js';
import { diagnostics, fixPlan, inventory, issueGroups, reportSummary, whatWasTested } from './data.js';

export type ExportFormat = 'docx' | 'pdf' | 'html' | 'csv-issues' | 'csv-pages' | 'xlsx' | 'json';
export type { ReportType } from './model.js';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['docx', 'pdf', 'html', 'csv-issues', 'csv-pages', 'xlsx', 'json'];

export const EXPORT_META: Record<ExportFormat, { ext: string; mime: string; label: string }> = {
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF' },
  html: { ext: 'html', mime: 'text/html; charset=utf-8', label: 'HTML' },
  'csv-issues': { ext: 'csv', mime: 'text/csv; charset=utf-8', label: 'CSV (issues)' },
  'csv-pages': { ext: 'csv', mime: 'text/csv; charset=utf-8', label: 'CSV (pages)' },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  json: { ext: 'json', mime: 'application/json; charset=utf-8', label: 'JSON' },
};

/** Report type is meaningful for document formats only; data formats always contain everything. */
const usesReportType = (f: ExportFormat) => f === 'docx' || f === 'pdf' || f === 'html';

export function exportFileName(url: string, format: ExportFormat, reportType: ReportType, createdAt: string): string {
  const kind = usesReportType(format) ? reportType : format.replace('csv-', '');
  return `sortsite-${hostOf(url)}-${kind}-${createdAt.slice(0, 10)}.${EXPORT_META[format].ext}`;
}

async function render(scanId: number, format: ExportFormat, reportType: ReportType, outFile: string) {
  switch (format) {
    case 'html': {
      // Executive keeps the visual overview; every other type uses the Issue Report layout (same as Word).
      const model = buildModel(scanId, reportType);
      fs.writeFileSync(outFile, reportType === 'executive' ? renderReportHtml(model, { print: false }) : renderIssueReportHtml(model, { print: false }));
      return;
    }
    case 'pdf': {
      if (!browserAvailable()) throw new Error('PDF export needs Google Chrome on the server. Install Chrome (or set CHROME_PATH) and try again, or download Word/HTML instead.');
      const model = buildModel(scanId, reportType);
      const footer = `${FOOTER_TEXT} · ${hostOf(model.site.url)} · ${formatDate(model.scanDate)}`;
      const header = `${model.site.url}  ·  ${formatDate(model.scanDate)}`;
      const html = reportType === 'executive' ? renderReportHtml(model, { print: true }) : renderIssueReportHtml(model, { print: true });
      await renderPdf(html, outFile, header, footer);
      return;
    }
    case 'docx':
      fs.writeFileSync(outFile, await renderIssueReportDocx(buildModel(scanId, reportType)));
      return;
    case 'xlsx':
      fs.writeFileSync(outFile, await buildReportXlsx(scanId));
      return;
    case 'csv-issues':
      fs.writeFileSync(outFile, csvIssues(scanId), 'utf8');
      return;
    case 'csv-pages':
      fs.writeFileSync(outFile, csvPages(scanId), 'utf8');
      return;
    case 'json': {
      const { scan, site } = loadScan(scanId);
      const options = openOptions(scan.options_json);
      const groups = issueGroups(scanId);
      const occ = allOccurrences(scanId, groups, options);
      const payload = {
        generator: FOOTER_TEXT,
        generatedAt: nowIso(),
        summary: reportSummary(scan, site),
        issues: groups.map((g) => ({ ...g, occurrences: occ.get(g.ruleId) ?? { pages: [], totalPages: 0 } })),
        pages: allPages(scanId),
        inventory: inventory(scanId),
        diagnostics: diagnostics(scanId),
        tested: whatWasTested(options),
        fixPlan: fixPlan(scanId),
      };
      fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
      return;
    }
  }
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Branded PDF: Chrome header/footer templates repeat the Ecomback logo, product name, client and scan date on
 * every page (CSS running headers are unreliable in Chrome's print margins).
 */
async function renderPdf(html: string, outFile: string, headerText: string, footerText: string) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const font = 'font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#5b6170';
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '22mm', bottom: '18mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;margin:0 14mm;padding-bottom:4px;border-bottom:0.5px solid #e3e5ee;display:flex;justify-content:space-between;align-items:center;${font}"><img src="${logoDataUri()}" style="height:13px;width:auto" alt=""><span>${escHtml(headerText)}</span></div>`,
      footerTemplate: `<div style="width:100%;margin:0 14mm;display:flex;justify-content:space-between;${font}"><span>${escHtml(footerText)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    fs.writeFileSync(outFile, pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Generates one export file, recording progress in report_exports (download history) and adding the
 * file size to the scan's disk usage for quota accounting.
 */
export async function generateExport(scanId: number, format: ExportFormat, reportType: ReportType, userId: number | null): Promise<{ id: number; filePath: string | null }> {
  const { scan } = loadScan(scanId);
  const createdAt = nowIso();
  const id = q.run("INSERT INTO report_exports (scan_id, user_id, format, report_type, status, created_at) VALUES (?,?,?,?, 'running', ?)", [scanId, userId, format, reportType, createdAt]).lastId;
  const dir = path.join(config.exportsDir, String(scanId));
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `${id}-${exportFileName(scan.url, format, reportType, createdAt)}`);
  try {
    await render(scanId, format, reportType, outFile);
    const bytes = fs.statSync(outFile).size;
    q.run("UPDATE report_exports SET status = 'completed', file_path = ?, bytes = ? WHERE id = ?", [outFile, bytes, id]);
    q.run('UPDATE scans SET disk_bytes = ? WHERE id = ?', [estimateDisk(scanId), scanId]);
    return { id, filePath: outFile };
  } catch (e) {
    fs.rmSync(outFile, { force: true });
    const msg = (e as Error).message.slice(0, 500);
    q.run("UPDATE report_exports SET status = 'failed', error = ? WHERE id = ?", [msg, id]);
    console.error(`[export] ${format}/${reportType} for scan ${scanId} failed`, e);
    throw Object.assign(new Error(msg), { exportId: id });
  }
}
