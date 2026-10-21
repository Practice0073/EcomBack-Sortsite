import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, Gauge as GaugeIcon, Globe, LayoutDashboard, Percent, Plus, ScanSearch } from 'lucide-react';
import { qs } from '../lib/api';
import { useApi, useAuth, useLiveEvents, usePage } from '../lib/app';
import { fmtDate, fmtRelative, hostOf } from '../lib/format';
import { Empty, ErrorBanner, Gauge, LoadingBlock, MiniRing, SelectField, SiteCell, SortHeader } from '../components/ui';
import { Sparkline } from '../components/Sparkline';
import '../styles/workspace.css';

interface DashSite { siteId: number; url: string; clientName: string | null; thumbnail: string | null; latestScanId: number | null; lastScanned: string | null; pages: number; issuePct: number | null; score: number | null; grade: string | null; delta: number | null; priorityRules: number; trend: number[] }
interface DashResponse { totals: { sites: number; scanned: number; avgScore: number | null; avgIssuePct: number | null; needsAttention: number; running: number }; sites: DashSite[] }
type SortKey = 'site' | 'client' | 'date' | 'pages' | 'score' | 'issues' | 'delta' | 'priority';

const GRADE_COLOR: Record<string, string> = { A: '#15803d', B: '#3f7d20', C: '#b45309', D: '#c2410c', F: '#b42318' };

export function DashboardPage() {
  usePage('Dashboard');
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const client = params.get('client') ?? '';
  const [sort, setSort] = useState<SortKey>('score');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const clients = useApi<{ id: number; name: string }[]>('/clients');
  const { data, error, loading, reload } = useApi<DashResponse>(`/dashboard${qs({ client })}`);
  useLiveEvents((e) => (e.type === 'scan.finished' || (e.type === 'scan.progress' && e.progress.status === 'queued')) && void reload(true));

  const onSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'site' || k === 'client' || k === 'score' ? 'asc' : 'desc');
    }
  };

  const rows = useMemo(() => {
    const list = [...(data?.sites ?? [])];
    const val = (s: DashSite): string | number => {
      switch (sort) {
        case 'site':
          return hostOf(s.url);
        case 'client':
          return s.clientName ?? '￿';
        case 'date':
          return s.lastScanned ? Date.parse(s.lastScanned) : 0;
        case 'pages':
          return s.pages;
        case 'score':
          return s.score ?? 999;
        case 'issues':
          return s.issuePct ?? -1;
        case 'delta':
          return s.delta ?? -999;
        case 'priority':
          return s.priorityRules;
      }
    };
    list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
      return dir === 'asc' ? c : -c;
    });
    return list;
  }, [data, sort, dir]);

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <LoadingBlock rows={8} />;
  const t = data!.totals;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h2 style={{ fontSize: '1.3rem' }}>Portfolio overview</h2>
          <p>Every client site in one place: latest ADA/WCAG score, issues and how they are trending.</p>
        </div>
        {!!clients.data?.length && (
          <div style={{ width: 260 }}>
            <SelectField
              label="Client"
              value={client}
              onChange={(e) => {
                const p = new URLSearchParams(params);
                if (e.target.value) p.set('client', e.target.value);
                else p.delete('client');
                setParams(p, { replace: true });
              }}
              options={[{ value: '', label: 'All clients' }, ...clients.data.map((c) => ({ value: String(c.id), label: c.name }))]}
            />
          </div>
        )}
      </div>

      <div className="kpis" role="list" aria-label="Portfolio totals">
        <Tile icon={<Globe size={18} />} value={t.sites.toLocaleString()} label="Sites" />
        <Tile icon={<ScanSearch size={18} />} value={t.scanned.toLocaleString()} label="Sites with a completed scan" />
        <Tile icon={<GaugeIcon size={18} />} value={t.avgScore === null ? '—' : String(t.avgScore)} label="Average ADA / WCAG score" />
        <Tile icon={<Percent size={18} />} value={t.avgIssuePct === null ? '—' : `${t.avgIssuePct}%`} label="Average pages with issues" />
        <Tile icon={<AlertTriangle size={18} />} value={t.needsAttention.toLocaleString()} label="Need attention (score under 70 or issues rising)" alert={t.needsAttention > 0} />
        <Tile icon={<Activity size={18} />} value={t.running.toLocaleString()} label="Scans running or queued" />
      </div>

      <section className="card card--flush" aria-labelledby="dash-sites">
        <div className="card__head">
          <h2 id="dash-sites">Sites</h2>
        </div>
        {!rows.length ? (
          <Empty
            icon={<LayoutDashboard size={40} aria-hidden="true" />}
            title={client ? 'No sites for this client yet' : 'No sites yet'}
            action={can('scan.run') ? <Link to="/scans?new=1" className="btn btn--primary"><Plus size={16} aria-hidden="true" /> New Scan</Link> : undefined}
          >
            Scan a site and it appears here with its score and trend.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Sites in the portfolio, sortable</caption>
              <thead>
                <tr>
                  <SortHeader label="Site" sortKey="site" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Client" sortKey="client" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Last scanned" sortKey="date" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Pages" sortKey="pages" sort={sort} dir={dir} onSort={onSort} className="num" />
                  <SortHeader label="Score" sortKey="score" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Issues" sortKey="issues" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Change" sortKey="delta" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Priority rules" sortKey="priority" sort={sort} dir={dir} onSort={onSort} className="num" />
                  <th scope="col">Trend</th>
                  <th scope="col"><span className="sr-only">Report</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.siteId}>
                    <td style={{ minWidth: 260, maxWidth: 360 }}>
                      <SiteCell url={s.url} to={`/sites/${s.siteId}`} thumbnail={s.thumbnail} />
                    </td>
                    <td>{s.clientName ? <span className="chip">{s.clientName}</span> : <span className="muted small">—</span>}</td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }} title={fmtDate(s.lastScanned)}>{s.lastScanned ? fmtRelative(s.lastScanned) : <span className="muted">Not scanned</span>}</td>
                    <td className="num">{s.pages ? s.pages.toLocaleString() : '—'}</td>
                    <td>
                      {s.score === null ? (
                        <span className="muted small">—</span>
                      ) : (
                        <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                          <Gauge value={s.score} size={36} stroke={5} label="" tone="score" ariaLabel={`ADA / WCAG score ${s.score} of 100`} />
                          <strong>{s.score}</strong>
                          {s.grade && (
                            <span className="grade" style={{ background: GRADE_COLOR[s.grade] ?? '#5b6170' }} aria-label={`Grade ${s.grade}`}>
                              {s.grade}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>{s.issuePct === null ? <span className="muted small">—</span> : s.latestScanId ? <Link className="ring-link" to={`/scans/${s.latestScanId}/report`} aria-label={`Open report: ${Math.round(s.issuePct)}% of pages have issues`}><MiniRing value={s.issuePct} /></Link> : <MiniRing value={s.issuePct} />}</td>
                    <td>
                      {s.delta === null || s.delta === 0 ? (
                        <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{s.delta === 0 ? 'No change' : '—'}</span>
                      ) : s.delta > 0 ? (
                        <span className="delta-up">
                          ▲ {s.delta} pts<span className="sr-only"> more pages with issues than the previous scan</span>
                        </span>
                      ) : (
                        <span className="delta-down">
                          ▼ {Math.abs(s.delta)} pts<span className="sr-only"> fewer pages with issues than the previous scan</span>
                        </span>
                      )}
                    </td>
                    <td className="num">{s.latestScanId ? s.priorityRules : '—'}</td>
                    <td>
                      <Sparkline values={s.trend} />
                      {s.trend.length >= 2 && <span className="sr-only">Pages with issues over the last {s.trend.length} scans: {s.trend.map((v) => `${v}%`).join(', ')}</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{s.latestScanId ? <Link to={`/scans/${s.latestScanId}/report`} className="btn btn--sm">Report</Link> : null}</td>
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

function Tile({ icon, value, label, alert = false }: { icon: ReactNode; value: string; label: string; alert?: boolean }) {
  return (
    <div className={`kpi-tile ${alert ? 'kpi-tile--alert' : ''}`} role="listitem">
      <span className="kpi-tile__icon" aria-hidden="true">{icon}</span>
      <span className="kpi__value">{value}</span>
      <span className="kpi__label">{label}</span>
    </div>
  );
}
