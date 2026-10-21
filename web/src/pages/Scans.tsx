import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Plus, ScanSearch, Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import { TopbarActions, useApi, useAuth, useLiveEvents, usePage, useToast } from '../lib/app';
import { fmtDate, fmtPct, fmtRelative, hostOf } from '../lib/format';
import { Empty, ErrorBanner, LoadingBlock, MiniRing, Modal, Pagination, SelectField, SiteCell, SortHeader, StatusBadge } from '../components/ui';
import { LiveProgress, NewScanForm, OptionsLink, ScanNowButton, StopScanButton } from '../components/scan';
import type { SiteRow } from '@shared/types';

type SortKey = 'address' | 'date' | 'disk' | 'issues';
interface ClientOpt { id: number; name: string }

export function ScansPage() {
  usePage('Scans');
  const [params, setParams] = useSearchParams();
  const sort = (params.get('sort') as SortKey) || 'date';
  const dir = (params.get('dir') as 'asc' | 'desc') || 'desc';
  const page = Number(params.get('page') ?? 1);
  const query = params.get('q') ?? '';
  const client = params.get('client') ?? '';
  const [search, setSearch] = useState(query);
  const [showNew, setShowNew] = useState(params.get('new') === '1');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { can } = useAuth();
  const { push } = useToast();
  const clients = useApi<ClientOpt[]>('/clients');

  const path = `/sites${qs({ sort, dir, page, q: query, client, perPage: 20 })}`;
  const { data, error, loading, reload, setData } = useApi<{ items: SiteRow[]; total: number; page: number; perPage: number }>(path);

  useLiveEvents((e) => {
    if (e.type === 'scan.progress') {
      setData((d) => (d ? { ...d, items: d.items.map((s) => (s.id === e.progress.siteId ? { ...s, running: ['running', 'queued'].includes(e.progress.status) ? e.progress : null } : s)) } : d));
    }
    if (e.type === 'scan.finished') void reload(true);
  });
  useEffect(() => setSelected(new Set()), [path]);

  const update = (next: Record<string, string | number | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    setParams(p, { replace: true });
  };
  const onSort = (k: SortKey) => update({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc', page: 1 });
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: search.trim(), page: 1 });
  };

  const bulk = async (action: 'scan' | 'stop') => {
    const r = await api.post<{ results: { id: number; ok: boolean; error?: string }[] }>('/sites/bulk', { action, ids: [...selected] });
    const failed = r.results.filter((x) => !x.ok);
    push({ kind: failed.length ? 'error' : 'success', title: `${action === 'scan' ? 'Started' : 'Stopped'} ${r.results.length - failed.length} of ${r.results.length}`, body: failed[0]?.error });
    setSelected(new Set());
    void reload(true);
  };

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((s) => selected.has(s.id));

  return (
    <div className="stack-lg">
      <TopbarActions>
        {can('scan.run') && (
          <button type="button" className="btn btn--primary" onClick={() => setShowNew(true)}>
            <Plus size={16} aria-hidden="true" />
            New Scan…
          </button>
        )}
      </TopbarActions>

      <div className="row row--between">
        <form className="row" onSubmit={onSearch} role="search" style={{ flex: '1 1 420px' }}>
          <label htmlFor="scan-search" className="sr-only">
            Search scans by address
          </label>
          <input id="scan-search" className="input" type="search" placeholder="Search by address" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 380 }} />
          <button type="submit" className="btn">
            <Search size={16} aria-hidden="true" />
            Search
          </button>
          {query && (
            <button type="button" className="btn btn--ghost" onClick={() => { setSearch(''); update({ q: null, page: 1 }); }}>
              Clear
            </button>
          )}
        </form>
        {!!clients.data?.length && (
          <div style={{ width: 240 }}>
            <SelectField label="Client" labelHidden value={client} onChange={(e) => update({ client: e.target.value, page: 1 })} options={[{ value: '', label: 'All clients' }, ...clients.data.map((c) => ({ value: String(c.id), label: c.name }))]} />
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="banner banner--info" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn btn--sm" onClick={() => void bulk('scan')}>Scan selected</button>
            <button type="button" className="btn btn--sm btn--danger" onClick={() => void bulk('stop')}>Stop selected</button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <section className="card card--flush" aria-label="Scanned sites">
        {loading && !data ? (
          <div className="card__body" style={{ padding: 24 }}><LoadingBlock rows={6} /></div>
        ) : error ? (
          <div style={{ padding: 24 }}><ErrorBanner message={error} onRetry={() => void reload()} /></div>
        ) : !items.length ? (
          <Empty
            icon={<ScanSearch size={40} aria-hidden="true" />}
            title={query ? 'No scans match your search' : 'No scans yet'}
            action={can('scan.run') && !query ? <button type="button" className="btn btn--primary" onClick={() => setShowNew(true)}><Plus size={16} aria-hidden="true" /> New Scan…</button> : undefined}
          >
            {query ? `Nothing matches “${query}”. Try part of the domain name.` : 'Start a scan to check a site for accessibility, broken links, SEO and more.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Scanned sites, sortable</caption>
              <thead>
                <tr>
                  {can('scan.run') && (
                    <th scope="col" style={{ width: 44 }}>
                      <input type="checkbox" aria-label="Select all sites on this page" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((s) => s.id)) : new Set())} style={{ width: 18, height: 18, accentColor: 'var(--brand-navy)' }} />
                    </th>
                  )}
                  <SortHeader label="Address" sortKey="address" sort={sort} dir={dir} onSort={onSort} />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                  <SortHeader label="Date" sortKey="date" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Disk" sortKey="disk" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Issues" sortKey="issues" sort={sort} dir={dir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    {can('scan.run') && (
                      <td>
                        <input type="checkbox" aria-label={`Select ${hostOf(s.url)}`} checked={selected.has(s.id)} onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} style={{ width: 18, height: 18, accentColor: 'var(--brand-navy)' }} />
                      </td>
                    )}
                    <td style={{ minWidth: 280 }}>
                      <SiteCell url={s.url} to={`/sites/${s.id}`} thumbnail={s.thumbnail}>
                        <div className="row xsmall muted" style={{ gap: 8, marginTop: 6 }}>
                          <span className="row" style={{ gap: 4 }}>
                            <CalendarClock size={13} aria-hidden="true" />
                            {s.scheduleLabel === 'Not scheduled' ? 'Not scheduled' : `${s.scheduleLabel} · next ${fmtRelative(s.nextRunAt)}`}
                          </span>
                          {s.clientName && <span className="chip">{s.clientName}</span>}
                          {s.scope !== 'site' && <span className="badge badge--neutral">{s.scope === 'folder' ? 'Folder' : s.scope === 'page' ? 'Page' : 'Page and links'}</span>}
                        </div>
                      </SiteCell>
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <OptionsLink siteId={s.id} small primary={false} />
                        {s.running ? <StopScanButton scanId={s.running.scanId} small onDone={() => void reload(true)} /> : <ScanNowButton siteId={s.id} small onDone={() => void reload(true)} />}
                      </div>
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {s.running ? (
                        <LiveProgress p={s.running} showUrl={false} />
                      ) : s.lastScan ? (
                        <span className="chip" style={{ background: 'var(--surface-sunken)', color: 'var(--text-2)', borderColor: 'var(--border)' }} title={fmtRelative(s.lastScan.finishedAt)}>
                          {fmtDate(s.lastScan.finishedAt)}
                        </span>
                      ) : (
                        <span className="muted small">Never</span>
                      )}
                      {!s.running && s.lastScan && s.lastScan.status !== 'completed' && <> <StatusBadge status={s.lastScan.status} /></>}
                    </td>
                    <td className="small">{fmtPct(s.diskPct, 2)}</td>
                    <td>{s.lastScan && !s.running ? <Link className="ring-link" to={`/scans/${s.lastScan.id}/report`} aria-label={`Open report: ${Math.round(s.lastScan.issuePct)}% of pages have issues`}><MiniRing value={s.lastScan.issuePct} /></Link> : <span className="muted small">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.perPage && (
          <div className="card__foot">
            <span />
            <Pagination page={data.page} perPage={data.perPage} total={data.total} onPage={(p) => update({ page: p })} />
          </div>
        )}
      </section>

      {showNew && (
        <Modal title="New Scan" onClose={() => setShowNew(false)} wide>
          <NewScanForm compact clientId={client ? Number(client) : null} onStarted={() => { setShowNew(false); void reload(true); }} />
        </Modal>
      )}
    </div>
  );
}
