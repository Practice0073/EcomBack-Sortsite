import { Router } from 'express';
import { q } from '../db/index.js';
import { scanFor, siteFor, type ScanRecord } from '../lib/access.js';
import { badRequest, intParam, notFound } from '../lib/http.js';
import { openOptions } from '../lib/options.js';
import { CATEGORIES, type Category } from '../../shared/options.js';
import type { Severity } from '../../shared/types.js';
import {
  compareScans,
  diagnostics,
  fixPlan,
  inventory,
  inventoryFiles,
  issueGroups,
  issueOccurrences,
  pageIssues,
  pagesWithIssues,
  reportSummary,
  siteMapData,
  statementData,
  whatWasTested,
} from '../reports/data.js';

export const reportsRouter = Router();

reportsRouter.get('/scans/:id/report/summary', (req, res) => {
  const { scan, site } = scanFor(req);
  res.json(reportSummary(scan, site));
});

reportsRouter.get('/scans/:id/report/issues', (req, res) => {
  const { scan } = scanFor(req);
  const category = String(req.query.category ?? 'all');
  if (category !== 'all' && !(CATEGORIES as readonly string[]).includes(category)) throw badRequest('Unknown category.');
  const severity = String(req.query.severity ?? 'all');
  const groups = issueGroups(scan.id, {
    category: category as Category | 'all',
    severity: (['priority', 'other', 'warning'].includes(severity) ? severity : 'all') as Severity | 'all',
    guideline: String(req.query.guideline ?? '') || undefined,
    text: String(req.query.q ?? '') || undefined,
  });
  // Section totals are computed from the rules actually displayed in each section, so they always
  // match the rows beneath them.
  const sections = new Map<string, { name: string; issues: number; pages: number; ruleIds: string[]; failing: boolean }>();
  for (const g of groups) {
    const s = sections.get(g.section) ?? { name: g.section, issues: 0, pages: 0, ruleIds: [], failing: false };
    s.issues += 1;
    s.ruleIds.push(g.ruleId);
    s.failing ||= g.severity !== 'warning';
    sections.set(g.section, s);
  }
  for (const s of sections.values()) {
    // Sections with failures count only failing findings; "needs review" pages are not failures.
    s.pages = Number(q.value(`SELECT COUNT(DISTINCT page_id) FROM issues WHERE scan_id = ? AND rule_id IN (${s.ruleIds.map(() => '?').join(',')})${s.failing ? " AND severity != 'warning'" : ''}`, [scan.id, ...s.ruleIds]));
  }
  // ARIA card: errors vs warnings among ARIA rules.
  const aria = q.get<{ errs: number; warns: number }>(
    "SELECT COUNT(DISTINCT CASE WHEN severity != 'warning' THEN page_id END) AS errs, COUNT(DISTINCT CASE WHEN severity = 'warning' THEN page_id END) AS warns FROM issues WHERE scan_id = ? AND (rule_id LIKE 'axe.aria-%' OR rule_id IN (SELECT id FROM rules WHERE section = 'ARIA'))",
    [scan.id],
  );
  const pages = Math.max(1, Number(q.value('SELECT COUNT(*) FROM scan_pages WHERE scan_id = ?', [scan.id])));
  res.json({ groups, sections: [...sections.values()].map(({ ruleIds: _ids, failing: _f, ...rest }) => rest), aria: { errorsPct: Math.round(((aria?.errs ?? 0) / pages) * 1000) / 10, warningsPct: Math.round(((aria?.warns ?? 0) / pages) * 1000) / 10 } });
});

reportsRouter.get('/scans/:id/report/issues/:ruleId/pages', (req, res) => {
  const { scan } = scanFor(req);
  const ruleId = String(req.params.ruleId);
  res.json(issueOccurrences(scan.id, ruleId, openOptions(scan.options_json), Math.max(1, Number(req.query.page ?? 1))));
});

reportsRouter.get('/scans/:id/report/pages', (req, res) => {
  const { scan } = scanFor(req);
  res.json(
    pagesWithIssues(scan.id, {
      text: String(req.query.q ?? '') || undefined,
      sort: String(req.query.sort ?? 'issues'),
      dir: req.query.dir === 'asc' ? 'asc' : 'desc',
      page: Number(req.query.page ?? 1),
      perPage: Number(req.query.perPage ?? 50),
      onlyIssues: req.query.all !== '1',
    }),
  );
});

reportsRouter.get('/scans/:id/report/pages/:pageId', (req, res) => {
  const { scan } = scanFor(req);
  const data = pageIssues(scan.id, intParam(req.params.pageId, 'page id'));
  if (!data) throw notFound('Page not found in this scan.');
  res.json(data);
});

reportsRouter.get('/scans/:id/report/inventory', (req, res) => {
  const { scan } = scanFor(req);
  res.json(inventory(scan.id));
});

reportsRouter.get('/scans/:id/report/inventory/:kind/:subtype', (req, res) => {
  const { scan } = scanFor(req);
  res.json(inventoryFiles(scan.id, String(req.params.kind), String(req.params.subtype)));
});

reportsRouter.get('/scans/:id/report/diagnostics', (req, res) => {
  const { scan } = scanFor(req);
  res.json(diagnostics(scan.id));
});

reportsRouter.get('/scans/:id/report/sitemap', (req, res) => {
  const { scan } = scanFor(req);
  res.json(siteMapData(scan.id));
});

reportsRouter.get('/scans/:id/report/tested', (req, res) => {
  const { scan } = scanFor(req);
  res.json(whatWasTested(openOptions(scan.options_json)));
});

reportsRouter.get('/scans/:id/report/fixplan', (req, res) => {
  const { scan } = scanFor(req);
  res.json(fixPlan(scan.id));
});

reportsRouter.get('/scans/:id/report/statement', (req, res) => {
  const { scan, site } = scanFor(req);
  res.json(statementData(scan, site));
});

/** Before/after comparison of two scans of the same site. Defaults: latest two completed scans. */
reportsRouter.get('/sites/:id/compare', (req, res) => {
  const site = siteFor(req);
  const completed = q.all<ScanRecord>("SELECT * FROM scans WHERE site_id = ? AND status IN ('completed','stopped') ORDER BY id DESC", [site.id]);
  if (completed.length < 2) {
    res.json({ scans: completed.map((s) => ({ id: s.id, date: s.finished_at })), comparison: null });
    return;
  }
  const pick = (v: unknown, fallback: ScanRecord) => (v ? completed.find((s) => s.id === Number(v)) ?? fallback : fallback);
  const b = pick(req.query.b, completed[0]!);
  const a = pick(req.query.a, completed.find((s) => s.id < b.id) ?? completed[1]!);
  const [older, newer] = a.id < b.id ? [a, b] : [b, a];
  res.json({ scans: completed.map((s) => ({ id: s.id, date: s.finished_at })), comparison: compareScans(older, newer) });
});
