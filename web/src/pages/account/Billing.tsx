import { Mail, ReceiptText } from 'lucide-react';
import { useApi, usePage } from '../../lib/app';
import { fmtBytes, fmtDate } from '../../lib/format';
import { Bar, Empty, ErrorBanner, HelpTip, LoadingBlock } from '../../components/ui';
import { CopyButton } from './shared';

interface Use { used: number; limit: number }
interface BillingData {
  company: string;
  plan: { name: string; startedAt: string; maxPagesPerScan: number; concurrentScans: number };
  quotas: { daily: Use; weekly: Use; monthly: Use };
  users: Use;
  disk: { used: number; quota: number; pct: number };
  scannerIps: string[];
  charges: { id: number; date: string; amount: number; currency: string; description: string }[];
  paymentsEnabled: boolean;
}

function QuotaRow({ label, used, limit, value, help }: { label: string; used: number; limit: number; value?: string; help?: string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="quota-row">
      <span className="row" style={{ gap: 6 }}>
        {label}
        {help && <HelpTip text={help} label={`About ${label}`} />}
      </span>
      <Bar value={pct} tone={pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'success'} label={`${label}: ${Math.round(pct)}% used`} />
      <span className="quota-row__val">{value ?? `${used.toLocaleString()} / ${limit.toLocaleString()}`}</span>
    </div>
  );
}

export function BillingPage() {
  usePage('Billing');
  const { data, error, loading, reload } = useApi<BillingData>('/billing');
  if (loading && !data) return <LoadingBlock rows={8} />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load billing.'} onRetry={() => void reload()} />;
  const money = (n: number, c: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);

  return (
    <div className="stack-lg" style={{ maxWidth: 1100 }}>
      <section className="card" aria-labelledby="sum-title">
        <div className="card__head">
          <h2 id="sum-title">Summary</h2>
        </div>
        <div className="card__body grid-2">
          <dl className="dl">
            <dt>Company</dt>
            <dd>{data.company}</dd>
            <dt>Plan</dt>
            <dd>{data.plan.name}</dd>
            <dt>Plan started</dt>
            <dd>{fmtDate(data.plan.startedAt)}</dd>
            <dt>Pages per scan</dt>
            <dd>Up to {data.plan.maxPagesPerScan.toLocaleString()}</dd>
            <dt>Concurrent scans</dt>
            <dd>{data.plan.concurrentScans}</dd>
          </dl>
          <div className="stack" style={{ gap: 14 }}>
            <QuotaRow label="Scans today" used={data.quotas.daily.used} limit={data.quotas.daily.limit} help="Scans started in the last 24 hours, manual and scheduled." />
            <QuotaRow label="Scans this week" used={data.quotas.weekly.used} limit={data.quotas.weekly.limit} help="Scans started in the last 7 days." />
            <QuotaRow label="Scans this month" used={data.quotas.monthly.used} limit={data.quotas.monthly.limit} help="Scans started in the last 30 days." />
            <QuotaRow label="Users" used={data.users.used} limit={data.users.limit} />
            <QuotaRow label="Disk" used={data.disk.used} limit={data.disk.quota} value={`${fmtBytes(data.disk.used)} of ${fmtBytes(data.disk.quota)} (${data.disk.pct}%)`} help="Storage used by scans, sitemaps and exported reports. Delete old scans to free space." />
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="ip-title">
        <div className="card__head">
          <h2 id="ip-title">Scanner IP addresses</h2>
          <CopyButton text={data.scannerIps.join('\n')} label="Copy all" />
        </div>
        <div className="card__body stack">
          <p className="muted small">If a site uses a firewall, CDN bot protection or Shopify bot rules, allowlist these addresses so scans are not blocked (blocked requests show as 403 responses in Diagnostics).</p>
          <ul role="list" className="codes" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {data.scannerIps.map((ip) => (
              <li key={ip}>{ip}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card card--flush" aria-labelledby="charges-title">
        <div className="card__head">
          <h2 id="charges-title">Charges</h2>
        </div>
        {!data.charges.length ? (
          <Empty
            icon={<ReceiptText size={36} aria-hidden="true" />}
            title="No charges yet"
            action={
              <a className="btn" href="https://www.ecomback.com/contact-us">
                <Mail size={15} aria-hidden="true" />
                Contact Ecomback
              </a>
            }
          >
            Online plans and payments are coming soon. Contact Ecomback to change your plan.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Charges</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {data.charges.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.date)}</td>
                    <td>{c.description}</td>
                    <td className="num">{money(c.amount, c.currency)}</td>
                    <td className="muted small">Available from Ecomback on request</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
