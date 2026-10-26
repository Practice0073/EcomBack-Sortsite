import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, ExternalLink, GitCompare, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { TopbarActions, useApi, useAuth, useLiveEvents, usePage, useToast } from '../lib/app';
import { fmtBytes, fmtDateTime, fmtPct, fmtRelative, hostOf } from '../lib/format';
import { ConfirmModal, ErrorBanner, Gauge, LoadingBlock, MiniRing, Pagination, SortHeader, StatusBadge, Thumb } from '../components/ui';
import { LiveProgress, OptionsLink, ResumeButton, ScanNowButton, StopScanButton } from '../components/scan';
import { TrendChart } from '../components/TrendChart';
import { SCOPE_LABELS } from '@shared/options';
import type { ScanProgress, ScanSummaryRow, SiteRow } from '@shared/types';

type HistoryRow = ScanSummaryRow & { running: ScanProgress | null; canResume: boolean };
interface HistoryResponse { items: HistoryRow[]; total: number; page: number; perPage: number; trend: { scanId: number; date: string; priority: number; other: number; issues: number }[]; footer: { scans: number; diskBytes: number; diskPct: number } }

export function HistoryPage() {
  const { id } = useParams();
  const siteId = Number(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const { push } = useToast();
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<'scans' | 'site' | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const site = useApi<SiteRow>(`/sites/${siteId}`);
  const history = useApi<HistoryResponse>(`/sites/${siteId}/history?dir=${dir}&page=${page}&perPage=20`);
  usePage(site.data ? hostOf(site.data.url) : 'Scan History');

  useLiveEvents((e) => {
    if (e.type === 'scan.progress' && e.progress.siteId === siteId) {
      history.setData((d) => (d ? { ...d, items: d.items.map((r) => (r.id === e.progress.scanId ? { ...r, status: e.progress.status, running: ['running', 'queued'].includes(e.progress.status) ? e.progress : null } : r)) } : d));
      if (history.data && !history.data.items.some((r) => r.id === e.progress.scanId)) void history.reload(true);
    }
    if (e.type === 'scan.finished' && e.siteId === siteId) {
      void history.reload(true);
      void site.reload(true);
    }
  });

  if (site.error) return <ErrorBanner message={site.error} onRetry={() => void site.reload()} />;
  if (!site.data || !history.data) return <LoadingBlock rows={8} />;
  const s = site.data;
  const h = history.data;
  const latest = h.items.find((r) => r.status === 'completed' || r.status === 'stopped') ?? (s.lastScan && s.lastScan.status !== 'failed' ? (s.lastScan as HistoryRow) : null);
  const host = hostOf(s.url);
  const finished = h.items.filter((r) => !r.running);

  const deleteScans = async (typed: string) => {
    setBusy(true);
    setConfirmError(null);
    try {
      const r = await api.post<{ deleted: number }>(`/sites/${siteId}/scans/delete`, selected.size ? { ids: [...selected], confirm: typed } : { all: true, confirm: typed });
      push({ kind: 'success', title: `Deleted ${r.deleted} scan${r.deleted === 1 ? '' : 's'}`, body: 'Disk space has been freed.' });
      setSelected(new Set());
      setConfirm(null);
      void history.reload();
      void site.reload(true);
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteSite = async (typed: string) => {
    setBusy(true);
    setConfirmError(null);
    try {
      await api.del(`/sites/${siteId}`, { confirm: typed });
      push({ kind: 'success', title: `Deleted ${host}` });
      navigate('/scans');
    } catch (e) {
      setConfirmError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <TopbarActions>
        <OptionsLink siteId={siteId} />
        {s.running ? <StopScanButton scanId={s.running.scanId} onDone={() => void history.reload(true)} /> : <ScanNowButton siteId={siteId} onDone={() => void history.reload(true)} />}
      </TopbarActions>

      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href={s.url} target="_blank" rel="noreferrer noopener" className="row" style={{ gap: 6, fontWeight: 600, fontSize: '1.1rem', wordBreak: 'break-all' }}>
            {s.url}
            <ExternalLink size={15} aria-hidden="true" />
            <span className="sr-only">(opens in new tab)</span>
          </a>
          <p className="row" style={{ gap: 8 }}>
            <CalendarClock size={15} aria-hidden="true" />
            Next scan: {s.nextRunAt ? `${fmtDateTime(s.nextRunAt)} (${s.scheduleLabel})` : 'Not scheduled'}
            {s.clientName && <span className="chip">{s.clientName}</span>}
            <span className="badge badge--neutral">{SCOPE_LABELS[s.scope]}</span>
          </p>
        </div>
        <div className="row">
          {h.trend.length >= 2 && (
            <Link to={`/sites/${siteId}/compare`} className="btn">
              <GitCompare size={16} aria-hidden="true" />
              Compare scans
            </Link>
          )}
          {can('site.delete') && (
            <button type="button" className="btn btn--ghost" onClick={() => { setConfirmError(null); setConfirm('site'); }} disabled={!!s.running}>
              <Trash2 size={16} aria-hidden="true" />
              Delete site
            </button>
          )}
        </div>
      </div>

      <section className="card" aria-label="Summary">
        <div className="card__body summary-strip">
          <Thumb src={s.thumbnail} alt={`Home page of ${host}`} large />
          <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
            {s.running && s.running.pagesDone > 0 ? (
              <>
                <Link to={`/scans/${s.running.scanId}/report`} aria-label={`Open live report: ${Math.round(s.running.issuePct)}% of pages checked so far have issues`}>
                  <Gauge value={s.running.issuePct} size={128} sub="so far" ariaLabel={`${Math.round(s.running.issuePct)}% of pages checked so far have issues`} />
                </Link>
                <strong>Issues <span className="badge badge--success badge--live" style={{ marginLeft: 4 }}>Live</span></strong>
              </>
            ) : latest ? (
              <>
                <Link to={`/scans/${latest.id}/report`} aria-label={`Open latest report: ${Math.round(latest.issuePct)}% of pages have issues`}>
                  <Gauge value={latest.issuePct} size={128} sub="of pages" ariaLabel={`${Math.round(latest.issuePct)}% of pages have issues`} />
                </Link>
                <strong>Issues</strong>
              </>
            ) : (
              <p className="muted">No completed scans yet</p>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Trend</h2>
            <TrendChart points={h.trend} />
          </div>
        </div>
      </section>

      <section className="card card--flush" aria-labelledby="hist-title">
        <div className="card__head">
          <h2 id="hist-title">Scan history</h2>
          {selected.size > 0 && <span className="muted small">{selected.size} selected</span>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Scans of {host}</caption>
            <thead>
              <tr>
                {can('scan.delete') && (
                  <th scope="col" style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all finished scans on this page"
                      checked={finished.length > 0 && finished.every((r) => selected.has(r.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(finished.map((r) => r.id)) : new Set())}
                      style={{ width: 18, height: 18, accentColor: 'var(--brand-navy)' }}
                    />
                  </th>
                )}
                <SortHeader label="Date" sortKey="date" sort="date" dir={dir} onSort={() => { setDir((d) => (d === 'desc' ? 'asc' : 'desc')); setPage(1); }} />
                <th scope="col">Scope</th>
                <th scope="col">Disk</th>
                <th scope="col">Issues</th>
              </tr>
            </thead>
            <tbody>
              {h.items.map((r) => (
                <tr key={r.id}>
                  {can('scan.delete') && (
                    <td>
                      {!r.running && (
                        <input type="checkbox" aria-label={`Select scan from ${fmtDateTime(r.startedAt)}`} checked={selected.has(r.id)} onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} style={{ width: 18, height: 18, accentColor: 'var(--brand-navy)' }} />
                      )}
                    </td>
                  )}
                  <td style={{ minWidth: 260 }}>
                    {r.running ? (
                      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                        <LiveProgress p={r.running} />
                        <StopScanButton scanId={r.id} small onDone={() => void history.reload(true)} />
                      </div>
                    ) : (
                      <div className="stack" style={{ gap: 4 }}>
                        <Link to={`/scans/${r.id}/report`} style={{ fontWeight: 600 }}>
                          {fmtDateTime(r.finishedAt ?? r.startedAt)}
                        </Link>
                        <span className="row xsmall muted" style={{ gap: 6 }}>
                          {fmtRelative(r.finishedAt ?? r.startedAt)} · {r.pagesChecked.toLocaleString()} pages
                          {r.status !== 'completed' && <StatusBadge status={r.status} />}
                          {r.canResume && <ResumeButton scanId={r.id} onDone={() => void history.reload(true)} />}
                        </span>
                        {r.error && <span className="xsmall" style={{ color: 'var(--danger)' }}>{r.error}</span>}
                      </div>
                    )}
                  </td>
                  <td>{SCOPE_LABELS[r.scope]} scan</td>
                  <td className="small">{fmtPct(r.diskPct, 2)}</td>
                  <td>
                    {r.running ? (
                      r.running.pagesDone > 0 ? (
                        <Link className="ring-link" to={`/scans/${r.id}/report`} aria-label={`Open live report: ${Math.round(r.running.issuePct)}% of pages checked so far have issues`}>
                          <MiniRing value={r.running.issuePct} live />
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )
                    ) : r.status === 'failed' || r.pagesChecked === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <Link className="ring-link" to={`/scans/${r.id}/report`} aria-label={`Open report: ${Math.round(r.issuePct)}% of pages have issues`}>
                        <MiniRing value={r.issuePct} />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card__foot">
          <span>
            {h.footer.scans.toLocaleString()} scan{h.footer.scans === 1 ? '' : 's'} · {fmtPct(h.footer.diskPct, 2)} used · {fmtBytes(h.footer.diskBytes)}
          </span>
          <div className="row">
            <Pagination page={h.page} perPage={h.perPage} total={h.total} onPage={setPage} />
            {can('scan.delete') && (
              <button type="button" className="btn btn--danger" onClick={() => { setConfirmError(null); setConfirm('scans'); }} disabled={!finished.length}>
                <Trash2 size={16} aria-hidden="true" />
                {selected.size ? `Delete ${selected.size} Scan${selected.size === 1 ? '' : 's'}` : 'Delete Scans'}
              </button>
            )}
          </div>
        </div>
      </section>

      {confirm === 'scans' && (
        <ConfirmModal
          title={selected.size ? `Delete ${selected.size} scan${selected.size === 1 ? '' : 's'}?` : 'Delete all finished scans?'}
          message={<p>{selected.size ? 'The selected scans and their reports and exports are deleted permanently.' : `Every finished scan of ${host}, with reports and exports, is deleted permanently. Running scans are kept.`} This frees disk quota and cannot be undone.</p>}
          confirmWord={host}
          confirmLabel="Delete permanently"
          busy={busy}
          error={confirmError}
          onConfirm={deleteScans}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'site' && (
        <ConfirmModal
          title={`Delete ${host}?`}
          message={<p>The site, its options, schedule and all {h.footer.scans} scans are deleted permanently. This cannot be undone.</p>}
          confirmWord={host}
          confirmLabel="Delete site"
          busy={busy}
          error={confirmError}
          onConfirm={deleteSite}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
