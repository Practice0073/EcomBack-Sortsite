import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, ScanSearch } from 'lucide-react';
import { useApi, useLiveEvents, usePage } from '../lib/app';
import { fmtDate, fmtRelative } from '../lib/format';
import { Empty, ErrorBanner, LoadingBlock, MiniRing, SegmentedButtons, SiteCell, StatusBadge } from '../components/ui';
import { LiveProgress, NewScanForm, StopScanButton } from '../components/scan';
import type { SiteRow } from '@shared/types';

interface MapRow { id: number; url: string; thumbnail: string | null; lastRun: { id: number; status: string; finishedAt: string | null; pagesDone: number } | null }

export function HomePage() {
  usePage('Home');
  const [tab, setTab] = useState<'scans' | 'sitemaps'>('scans');
  return (
    <div className="stack-lg">
      <section className="card newscan" aria-labelledby="new-scan-title">
        <div className="card__body stack">
          <div>
            <h2 id="new-scan-title" style={{ fontSize: '1.4rem' }}>
              New Scan
            </h2>
            <p className="muted" style={{ marginTop: 4 }}>
              Check a site for broken links, accessibility, browser compatibility, SEO and more. Full-site scans cover up to 500 pages.
            </p>
          </div>
          <NewScanForm />
        </div>
      </section>

      <section className="card" aria-labelledby="recent-title">
        <div className="card__head">
          <h2 id="recent-title">{tab === 'scans' ? 'Recent Scans' : 'Recent Sitemaps'}</h2>
          <SegmentedButtons
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'scans', label: (<><ScanSearch size={15} aria-hidden="true" /> Scans</>) },
              { value: 'sitemaps', label: (<><Network size={15} aria-hidden="true" /> Sitemaps</>) },
            ]}
          />
        </div>
        {tab === 'scans' ? <RecentScans /> : <RecentSitemaps />}
      </section>
    </div>
  );
}

function RecentScans() {
  const { data, error, loading, reload, setData } = useApi<{ items: SiteRow[] }>('/sites?sort=date&dir=desc&perPage=8');
  useLiveEvents((e) => {
    if (e.type === 'scan.progress') {
      setData((d) => (d ? { items: d.items.map((s) => (s.id === e.progress.siteId ? { ...s, running: e.progress.status === 'running' || e.progress.status === 'queued' ? e.progress : null } : s)) } : d));
      if (data && !data.items.some((s) => s.id === e.progress.siteId)) void reload(true);
    }
    if (e.type === 'scan.finished') void reload(true);
  });
  if (loading && !data) return <div className="card__body"><LoadingBlock /></div>;
  if (error) return <div className="card__body"><ErrorBanner message={error} onRetry={() => void reload()} /></div>;
  if (!data?.items.length) {
    return <Empty icon={<ScanSearch size={40} aria-hidden="true" />} title="No scans yet">Enter a site address above to run your first scan. Results appear here as soon as pages are checked.</Empty>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Recent scans</caption>
        <thead>
          <tr>
            <th scope="col">Address</th>
            <th scope="col">Date</th>
            <th scope="col">Issues</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((s) => (
            <tr key={s.id}>
              <td>
                <SiteCell url={s.url} to={`/sites/${s.id}`} thumbnail={s.thumbnail} />
              </td>
              <td>
                {s.running ? (
                  <LiveProgress p={s.running} />
                ) : s.lastScan ? (
                  <span title={fmtDate(s.lastScan.finishedAt)}>
                    {fmtRelative(s.lastScan.finishedAt)} {s.lastScan.status !== 'completed' && <StatusBadge status={s.lastScan.status} />}
                  </span>
                ) : (
                  <span className="muted">Not scanned</span>
                )}
              </td>
              <td>{s.running ? <span className="muted small">Scanning…</span> : s.lastScan ? <Link className="ring-link" to={`/scans/${s.lastScan.id}/report`} aria-label={`Report: ${Math.round(s.lastScan.issuePct)}% of pages have issues`}><MiniRing value={s.lastScan.issuePct} /></Link> : '—'}</td>
              <td className="num">{s.running && <StopScanButton scanId={s.running.scanId} small onDone={() => void reload(true)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentSitemaps() {
  const { data, error, loading, reload } = useApi<MapRow[]>('/sitemaps');
  useLiveEvents((e) => e.type === 'sitemap.progress' && e.status !== 'running' && void reload(true));
  if (loading && !data) return <div className="card__body"><LoadingBlock /></div>;
  if (error) return <div className="card__body"><ErrorBanner message={error} onRetry={() => void reload()} /></div>;
  if (!data?.length) {
    return (
      <Empty icon={<Network size={40} aria-hidden="true" />} title="No sitemaps yet" action={<Link className="btn btn--primary" to="/sitemaps">Create a sitemap</Link>}>
        A sitemap is a quick crawl that draws your site structure and exports sitemap.xml.
      </Empty>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Recent sitemaps</caption>
        <thead>
          <tr>
            <th scope="col">Address</th>
            <th scope="col">Date</th>
            <th scope="col">Pages</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 8).map((m) => (
            <tr key={m.id}>
              <td>
                <SiteCell url={m.url} to={`/sitemaps/${m.id}`} thumbnail={m.thumbnail} />
              </td>
              <td>{m.lastRun?.status === 'running' || m.lastRun?.status === 'queued' ? <StatusBadge status={m.lastRun.status} /> : fmtRelative(m.lastRun?.finishedAt)}</td>
              <td>{m.lastRun?.pagesDone.toLocaleString() ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
