import fs from 'node:fs';
import { Router } from 'express';
import { q } from '../db/index.js';
import { actorOf, authed, requirePerm } from '../auth/session.js';
import { scanFor } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { HttpError, intParam, notFound, oneOf } from '../lib/http.js';
import { EXPORT_FORMATS, EXPORT_META, exportFileName, generateExport, type ExportFormat } from '../reports/exporter.js';
import { REPORT_TYPES, REPORT_TYPE_LABELS, type ReportType } from '../reports/model.js';

export const exportsRouter = Router();

const downloadUrl = (id: number) => `/api/v1/exports/${id}/download`;

exportsRouter.post('/scans/:id/export', requirePerm('report.export'), async (req, res) => {
  const { scan } = scanFor(req);
  const user = authed(req);
  const format = oneOf<ExportFormat>(req, 'format', EXPORT_FORMATS);
  const type = oneOf<ReportType>(req, 'type', REPORT_TYPES, 'full');
  if (scan.status === 'queued') throw new HttpError(409, 'This scan has not started yet, so there is nothing to export.');
  try {
    const { id } = await generateExport(scan.id, format, type, user.id);
    audit(actorOf(req), 'export', `Downloaded ${REPORT_TYPE_LABELS[type]} (${EXPORT_META[format].label}) for ${scan.url}`);
    res.status(201).json({ id, downloadUrl: downloadUrl(id) });
  } catch (e) {
    throw new HttpError(500, `The ${EXPORT_META[format].label} report could not be generated: ${(e as Error).message}`);
  }
});

exportsRouter.get('/scans/:id/exports', (req, res) => {
  const { scan } = scanFor(req);
  const rows = q.all<{ id: number; format: ExportFormat; report_type: ReportType; status: string; bytes: number; created_at: string; error: string | null; user_name: string | null }>(
    'SELECT e.id, e.format, e.report_type, e.status, e.bytes, e.created_at, e.error, u.name AS user_name FROM report_exports e LEFT JOIN users u ON u.id = e.user_id WHERE e.scan_id = ? ORDER BY e.id DESC LIMIT 100',
    [scan.id],
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      format: r.format,
      formatLabel: EXPORT_META[r.format]?.label ?? r.format,
      type: r.report_type,
      typeLabel: REPORT_TYPE_LABELS[r.report_type] ?? r.report_type,
      status: r.status,
      bytes: r.bytes,
      error: r.error,
      createdAt: r.created_at,
      userName: r.user_name ?? 'Scheduler',
      downloadUrl: r.status === 'completed' ? downloadUrl(r.id) : null,
    })),
  );
});

exportsRouter.get('/exports/:id/download', (req, res) => {
  const exp = q.get<{ id: number; scan_id: number; format: ExportFormat; report_type: ReportType; status: string; file_path: string | null; created_at: string }>('SELECT * FROM report_exports WHERE id = ?', [intParam(req.params.id, 'export id')]);
  if (!exp) throw notFound('Export not found.');
  const { scan } = scanFor(req, exp.scan_id); // tenant + client-workspace access check
  if (exp.status !== 'completed' || !exp.file_path || !fs.existsSync(exp.file_path)) throw notFound('This export is not available. Generate it again.');
  const meta = EXPORT_META[exp.format];
  const name = exportFileName(scan.url, exp.format, exp.report_type, exp.created_at);
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(exp.file_path).pipe(res);
});
