import { useEffect, useId, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Download, ExternalLink, History, Loader2, ShoppingBag } from 'lucide-react';
import { api } from '../../lib/api';
import { TopbarActions, useApi, useAuth, useLiveEvents, usePage, useToast } from '../../lib/app';
import { fmtBytes, fmtDateTime, hostOf } from '../../lib/format';
import { ErrorBanner, LoadingBlock, Modal, Skeleton, StatusBadge, TabLinks } from '../../components/ui';
import { LiveProgress, OptionsLink, ScanNowButton, StopScanButton } from '../../components/scan';
import { CATEGORY_LABELS } from '@shared/options';
import type { ReportSummary, ScanProgress } from '@shared/types';
import { ReportContext } from './context';
import { Overview } from './Overview';
import { SiteMap3D } from './SiteMap3D';
import { Tested } from './Tested';
import { IssuesTab } from './Issues';
import { Inventory, IssuesByPage, Diagnostics } from './Pages';
import '../../styles/report.css';

type ExportFormat = 'docx' | 'pdf' | 'html' | 'csv-issues' | 'csv-pages' | 'xlsx' | 'json';
type ReportType = 'full' | 'summary' | 'executive' | 'issues-only';

const DOWNLOADS: { key: string; label: string; format: ExportFormat; type: ReportType }[] = [
  { key: 'full-docx', label: 'Full Report – Word', format: 'docx', type: 'full' },
  { key: 'full-pdf', label: 'Full Report – PDF', format: 'pdf', type: 'full' },
  { key: 'exec-pdf', label: 'Executive Summary – PDF', format: 'pdf', type: 'executive' },
  { key: 'summary-html', label: 'Summary – HTML', format: 'html', type: 'summary' },
  { key: 'issues-html', label: 'Issues only – HTML', format: 'html', type: 'issues-only' },
  { key: 'issues-csv', label: 'Issues – CSV', format: 'csv-issues', type: 'full' },
  { key: 'pages-csv', label: 'Pages – CSV', format: 'csv-pages', type: 'full' },
  { key: 'xlsx', label: 'Excel workbook', format: 'xlsx', type: 'full' },
  { key: 'json', label: 'JSON (API)', format: 'json', type: 'full' },
];

interface ExportRow { id: number; formatLabel: string; typeLabel: string; status: string; bytes: number; error: string | null; createdAt: string; userName: string; downloadUrl: string | null }

export function ReportRoutes() {
  const { id } = useParams();
  const scanId = Number(id);
  const base = `/scans/${scanId}/report`;
  const { data, error, reload } = useApi<ReportSummary>(`/scans/${scanId}/report/summary`);
  const location = useLocation();
  const navigate = useNavigate();
  const [live, setLive] = useState<ScanProgress | null>(null);
  usePage('Scan Report');

  useEffect(() => setLive(data?.running ?? null), [data?.running]);
  useLiveEvents((e) => {
    if (e.type === 'scan.progress' && e.progress.scanId === scanId) setLive(['running', 'queued'].includes(e.progress.status) ? e.progress : null);
    if (e.type === 'scan.finished' && e.scanId === scanId) {
      setLive(null);
      void reload(true);
    }
  });
  // While running, refresh the partial report periodically so counts move.
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void reload(true), 15_000);
    return () => window.clearInterval(t);
  }, [live, reload]);

  const ctx = useMemo(() => (data ? { scanId, summary: data, base, reload: () => void reload(true) } : null), [data, scanId, base, reload]);

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (!data || !ctx) {
    return (
      <div className="stack-lg" aria-busy="true">
        <Skeleton h={44} w="60%" />
        <Skeleton h={40} />
        <LoadingBlock rows={8} />
      </div>
    );
  }

  const enabled = data.categories.filter((c) => c.enabled);

  return (
    <ReportContext.Provider value={ctx}>
      <div className="stack-lg">
        <TopbarActions>
          <OptionsLink siteId={data.site.id} />
          {live ? <StopScanButton scanId={live.scanId} /> : <ScanNowButton siteId={data.site.id} onDone={() => navigate(`/sites/${data.site.id}`)} />}
          <DownloadControl scanId={scanId} disabled={data.scan.status === 'queued'} />
        </TopbarActions>

        <div className="report-head">
          <div style={{ minWidth: 0 }}>
            <Link to={`/sites/${data.site.id}`} className="row small" style={{ gap: 4, textDecoration: 'none', fontWeight: 500 }}>
              <ChevronLeft size={16} aria-hidden="true" />
              Scan history
            </Link>
            <a href={data.site.url} target="_blank" rel="noreferrer noopener" className="row" style={{ gap: 6, fontWeight: 600, fontSize: '1.05rem', marginTop: 6, wordBreak: 'break-all' }}>
              {data.site.url}
              <ExternalLink size={14} aria-hidden="true" />
              <span className="sr-only">(opens in new tab)</span>
            </a>
            <p className="row muted small" style={{ gap: 8, marginTop: 4 }}>
              Scanned {fmtDateTime(data.scan.finishedAt ?? data.scan.startedAt)}
              {data.scan.status !== 'completed' && <StatusBadge status={data.scan.status} />}
              {data.site.clientName && <span className="chip">{data.site.clientName}</span>}
              {data.shopify && (
                <span className="badge badge--success">
                  <ShoppingBag size={12} aria-hidden="true" /> Shopify
                </span>
              )}
            </p>
          </div>
        </div>

        {live && (
          <div className="banner banner--info report-live" role="status">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>This scan is still running.</strong> The report shows the pages checked so far and updates automatically.
              <div style={{ marginTop: 10 }}>
                <LiveProgress p={live} />
              </div>
            </div>
          </div>
        )}
        {data.scan.status === 'failed' && <ErrorBanner message={`This scan failed: ${data.scan.error ?? 'unknown error'}`} />}

        <nav aria-label="Report sections" className="tabs">
          {(['summary', 'issues', 'pages'] as const).map((t) => {
            const active = location.pathname.startsWith(`${base}/${t}`);
            return (
              <Link key={t} to={t === 'issues' ? `${base}/issues/${enabled[0]?.category ?? 'accessibility'}` : `${base}/${t}`} className={`tab ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                {t === 'summary' ? 'Summary' : t === 'issues' ? 'Issues' : 'Pages'}
              </Link>
            );
          })}
        </nav>

        <Routes>
          <Route index element={<Navigate to="summary/overview" replace />} />
          <Route path="summary" element={<Navigate to="overview" replace />} />
          <Route path="summary/*" element={<SubNav base={`${base}/summary`} label="Summary views" tabs={[['overview', 'Overview'], ['sitemap', 'Site Map'], ['tested', 'What was Tested']]} />} />
          <Route path="issues/*" element={<SubNav base={`${base}/issues`} label="Issue categories" tabs={enabled.map((c) => [c.category, CATEGORY_LABELS[c.category], c.issueCount])} />} />
          <Route path="pages" element={<Navigate to="issues" replace />} />
          <Route path="pages/*" element={<SubNav base={`${base}/pages`} label="Page views" tabs={[['inventory', 'Inventory'], ['issues', 'Issues by Page'], ['diagnostics', 'Diagnostics', data.diagnosticsCount]]} />} />
        </Routes>

        <Routes>
          <Route path="summary/overview" element={<Overview />} />
          <Route path="summary/sitemap" element={<SiteMap3D />} />
          <Route path="summary/tested" element={<Tested />} />
          {/* Fix Plan and Accessibility Statement are hidden (owner request, 19 Oct 2026); FixPlan.tsx and
              Statement.tsx are kept — re-add their tabs and routes to bring them back. Old links land on Overview. */}
          <Route path="summary/fixplan" element={<Navigate to={`${base}/summary/overview`} replace />} />
          <Route path="summary/statement" element={<Navigate to={`${base}/summary/overview`} replace />} />
          <Route path="issues/:category" element={<IssuesTab />} />
          <Route path="pages/inventory" element={<Inventory />} />
          <Route path="pages/issues" element={<IssuesByPage />} />
          <Route path="pages/diagnostics" element={<Diagnostics />} />
          <Route path="*" element={null} />
        </Routes>
      </div>
    </ReportContext.Provider>
  );
}

function SubNav({ base, label, tabs }: { base: string; label: string; tabs: ([string, string] | [string, string, number])[] }) {
  return <TabLinks pills label={label} tabs={tabs.map(([to, text, count]) => ({ to: `${base}/${to}`, label: text, count }))} />;
}

/** Report-format dropdown + green Download button + export history (Plan.md §8). */
function DownloadControl({ scanId, disabled }: { scanId: number; disabled: boolean }) {
  const [choice, setChoice] = useState(DOWNLOADS[0]!.key);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { push } = useToast();
  const { can } = useAuth();
  const selectId = useId();
  if (!can('report.export')) return null;

  const download = async () => {
    const d = DOWNLOADS.find((x) => x.key === choice)!;
    setBusy(true);
    try {
      const r = await api.post<{ id: number; downloadUrl: string }>(`/scans/${scanId}/export`, { format: d.format, type: d.type });
      window.location.assign(r.downloadUrl);
      push({ kind: 'success', title: `${d.label} ready`, body: 'Your download has started.' });
    } catch (e) {
      push({ kind: 'error', title: 'Report could not be generated', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row download-control">
      <label htmlFor={selectId} className="sr-only">
        Report format
      </label>
      <select id={selectId} className="select" value={choice} onChange={(e) => setChoice(e.target.value)} style={{ minHeight: 40 }} disabled={busy}>
        {DOWNLOADS.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn--success" onClick={download} disabled={busy || disabled} aria-live="polite">
        {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        {busy ? 'Preparing…' : 'Download'}
      </button>
      <button type="button" className="icon-btn" onClick={() => setShowHistory(true)} aria-label="Report history">
        <History size={19} />
      </button>
      {showHistory && <ExportHistory scanId={scanId} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function ExportHistory({ scanId, onClose }: { scanId: number; onClose: () => void }) {
  const { data, error, loading } = useApi<ExportRow[]>(`/scans/${scanId}/exports`);
  return (
    <Modal title="Report history" onClose={onClose} wide>
      {loading && !data ? (
        <LoadingBlock rows={3} />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : !data?.length ? (
        <p className="muted">No reports have been generated for this scan yet. Choose a format and press Download.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Generated reports</caption>
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Created</th>
                <th scope="col">By</th>
                <th scope="col" className="num">Size</th>
                <th scope="col"><span className="sr-only">Download</span></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong className="small">{r.typeLabel}</strong>
                    <div className="xsmall muted">{r.formatLabel}</div>
                    {r.error && <div className="xsmall" style={{ color: 'var(--danger)' }}>{r.error}</div>}
                  </td>
                  <td className="small">{fmtDateTime(r.createdAt)}</td>
                  <td className="small">{r.userName}</td>
                  <td className="num small">{fmtBytes(r.bytes)}</td>
                  <td className="num">
                    {r.downloadUrl ? (
                      <a className="btn btn--sm" href={r.downloadUrl}>
                        <Download size={14} aria-hidden="true" /> Download
                      </a>
                    ) : (
                      <StatusBadge status={r.status === 'failed' ? 'failed' : r.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
