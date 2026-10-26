import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, ExternalLink, FileText, Info, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApi } from '../../lib/app';
import { fmtBytes, pathOf } from '../../lib/format';
import { Empty, ErrorBanner, Gauge, GuidelineChip, LoadingBlock, Pagination, SevDot, SortHeader, Spinner } from '../../components/ui';
import { CATEGORY_LABELS } from '@shared/options';
import { BenchmarkBadge } from './Overview';
import { ruleHref, useReport, type DiagnosticGroup, type InventoryFile, type InventoryGroup, type PageDetail, type PageListResponse } from './context';

// ── Inventory ─────────────────────────────────────────────────────────────────
export function Inventory() {
  const { scanId } = useReport();
  const { data, error, loading, reload } = useApi<InventoryGroup[]>(`/scans/${scanId}/report/inventory`);
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <LoadingBlock rows={8} />;
  return (
    <section className="card card--flush" aria-labelledby="inv-title">
      <div className="card__head">
        <h2 id="inv-title">Inventory</h2>
        <span className="muted small">{data.reduce((s, g) => s + g.rows.reduce((a, r) => a + r.count, 0), 0).toLocaleString()} URLs found</span>
      </div>
      <div className="table-wrap">
        <table className="table inv-table">
          <caption className="sr-only">Pages and files found, by type</caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col" className="num">URL count</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          {data.map((g) => (
            <tbody key={g.kind}>
              <tr className="inv-group">
                <th scope="rowgroup" colSpan={3}>
                  {g.label}
                </th>
              </tr>
              {g.rows.map((r) => (
                <InventoryRow key={r.subtype} scanId={scanId} kind={g.kind} row={r} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

function InventoryRow({ scanId, kind, row }: { scanId: number; kind: string; row: InventoryGroup['rows'][number] }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<InventoryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  useEffect(() => {
    if (!open || files) return;
    api
      .get<InventoryFile[]>(`/scans/${scanId}/report/inventory/${kind}/${encodeURIComponent(row.subtype)}`, { quiet: true })
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, [open, files, scanId, kind, row.subtype]);
  const empty = row.count === 0;
  return (
    <>
      <tr className={empty ? 'is-muted' : undefined}>
        <td>
          {empty ? (
            <span style={{ paddingLeft: 26 }}>{row.subtype}</span>
          ) : (
            <button type="button" className="inv-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
              <ChevronRight size={16} className="inv-chev" aria-hidden="true" data-open={open} />
              {row.subtype}
            </button>
          )}
        </td>
        <td className="num">
          {row.count.toLocaleString()}
          {row.broken > 0 && <span className="badge badge--danger" style={{ marginLeft: 8 }}>{row.broken} broken</span>}
        </td>
        <td className="small">
          {row.description}
          {row.bytes > 0 && <span className="muted"> · {fmtBytes(row.bytes)}</span>}
        </td>
      </tr>
      {open && (
        <tr id={bodyId}>
          <td colSpan={3} className="inv-files">
            {error ? (
              <ErrorBanner message={error} />
            ) : !files ? (
              <Spinner />
            ) : (
              <ul role="list">
                {files.map((f) => {
                  const broken = f.verdict === 'broken';
                  return (
                    <li key={f.url} className={broken ? 'is-broken' : undefined}>
                      <a href={f.url} target="_blank" rel="noreferrer noopener">
                        {f.url}
                        <span className="sr-only"> (opens in new tab)</span>
                      </a>
                      <span className={`badge ${broken ? 'badge--danger' : f.verdict === 'unverified' ? 'badge--warning' : 'badge--neutral'}`} title={f.verdict === 'unverified' ? 'The other site refused or did not answer the automated check; not reported as broken' : undefined}>
                        {f.status ?? f.error ?? '—'}
                        {f.verdict === 'unverified' && <span className="sr-only"> (could not verify)</span>}
                      </span>
                      {!f.internal && <span className="badge badge--info">External</span>}
                      {f.bytes ? <span className="xsmall muted">{fmtBytes(f.bytes)}</span> : null}
                    </li>
                  );
                })}
                {files.length >= 500 && <li className="muted xsmall">Showing the first 500 files. Download the Excel report for the full list.</li>}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Issues by Page ────────────────────────────────────────────────────────────
type PageSort = 'issues' | 'url' | 'depth' | 'priority';

export function IssuesByPage() {
  const { scanId, summary } = useReport();
  const [params, setParams] = useSearchParams();
  const openId = params.get('page') ? Number(params.get('page')) : null;
  const [sort, setSort] = useState<PageSort>('issues');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [p, setP] = useState(1);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useApi<PageListResponse>(`/scans/${scanId}/report/pages${qs({ sort, dir, page: p, q: query, perPage: 50 })}`);
  const pct = summary.pagesChecked ? (summary.pagesWithIssues / summary.pagesChecked) * 100 : 0;

  const onSort = (k: PageSort) => {
    setDir(sort === k && dir === 'desc' ? 'asc' : 'desc');
    setSort(k);
    setP(1);
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setQuery(text.trim());
    setP(1);
  };
  const toggle = (id: number) => {
    const next = new URLSearchParams(params);
    if (openId === id) next.delete('page');
    else next.set('page', String(id));
    setParams(next, { replace: true });
  };

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card__body overview-hero">
          <Gauge value={pct} size={110} sub="of pages" ariaLabel={`${Math.round(pct)}% of pages have issues`} />
          <div className="stack" style={{ gap: 8 }}>
            <h2 style={{ fontSize: '1.3rem' }}>{summary.pagesWithIssues.toLocaleString()} pages with issues</h2>
            <BenchmarkBadge benchmark={summary.benchmark} />
          </div>
        </div>
      </section>

      <section className="card card--flush" aria-labelledby="pages-title">
        <div className="card__head">
          <h2 id="pages-title">Issues by page</h2>
          <form className="row" role="search" onSubmit={onSearch}>
            <label htmlFor="page-search" className="sr-only">Search pages by address or title</label>
            <input id="page-search" className="input" type="search" placeholder="Search by URL or title" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 280 }} />
            <button type="submit" className="btn">
              <Search size={16} aria-hidden="true" /> Search
            </button>
          </form>
        </div>
        {error ? (
          <div style={{ padding: 24 }}><ErrorBanner message={error} onRetry={() => void reload()} /></div>
        ) : loading && !data ? (
          <div style={{ padding: 24 }}><LoadingBlock rows={6} /></div>
        ) : !data?.items.length ? (
          <Empty icon={<FileText size={36} aria-hidden="true" />} title={query ? 'No pages match' : 'No pages with issues'}>
            {query ? `Nothing matches “${query}”.` : 'Every checked page passed the enabled rules.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Pages with issues, sortable</caption>
              <thead>
                <tr>
                  <SortHeader label="Issues" sortKey="issues" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Page" sortKey="url" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Priority" sortKey="priority" sort={sort} dir={dir} onSort={onSort} className="num" />
                  <th scope="col" className="num">Other</th>
                  <th scope="col" className="num">Warnings</th>
                  <SortHeader label="Depth" sortKey="depth" sort={sort} dir={dir} onSort={onSort} className="num" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <PageRow key={row.pageId} row={row} scanId={scanId} open={openId === row.pageId} onToggle={() => toggle(row.pageId)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.perPage && (
          <div className="card__foot">
            <span />
            <Pagination page={data.page} perPage={data.perPage} total={data.total} onPage={setP} />
          </div>
        )}
      </section>
      {openId !== null && data && !data.items.some((r) => r.pageId === openId) && (
        <section className="card" aria-label="Selected page">
          <div className="card__body">
            <PageDetailView scanId={scanId} pageId={openId} />
          </div>
        </section>
      )}
    </div>
  );
}

function PageRow({ row, scanId, open, onToggle }: { row: PageListResponse['items'][number]; scanId: number; open: boolean; onToggle: () => void }) {
  const bodyId = useId();
  return (
    <>
      <tr data-open={open}>
        <td className="num" style={{ width: 90 }}>
          <strong>{row.total.toLocaleString()}</strong>
        </td>
        <td style={{ minWidth: 300 }}>
          <button type="button" className="inv-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
            <ChevronRight size={16} className="inv-chev" data-open={open} aria-hidden="true" />
            <span style={{ minWidth: 0, textAlign: 'left' }}>
              <span className="page-path">{pathOf(row.url)}</span>
              {row.title && <span className="xsmall muted" style={{ display: 'block' }}>{row.title}</span>}
            </span>
          </button>
        </td>
        <td className="num">{row.priority || '—'}</td>
        <td className="num">{row.other || '—'}</td>
        <td className="num">{row.warning || '—'}</td>
        <td className="num">{row.depth >= 99 ? 'File' : row.depth}</td>
      </tr>
      {open && (
        <tr id={bodyId}>
          <td colSpan={6} className="page-detail-cell">
            <PageDetailView scanId={scanId} pageId={row.pageId} />
          </td>
        </tr>
      )}
    </>
  );
}

function PageDetailView({ scanId, pageId }: { scanId: number; pageId: number }) {
  const { data, error, loading } = useApi<PageDetail>(`/scans/${scanId}/report/pages/${pageId}`);
  if (error) return <ErrorBanner message={error} />;
  if (loading || !data) return <Spinner label="Loading page details" />;
  const pg = data.page;
  return (
    <div className="stack page-detail">
      <div className="row row--between">
        <dl className="dl small">
          <dt>Address</dt>
          <dd style={{ wordBreak: 'break-all' }}>{pg.url}</dd>
          {pg.title && (
            <>
              <dt>Title</dt>
              <dd>{pg.title}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>
            {pg.status ?? '—'} · {fmtBytes(pg.bytes)}
            {pg.loadMs ? ` · ${(pg.loadMs / 1000).toFixed(1)} s` : ''}
            {pg.words ? ` · ${pg.words.toLocaleString()} words` : ''}
          </dd>
        </dl>
        <a className="btn btn--sm" href={pg.finalUrl ?? pg.url} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={14} aria-hidden="true" /> Open live page
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
      {data.issues.length === 0 ? (
        <p className="muted small">No issues on this page.</p>
      ) : (
        <ul role="list" className="page-issues">
          {data.issues.map((iss) => (
            <li key={iss.ruleId}>
              <div className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <SevDot severity={iss.severity} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong className="small">{iss.title}</strong>
                    <span className="badge badge--neutral">{CATEGORY_LABELS[iss.category]}</span>
                  </div>
                  <p className="small muted" style={{ marginTop: 4 }}>{iss.description}</p>
                  <p className="small" style={{ marginTop: 4 }}>
                    <strong>Fix: </strong>
                    {iss.fix}
                  </p>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {iss.guidelines.map((g) => (
                      <GuidelineChip key={g.label} label={g.label} url={g.url} />
                    ))}
                    <Link className="chip chip--plain" to={ruleHref(iss.ruleId)}>Rule details</Link>
                  </div>
                  {iss.occurrences.slice(0, 10).map((o, i) => (
                    <div key={i} className="occ__line">
                      <span className="line-chip">{o.line ? `Line ${o.line}` : 'Rendered DOM'}</span>
                      {o.snippet && <code className="snippet">{o.snippet}</code>}
                      {o.detail && o.detail !== o.snippet && <p className="xsmall muted occ__detail">{o.detail}</p>}
                    </div>
                  ))}
                  {iss.occurrences.length > 10 && <p className="xsmall muted">+ {iss.occurrences.length - 10} more on this page</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
export function Diagnostics() {
  const { scanId } = useReport();
  const { data, error, loading, reload } = useApi<DiagnosticGroup[]>(`/scans/${scanId}/report/diagnostics`);
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <LoadingBlock rows={6} />;
  return (
    <section className="card card--flush" aria-labelledby="diag-title">
      <div className="card__head">
        <h2 id="diag-title">Diagnostics</h2>
        <span className="row small muted" style={{ gap: 6 }}>
          <Info size={15} aria-hidden="true" /> Informative messages about the scan — these are not errors.
        </span>
      </div>
      {!data.length ? (
        <Empty title="No diagnostics">The scan ran without anything worth noting.</Empty>
      ) : (
        data.map((d) => <DiagnosticRow key={d.code} d={d} />)
      )}
    </section>
  );
}

function DiagnosticRow({ d }: { d: DiagnosticGroup }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const expandable = d.urls.length > 0;
  return (
    <div className="xrow" data-open={open}>
      <button type="button" className="xrow__head" aria-expanded={expandable ? open : undefined} aria-controls={expandable ? bodyId : undefined} onClick={() => expandable && setOpen((o) => !o)} style={{ cursor: expandable ? 'pointer' : 'default' }}>
        <Info size={18} color="var(--info)" aria-hidden="true" />
        <span style={{ minWidth: 0 }}>
          <span className="xrow__title">{d.label}</span>
          <span className="small muted" style={{ display: 'block', marginTop: 2 }}>{d.message}</span>
        </span>
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
          {expandable ? `${d.count.toLocaleString()} ${d.count === 1 ? 'page' : 'pages'}` : ''}
        </span>
        {expandable ? <ChevronRight size={18} className="xrow__chev" aria-hidden="true" /> : <span />}
      </button>
      {open && (
        <div className="xrow__body" id={bodyId}>
          <ul role="list" className="diag-urls">
            {d.urls.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer noopener">
                  {u}
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
            ))}
          </ul>
          {d.count > d.urls.length && <p className="xsmall muted">Showing {d.urls.length} of {d.count}.</p>}
        </div>
      )}
    </div>
  );
}
