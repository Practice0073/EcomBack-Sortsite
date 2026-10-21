import { useState, type FormEvent } from 'react';
import { FileClock, Search } from 'lucide-react';
import { qs } from '../../lib/api';
import { useApi, usePage } from '../../lib/app';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { Empty, ErrorBanner, LoadingBlock, Pagination, SelectField, SortHeader, TextField } from '../../components/ui';
import './shared';

interface AuditData { items: { id: number; who: string; what: string; details: string; ip: string | null; when: string }[]; total: number; page: number; perPage: number; users: { id: number; name: string }[]; types: string[]; retentionDays: number }
interface Filters { type: string; user: string; from: string; to: string; q: string }

const TYPE_TONE: Record<string, string> = {
  login: 'badge--success',
  logout: 'badge--neutral',
  'login-failed': 'badge--danger',
  password: 'badge--warning',
  '2fa': 'badge--warning',
  scan: 'badge--info',
  site: 'badge--danger',
  options: 'badge--info',
  export: 'badge--neutral',
  sitemap: 'badge--info',
  user: 'badge--warning',
  settings: 'badge--neutral',
  client: 'badge--neutral',
  'api-token': 'badge--warning',
};
const EMPTY: Filters = { type: '', user: '', from: '', to: '', q: '' };

export function AuditPage() {
  usePage('Audit History');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<AuditData>(`/audit${qs({ ...filters, dir, page })}`);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters(draft);
    setPage(1);
  };
  const months = data ? Math.round(data.retentionDays / 30.4) : 6;
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="stack-lg">
      <p className="muted">Changes made in this account in the last {months} months. Older events are removed automatically.</p>
      <form className="card card__body filters" onSubmit={apply} role="search" aria-label="Filter audit history">
        <TextField label="From" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        <TextField label="To" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        <SelectField label="Who" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} options={[{ value: '', label: 'Everyone' }, ...(data?.users ?? []).map((u) => ({ value: String(u.id), label: u.name }))]} />
        <SelectField label="What" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} options={[{ value: '', label: 'All types' }, ...(data?.types ?? []).map((t) => ({ value: t, label: t }))]} />
        <TextField label="Details contain" type="search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        <div className="row">
          <button type="submit" className="btn btn--primary">
            <Search size={15} aria-hidden="true" />
            Filter
          </button>
          {active && (
            <button type="button" className="btn btn--ghost" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); }}>
              Clear
            </button>
          )}
        </div>
      </form>

      <section className="card card--flush" aria-label="Audit events">
        {loading && !data ? (
          <div className="card__body"><LoadingBlock rows={6} /></div>
        ) : error ? (
          <div className="card__body"><ErrorBanner message={error} onRetry={() => void reload()} /></div>
        ) : !data?.items.length ? (
          <Empty icon={<FileClock size={36} aria-hidden="true" />} title={active ? 'No events match these filters' : 'No events yet'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Audit events, {data.total} total</caption>
              <thead>
                <tr>
                  <SortHeader label="When" sortKey="when" sort="when" dir={dir} onSort={() => { setDir((d) => (d === 'desc' ? 'asc' : 'desc')); setPage(1); }} />
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fmtDateTime(e.when)}
                      <div className="xsmall muted">{fmtRelative(e.when)}</div>
                    </td>
                    <td style={{ wordBreak: 'break-word' }}>{e.who}</td>
                    <td><span className={`badge ${TYPE_TONE[e.what] ?? 'badge--neutral'}`}>{e.what}</span></td>
                    <td style={{ wordBreak: 'break-word' }}>
                      {e.details}
                      {e.ip && <div className="xsmall muted">IP {e.ip}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.perPage && (
          <div className="card__foot">
            <span />
            <Pagination page={data.page} perPage={data.perPage} total={data.total} onPage={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
