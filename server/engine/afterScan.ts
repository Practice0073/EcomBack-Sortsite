import { q } from '../db/index.js';
import { config } from '../config.js';
import { checkQuotaAlert, notify } from '../lib/quota.js';
import { brandedEmail, sendMail } from '../mail/mailer.js';
import { openOptions } from '../lib/options.js';
import { scoreGrade } from './stats.js';

interface FinishedScan {
  id: number;
  site_id: number;
  status: string;
  trigger: string;
  url: string;
  issue_pct: number;
  priority_pct: number;
  pages_checked: number;
  compliance_score: number | null;
  error: string | null;
  account_id: number;
  options_json: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Alerts, emailed reports and quota checks after a scan ends (Plan.md §9). */
export async function afterScanFinished(scanId: number) {
  const scan = q.get<FinishedScan>(
    `SELECT sc.id, sc.site_id, sc.status, sc.trigger, sc.url, sc.issue_pct, sc.priority_pct, sc.pages_checked, sc.compliance_score, sc.error, s.account_id, s.options_json
       FROM scans sc JOIN sites s ON s.id = sc.site_id WHERE sc.id = ?`,
    [scanId],
  );
  if (!scan) return;
  const alerts = q.get<{ on_complete: number; on_failed: number; rise_points: number; email_alerts: number }>('SELECT * FROM alert_settings WHERE account_id = ?', [scan.account_id]) ?? { on_complete: 1, on_failed: 1, rise_points: 5, email_alerts: 0 };
  const link = `/scans/${scan.id}/report`;
  const admins = q.all<{ email: string }>("SELECT email FROM users WHERE account_id = ? AND role = 'admin' AND status = 'active'", [scan.account_id]).map((u) => u.email);

  try {
    if (scan.status === 'failed') {
      if (alerts.on_failed) notify(scan.account_id, 'scan-failed', 'Scan failed', `${scan.url}: ${scan.error ?? 'unknown error'}`, `/sites/${scan.site_id}`);
      if (alerts.email_alerts) await sendMail({ accountId: scan.account_id, to: admins, subject: `Scan failed: ${scan.url}`, html: brandedEmail({ heading: 'A scan failed', intro: `The scan of ${scan.url} could not finish: ${scan.error ?? 'unknown error'}.`, cta: { label: 'Open scan history', url: `${config.baseUrl}/sites/${scan.site_id}` } }) });
      return;
    }
    if (scan.status !== 'completed') return;

    if (alerts.on_complete) notify(scan.account_id, 'scan-completed', 'Scan completed', `${scan.url}: ${scan.issue_pct}% of pages have issues.`, link);

    const prev = q.get<{ issue_pct: number }>("SELECT issue_pct FROM scans WHERE site_id = ? AND status = 'completed' AND id < ? ORDER BY id DESC LIMIT 1", [scan.site_id, scan.id]);
    if (prev && scan.issue_pct - prev.issue_pct > alerts.rise_points) {
      const msg = `Pages with issues rose from ${prev.issue_pct}% to ${scan.issue_pct}% on ${scan.url}.`;
      notify(scan.account_id, 'issue-rise', 'Issues increased', msg, `/sites/${scan.site_id}/compare?b=${scan.id}`);
      if (alerts.email_alerts) await sendMail({ accountId: scan.account_id, to: admins, subject: `Issues increased on ${scan.url}`, html: brandedEmail({ heading: 'Issues increased', intro: msg, cta: { label: 'Compare scans', url: `${config.baseUrl}/sites/${scan.site_id}/compare?b=${scan.id}` } }) });
    }

    await emailReport(scan);
  } finally {
    checkQuotaAlert(scan.account_id);
  }
}

async function emailReport(scan: FinishedScan) {
  const o = openOptions(scan.options_json);
  if (o.schedule.emailTo === 'nobody' || scan.trigger !== 'scheduled') return;
  let to: string[] = [];
  if (o.schedule.emailTo === 'all-users') to = q.all<{ email: string }>("SELECT email FROM users WHERE account_id = ? AND status = 'active'", [scan.account_id]).map((u) => u.email);
  else if (o.schedule.emailTo === 'custom') to = o.schedule.customEmails.split(/[\s,;]+/).filter(Boolean);
  else to = q.all<{ email: string }>("SELECT email FROM users WHERE account_id = ? AND role = 'admin' AND status = 'active' ORDER BY id LIMIT 1", [scan.account_id]).map((u) => u.email);

  const score = scan.compliance_score ?? 100;
  const stats = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 4px">
    ${[
      ['Pages checked', String(scan.pages_checked)],
      ['Pages with issues', `${scan.issue_pct}%`],
      ['Pages with priority issues', `${scan.priority_pct}%`],
      ['ADA / WCAG score', `${score} (${scoreGrade(score)})`],
    ]
      .map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eceef4;color:#5b6170;font-size:14px">${k}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #eceef4;font-weight:600;font-size:14px">${esc(v!)}</td></tr>`)
      .join('')}
  </table>`;

  let attachments: { filename: string; path: string }[] | undefined;
  try {
    const { generateExport } = await import('../reports/exporter.js');
    const exp = await generateExport(scan.id, 'pdf', 'executive', null);
    if (exp.filePath) attachments = [{ filename: `sortsite-${new URL(scan.url).hostname}-executive.pdf`, path: exp.filePath }];
  } catch (e) {
    console.warn('[email] could not attach PDF', (e as Error).message);
  }
  await sendMail({
    accountId: scan.account_id,
    to,
    subject: `Scheduled scan report: ${scan.url}`,
    html: brandedEmail({ heading: 'Your scheduled scan is ready', intro: `We scanned ${scan.url}. Here is the summary — the full report is one click away.`, bodyHtml: stats, cta: { label: 'Open the full report', url: `${config.baseUrl}/scans/${scan.id}/report` }, footnote: 'You receive this because the scan schedule emails reports to you. Change it under Options › Schedule.' }),
    attachments,
  });
}
