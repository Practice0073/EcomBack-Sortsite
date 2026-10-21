import { useState } from 'react';
import { Inbox, Info, Mail } from 'lucide-react';
import { useApi, usePage } from '../../lib/app';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { Empty, ErrorBanner, LoadingBlock, Modal } from '../../components/ui';
import './shared';

interface MailItem { id: number; to: string; subject: string; delivered: boolean; error: string | null; createdAt: string }

export function MailboxPage() {
  usePage('Email Outbox');
  const { data, error, loading, reload } = useApi<{ smtpConfigured: boolean; items: MailItem[] }>('/mailbox');
  const [open, setOpen] = useState<MailItem | null>(null);

  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load the outbox.'} onRetry={() => void reload()} />;

  return (
    <div className="stack-lg">
      <div className={`banner ${data.smtpConfigured ? 'banner--success' : 'banner--info'}`} role="status">
        <Info size={18} aria-hidden="true" />
        <div>
          {data.smtpConfigured
            ? 'SMTP is configured. Emails are delivered and a copy of each is kept here.'
            : 'SMTP is not configured, so emails (password resets, invitations, scheduled reports, alerts) are only stored here. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to deliver them.'}
        </div>
      </div>

      <section className="card card--flush" aria-label="Sent emails">
        {!data.items.length ? (
          <Empty icon={<Inbox size={36} aria-hidden="true" />} title="No emails yet">Password resets, invitations and scheduled reports appear here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Emails, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">To</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fmtDateTime(m.createdAt)}
                      <div className="xsmall muted">{fmtRelative(m.createdAt)}</div>
                    </td>
                    <td style={{ wordBreak: 'break-all' }}>{m.to}</td>
                    <td>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(m)} style={{ textAlign: 'left', whiteSpace: 'normal', fontWeight: 600, color: 'var(--link)' }}>
                        <Mail size={14} aria-hidden="true" />
                        {m.subject}
                      </button>
                    </td>
                    <td>
                      {m.delivered ? <span className="badge badge--success">Delivered</span> : m.error ? <span className="badge badge--danger" title={m.error}>Failed</span> : <span className="badge badge--neutral">Stored only</span>}
                      {m.error && <div className="xsmall" style={{ color: 'var(--danger)', marginTop: 4 }}>{m.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <Modal title={open.subject} onClose={() => setOpen(null)} wide>
          <div className="stack">
            <p className="small muted">
              To {open.to} · {fmtDateTime(open.createdAt)}
            </p>
            <iframe className="mail-frame" src={`/api/v1/mailbox/${open.id}`} sandbox="" title={`Email preview: ${open.subject}`} />
          </div>
        </Modal>
      )}
    </div>
  );
}
