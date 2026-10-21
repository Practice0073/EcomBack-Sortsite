import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { q, nowIso } from '../db/index.js';
import { PRODUCT_NAME } from '../../shared/types.js';

const transport = config.smtp
  ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
  : null;

export interface MailAttachment { filename: string; path: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Ecomback-branded HTML email shell (table layout for client compatibility). */
export function brandedEmail(opts: { heading: string; intro: string; bodyHtml?: string; cta?: { label: string; url: string }; footnote?: string }): string {
  const logo = `${config.baseUrl}/ecomback-logo.png`; // PNG: Gmail/Outlook block SVG images
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;background:#f3f4f8;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#0d0e10">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e5ee">
<tr><td style="padding:24px 32px;border-bottom:4px solid #f44c35"><img src="${logo}" alt="Ecomback" width="160" style="display:block;height:auto"></td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#01027f">${esc(opts.heading)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#30343c">${esc(opts.intro)}</p>
${opts.bodyHtml ?? ''}
${opts.cta ? `<p style="margin:28px 0 8px"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#01027f;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(opts.cta.label)}</a></p>` : ''}
${opts.footnote ? `<p style="margin:20px 0 0;font-size:13px;color:#5b6170">${esc(opts.footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 32px;background:#0b0f2e;color:#c9cce0;font-size:12px">${PRODUCT_NAME} · <a href="https://www.ecomback.com" style="color:#ffffff">ecomback.com</a></td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Sends via SMTP when configured; always writes a copy to the local outbox so emails can be
 * reviewed on localhost (Account › Dev Mailbox) without a mail server.
 */
export async function sendMail(opts: { accountId: number | null; to: string[]; subject: string; html: string; attachments?: MailAttachment[] }) {
  const to = [...new Set(opts.to.map((t) => t.trim()).filter(Boolean))];
  if (!to.length) return;
  const file = path.join(config.outboxDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  fs.writeFileSync(file, opts.html);
  let delivered = 0;
  let error: string | null = null;
  if (transport && config.smtp) {
    try {
      await transport.sendMail({ from: config.smtp.from, to: to.join(', '), subject: opts.subject, html: opts.html, attachments: opts.attachments });
      delivered = 1;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.error('[mail] delivery failed', error);
    }
  }
  q.run('INSERT INTO emails (account_id, to_addr, subject, html_path, delivered, error, created_at) VALUES (?,?,?,?,?,?,?)', [
    opts.accountId,
    to.join(', '),
    opts.subject,
    file,
    delivered,
    error,
    nowIso(),
  ]);
}
