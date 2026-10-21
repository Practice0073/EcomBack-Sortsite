import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, Download, FileCode2, Layers, Loader2, Map as MapIcon, Network, Play, Plus, Search, Settings2, Square, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '../lib/api';
import { TopbarActions, useApi, useAuth, useLiveEvents, usePage, useToast } from '../lib/app';
import { fmtBytes, fmtDate, fmtDateTime, fmtPct, fmtRelative, hostOf, pathOf } from '../lib/format';
import { Bar, Checkbox, ConfirmModal, Empty, ErrorBanner, LoadingBlock, Modal, RadioGroup, SelectField, SortHeader, StatusBadge, TextArea, TextField, Thumb } from '../components/ui';
import { previewUrl } from '../components/scan';
import type { SitemapOptions } from '@shared/sitemap';
import type { ScheduleFrequency } from '@shared/options';
import '../styles/workspace.css';

interface RunDto { id: number; status: string; queuedAt: string; startedAt: string | null; finishedAt: string | null; pagesFound: number; pagesDone: number; currentUrl: string | null; diskBytes: number; error: string | null }
interface MapRow { id: number; url: string; thumbnail: string | null; schedule: ScheduleFrequency; nextRunAt: string | null; diskBytes: number; diskPct: number; lastRun: RunDto | null }
type SortKey = 'address' | 'date' | 'disk';
const active = (r: RunDto | null | undefined) => r?.status === 'running' || r?.status === 'queued';

// ── Shared buttons ────────────────────────────────────────────────────────────
function MapNowButton({ id, onDone, small = false }: { id: number; onDone?: () => void; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const { can } = useAuth();
  if (!can('sitemap.run')) return null;
  return (
    <button
      type="button"
      className={`btn ${small ? 'btn--sm' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/sitemaps/${id}/run`);
          push({ kind: 'success', title: 'Map started' });
          onDone?.();
        } catch (e) {
          push({ kind: 'error', title: 'Could not start the map', body: (e as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
      Map Now
    </button>
  );
}

function StopMapButton({ id, onDone, small = false }: { id: number; onDone?: () => void; small?: boolean }) {
  const { push } = useToast();
  const { can } = useAuth();
  if (!can('sitemap.run')) return null;
  return (
    <button
      type="button"
      className={`btn btn--danger ${small ? 'btn--sm' : ''}`}
      onClick={async () => {
        try {
          await api.post(`/sitemaps/${id}/stop`);
          push({ kind: 'info', title: 'Stopping map' });
          onDone?.();
        } catch (e) {
          push({ kind: 'error', title: 'Could not stop the map', body: (e as Error).message });
        }
      }}
    >
      <Square size={13} fill="currentColor" aria-hidden="true" />
      Stop
    </button>
  );
}

function MapProgress({ run }: { run: RunDto }) {
  const pct = run.pagesFound ? Math.min(99, Math.round((run.pagesDone / run.pagesFound) * 100)) : 0;
  return (
    <div className="live" aria-live="polite">
      <span className={`badge ${run.status === 'queued' ? 'badge--info' : 'badge--success badge--live'}`}>{run.status === 'queued' ? 'Queued' : 'Mapping'}</span>
      <Bar value={pct} tone="progress" label="Map progress" />
      <span className="live__meta">
        {run.pagesFound.toLocaleString()} pages found, {run.pagesDone.toLocaleString()} done
      </span>
      {run.currentUrl && <span className="live__url">{run.currentUrl}</span>}
    </div>
  );
}

// ── List ──────────────────────────────────────────────────────────────────────
export function SitemapsPage() {
  usePage('Sitemaps');
  const [params, setParams] = useSearchParams();
  const sort = (params.get('sort') as SortKey) || 'date';
  const dir = (params.get('dir') as 'asc' | 'desc') || 'desc';
  const query = params.get('q') ?? '';
  const [search, setSearch] = useState(query);
  const [showNew, setShowNew] = useState(false);
  const { can } = useAuth();
  const { data, error, loading, reload, setData } = useApi<MapRow[]>(`/sitemaps${qs({ sort, dir, q: query })}`);

  useLiveEvents((e) => {
    if (e.type !== 'sitemap.progress') return;
    if (e.status === 'running') {
      setData((d) => d && d.map((m) => (m.id === e.sitemapId && m.lastRun ? { ...m, lastRun: { ...m.lastRun, status: 'running', pagesFound: e.pagesFound, pagesDone: e.pagesDone, currentUrl: e.currentUrl } } : m)));
    } else void reload(true);
  });

  const update = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (!v) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };
  const onSort = (k: SortKey) => update({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' });
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: search.trim() || null });
  };

  return (
    <div className="stack-lg">
      <TopbarActions>
        {can('sitemap.run') && (
          <button type="button" className="btn btn--primary" onClick={() => setShowNew(true)}>
            <Plus size={16} aria-hidden="true" />
            New Map…
          </button>
        )}
      </TopbarActions>

      <form className="row" onSubmit={onSearch} role="search">
        <label htmlFor="map-search" className="sr-only">
          Search sitemaps by address
        </label>
        <input id="map-search" className="input" type="search" placeholder="Search by address" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 380 }} />
        <button type="submit" className="btn">
          <Search size={16} aria-hidden="true" />
          Search
        </button>
        {query && (
          <button type="button" className="btn btn--ghost" onClick={() => { setSearch(''); update({ q: null }); }}>
            Clear
          </button>
        )}
      </form>

      <section className="card card--flush" aria-label="Sitemaps">
        {loading && !data ? (
          <div style={{ padding: 24 }}><LoadingBlock rows={5} /></div>
        ) : error ? (
          <div style={{ padding: 24 }}><ErrorBanner message={error} onRetry={() => void reload()} /></div>
        ) : !data?.length ? (
          <Empty
            icon={<Network size={40} aria-hidden="true" />}
            title={query ? 'No sitemaps match your search' : 'No sitemaps yet'}
            action={can('sitemap.run') && !query ? <button type="button" className="btn btn--primary" onClick={() => setShowNew(true)}><Plus size={16} aria-hidden="true" /> New Map…</button> : undefined}
          >
            {query ? `Nothing matches “${query}”.` : 'A sitemap is a fast crawl that draws your site structure as a tree and exports sitemap.xml for search engines.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Sitemaps, sortable</caption>
              <thead>
                <tr>
                  <SortHeader label="Address" sortKey="address" sort={sort} dir={dir} onSort={onSort} />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                  <SortHeader label="Date" sortKey="date" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Disk" sortKey="disk" sort={sort} dir={dir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td style={{ minWidth: 260 }}>
                      <div className="url-cell">
                        <Thumb src={m.thumbnail} />
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/sitemaps/${m.id}`}>{m.url}</Link>
                          <div className="xsmall muted" style={{ marginTop: 4 }}>
                            {m.schedule === 'none' ? 'Not scheduled' : `${m.schedule[0]!.toUpperCase()}${m.schedule.slice(1)} · next ${fmtRelative(m.nextRunAt)}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        {can('sitemap.run') && (
                          <Link to={`/sitemaps/${m.id}/options`} className="btn btn--primary btn--sm">
                            <Settings2 size={15} aria-hidden="true" />
                            Options…
                          </Link>
                        )}
                        {active(m.lastRun) ? <StopMapButton id={m.id} small onDone={() => void reload(true)} /> : <MapNowButton id={m.id} small onDone={() => void reload(true)} />}
                      </div>
                    </td>
                    <td style={{ minWidth: 200 }}>
                      {m.lastRun && active(m.lastRun) ? (
                        <MapProgress run={m.lastRun} />
                      ) : m.lastRun?.finishedAt ? (
                        <span className="row" style={{ gap: 6 }}>
                          <span title={fmtRelative(m.lastRun.finishedAt)}>{fmtDate(m.lastRun.finishedAt)}</span>
                          {m.lastRun.status !== 'completed' && <StatusBadge status={m.lastRun.status} />}
                        </span>
                      ) : (
                        <span className="muted small">Never</span>
                      )}
                    </td>
                    <td className="small">{fmtPct(m.diskPct, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showNew && <NewMapModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewMapModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { push } = useToast();
  const preview = previewUrl(url);
  const error = serverError ?? (touched ? preview.error ?? (!preview.url ? 'Enter a site address.' : null) : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!preview.url) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await api.post<{ id: number; runId: number }>('/sitemaps', { url: preview.url });
      push({ kind: 'success', title: 'Map started', body: preview.url });
      navigate(`/sitemaps/${r.id}`);
    } catch (err) {
      setServerError((err as ApiError).fieldError('url') ?? (err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="New Map" onClose={onClose}>
      <form onSubmit={submit} className="stack" noValidate>
        <p className="muted small">We crawl the site's links (no rule checks) and draw its structure. Up to 500 pages by default.</p>
        <TextField
          label="Site address"
          placeholder="https://example.com"
          value={url}
          inputMode="url"
          spellCheck={false}
          data-autofocus="true"
          onChange={(e) => { setUrl(e.target.value); setServerError(null); }}
          onBlur={() => setTouched(true)}
          error={error ?? undefined}
          hint={preview.url && preview.url !== url.trim() ? `Will map ${preview.url}` : 'We add https:// for you if you leave it out.'}
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <MapIcon size={16} aria-hidden="true" />}
            Map
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Result ────────────────────────────────────────────────────────────────────
interface Detail { id: number; url: string; thumbnail: string | null; options: SitemapOptions; nextRunAt: string | null; runs: RunDto[] }
interface NodeDto { url: string; parentUrl: string | null; title: string | null; status: number | null; depth: number; contentType: string | null }
interface Result { run: RunDto; url: string; nodes: NodeDto[]; byDepth: { depth: number; count: number }[]; errors: number }

export function SitemapResultPage() {
  const { id } = useParams();
  const mapId = Number(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const { push } = useToast();
  const [runId, setRunId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const detail = useApi<Detail>(`/sitemaps/${mapId}`);
  const latest = detail.data?.runs[0];
  const viewRun = runId ?? detail.data?.runs.find((r) => r.status === 'completed' || r.status === 'stopped')?.id ?? null;
  const result = useApi<Result>(viewRun ? `/sitemaps/${mapId}/result?run=${viewRun}` : null);
  const [live, setLive] = useState<RunDto | null>(null);
  usePage(detail.data ? `Sitemap · ${hostOf(detail.data.url)}` : 'Sitemap');

  useLiveEvents((e) => {
    if (e.type !== 'sitemap.progress' || e.sitemapId !== mapId) return;
    if (e.status === 'running' && latest) setLive({ ...latest, status: 'running', pagesFound: e.pagesFound, pagesDone: e.pagesDone, currentUrl: e.currentUrl });
    else {
      setLive(null);
      setRunId(null);
      void detail.reload(true);
    }
  });

  if (detail.error) return <ErrorBanner message={detail.error} onRetry={() => void detail.reload()} />;
  if (!detail.data) return <LoadingBlock rows={8} />;
  const d = detail.data;
  const host = hostOf(d.url);
  const running = live ?? (active(latest) ? latest! : null);

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del(`/sitemaps/${mapId}`);
      push({ kind: 'success', title: `Deleted sitemap of ${host}` });
      navigate('/sitemaps');
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleting(false);
    }
  };

  const finishedRuns = d.runs.filter((r) => r.status === 'completed' || r.status === 'stopped');

  return (
    <div className="stack-lg">
      <TopbarActions>
        {can('sitemap.run') && (
          <Link to={`/sitemaps/${mapId}/options`} className="btn btn--primary">
            <Settings2 size={15} aria-hidden="true" />
            Options…
          </Link>
        )}
        {running ? <StopMapButton id={mapId} onDone={() => void detail.reload(true)} /> : <MapNowButton id={mapId} onDone={() => void detail.reload(true)} />}
      </TopbarActions>

      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href={d.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600, fontSize: '1.1rem', wordBreak: 'break-all' }}>
            {d.url}
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          <p>Next map: {d.nextRunAt ? fmtDateTime(d.nextRunAt) : 'Not scheduled'}</p>
        </div>
        <div className="row">
          {finishedRuns.length > 1 && (
            <div style={{ width: 240 }}>
              <SelectField label="Map run" labelHidden value={String(viewRun ?? '')} onChange={(e) => setRunId(Number(e.target.value))} options={finishedRuns.map((r) => ({ value: String(r.id), label: `${fmtDateTime(r.finishedAt)} · ${r.pagesDone} pages` }))} />
            </div>
          )}
          {can('sitemap.run') && (
            <button type="button" className="btn btn--ghost" disabled={!!running} onClick={() => { setDeleteError(null); setConfirmDelete(true); }}>
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </button>
          )}
        </div>
      </div>

      {running && (
        <section className="card" aria-label="Map in progress">
          <div className="card__body">
            <MapProgress run={running} />
          </div>
        </section>
      )}
      {latest?.status === 'failed' && (
        <div className="banner banner--danger" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>The last map failed: {latest.error ?? 'unknown error'}</div>
        </div>
      )}

      {!viewRun ? (
        !running && (
          <section className="card">
            <Empty icon={<Network size={40} aria-hidden="true" />} title="This map has not been built yet" action={<MapNowButton id={mapId} onDone={() => void detail.reload(true)} />}>
              Run the map to see the site structure.
            </Empty>
          </section>
        )
      ) : result.error ? (
        <ErrorBanner message={result.error} onRetry={() => void result.reload()} />
      ) : !result.data ? (
        <LoadingBlock rows={6} />
      ) : (
        <MapResult mapId={mapId} r={result.data} />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete the sitemap of ${host}?`}
          message={<p>All map runs for this site are deleted permanently. This frees disk quota and cannot be undone.</p>}
          confirmWord={host}
          confirmLabel="Delete permanently"
          busy={deleting}
          error={deleteError}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

interface TreeNode extends NodeDto { children: TreeNode[]; total: number }

function buildTree(nodes: NodeDto[]): TreeNode[] {
  const byUrl = new Map<string, TreeNode>();
  for (const n of nodes) byUrl.set(n.url, { ...n, children: [], total: 0 });
  const roots: TreeNode[] = [];
  for (const n of byUrl.values()) {
    const parent = n.parentUrl ? byUrl.get(n.parentUrl) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  const count = (n: TreeNode): number => (n.total = n.children.reduce((s, c) => s + 1 + count(c), 0));
  const sortRec = (list: TreeNode[]) => {
    list.sort((a, b) => a.url.localeCompare(b.url));
    for (const n of list) sortRec(n.children);
  };
  roots.forEach(count);
  sortRec(roots);
  return roots;
}

function MapResult({ mapId, r }: { mapId: number; r: Result }) {
  const [filter, setFilter] = useState('');
  const tree = useMemo(() => buildTree(r.nodes), [r.nodes]);
  const maxDepth = r.byDepth.reduce((m, x) => Math.max(m, x.depth), 0);
  const maxCount = r.byDepth.reduce((m, x) => Math.max(m, x.count), 1);
  return (
    <>
      <div className="kpis">
        <Kpi icon={<FileCode2 size={18} />} value={r.nodes.length.toLocaleString()} label="Pages mapped" />
        <Kpi icon={<Layers size={18} />} value={String(maxDepth)} label="Deepest click depth" />
        <Kpi icon={<AlertTriangle size={18} />} value={r.errors.toLocaleString()} label="Pages with errors" alert={r.errors > 0} />
        <Kpi icon={<Network size={18} />} value={fmtBytes(r.run.diskBytes)} label={`Mapped ${fmtRelative(r.run.finishedAt)}`} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
        <section className="card" aria-labelledby="tree-title">
          <div className="card__head">
            <h2 id="tree-title">Site structure</h2>
            <div className="row">
              <label htmlFor="tree-filter" className="sr-only">
                Filter pages
              </label>
              <input id="tree-filter" className="input" type="search" placeholder="Filter by address or title" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 240, minHeight: 36 }} />
            </div>
          </div>
          <div className="card__body" style={{ overflowX: 'auto' }}>
            <SiteTree roots={tree} filter={filter.trim().toLowerCase()} />
          </div>
        </section>
        <div className="stack-lg">
          <section className="card" aria-labelledby="depth-title">
            <div className="card__head">
              <h2 id="depth-title">Depth chart</h2>
            </div>
            <div className="card__body">
              <ol className="depth-chart" aria-label="Pages by click depth from the start page">
                {r.byDepth.map((x) => (
                  <li key={x.depth}>
                    <span>{x.depth === 0 ? 'Start' : `${x.depth} click${x.depth === 1 ? '' : 's'}`}</span>
                    <span className="depth-chart__bar" style={{ width: `${Math.max(2, (x.count / maxCount) * 100)}%` }} aria-hidden="true" />
                    <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {x.count.toLocaleString()}
                      <span className="sr-only"> pages</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="note" style={{ marginTop: 14 }}>Important pages should be no more than 3 clicks from the home page.</p>
            </div>
          </section>
          <section className="card" aria-labelledby="dl-title">
            <div className="card__head">
              <h2 id="dl-title">Downloads</h2>
            </div>
            <div className="card__body stack">
              <a className="btn btn--success" href={`/api/v1/sitemaps/${mapId}/sitemap.xml?run=${r.run.id}`} download>
                <Download size={16} aria-hidden="true" />
                sitemap.xml
              </a>
              <a className="btn" href={`/api/v1/sitemaps/${mapId}/sitemap.csv?run=${r.run.id}`} download>
                <Download size={16} aria-hidden="true" />
                Page list (CSV)
              </a>
              <p className="note">The XML sitemap lists every page that returned status 200 and follows the sitemaps.org protocol.</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Kpi({ icon, value, label, alert = false }: { icon: ReactNode; value: string; label: string; alert?: boolean }) {
  return (
    <div className={`kpi-tile ${alert ? 'kpi-tile--alert' : ''}`}>
      <span className="kpi-tile__icon" aria-hidden="true">{icon}</span>
      <span className="kpi__value">{value}</span>
      <span className="kpi__label">{label}</span>
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** ARIA tree (role=tree/treeitem) with roving focus: ↑↓ move, → expand/enter, ← collapse/parent, Home/End, Enter opens the page. */
function SiteTree({ roots, filter }: { roots: TreeNode[]; filter: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(roots.flatMap((r) => [r.url])));
  const [focusUrl, setFocusUrl] = useState<string | null>(roots[0]?.url ?? null);
  const refs = useRef(new Map<string, HTMLLIElement>());

  const matches = useCallback((n: TreeNode) => `${pathOf(n.url)} ${n.title ?? ''}`.toLowerCase().includes(filter), [filter]);
  // When filtering, keep nodes that match or have matching descendants, and show them expanded.
  const visibleSet = useMemo(() => {
    if (!filter) return null;
    const keep = new Set<string>();
    const walk = (n: TreeNode): boolean => {
      let any = matches(n);
      for (const c of n.children) if (walk(c)) any = true;
      if (any) keep.add(n.url);
      return any;
    };
    roots.forEach(walk);
    return keep;
  }, [filter, roots, matches]);

  const isOpen = (n: TreeNode) => (visibleSet ? true : expanded.has(n.url));
  const flat = useMemo(() => {
    const out: { node: TreeNode; parent: TreeNode | null }[] = [];
    const walk = (list: TreeNode[], parent: TreeNode | null) => {
      for (const n of list) {
        if (visibleSet && !visibleSet.has(n.url)) continue;
        out.push({ node: n, parent });
        if (n.children.length && isOpen(n)) walk(n.children, n);
      }
    };
    walk(roots, null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, expanded, visibleSet]);

  useEffect(() => {
    if (focusUrl && !flat.some((f) => f.node.url === focusUrl)) setFocusUrl(flat[0]?.node.url ?? null);
  }, [flat, focusUrl]);

  const move = (url: string | undefined) => {
    if (!url) return;
    setFocusUrl(url);
    refs.current.get(url)?.focus();
  };
  const toggle = (url: string, open?: boolean) =>
    setExpanded((cur) => {
      const n = new Set(cur);
      if (open ?? !n.has(url)) n.add(url);
      else n.delete(url);
      return n;
    });

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = flat.findIndex((f) => f.node.url === focusUrl);
    const cur = flat[i];
    if (!cur) return;
    const n = cur.node;
    switch (e.key) {
      case 'ArrowDown':
        move(flat[i + 1]?.node.url);
        break;
      case 'ArrowUp':
        move(flat[i - 1]?.node.url);
        break;
      case 'Home':
        move(flat[0]?.node.url);
        break;
      case 'End':
        move(flat[flat.length - 1]?.node.url);
        break;
      case 'ArrowRight':
        if (n.children.length && !isOpen(n)) toggle(n.url, true);
        else if (n.children.length) move(flat[i + 1]?.node.url);
        break;
      case 'ArrowLeft':
        if (n.children.length && isOpen(n) && !visibleSet) toggle(n.url, false);
        else move(cur.parent?.url);
        break;
      case 'Enter':
        window.open(n.url, '_blank', 'noopener');
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (!flat.length) return <p className="muted">No pages match “{filter}”.</p>;

  const render = (list: TreeNode[], level: number): ReactNode =>
    list
      .filter((n) => !visibleSet || visibleSet.has(n.url))
      .map((n, idx, arr) => {
        const open = isOpen(n);
        const error = n.status === null || n.status >= 400;
        return (
          <li
            key={n.url}
            role="treeitem"
            className="tree__item"
            aria-level={level}
            aria-setsize={arr.length}
            aria-posinset={idx + 1}
            aria-expanded={n.children.length ? open : undefined}
            aria-selected={focusUrl === n.url}
            tabIndex={focusUrl === n.url ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(n.url, el);
              else refs.current.delete(n.url);
            }}
            onFocus={(e) => e.target === e.currentTarget && setFocusUrl(n.url)}
          >
            <div
              className="tree__row"
              onClick={() => {
                setFocusUrl(n.url);
                if (n.children.length) toggle(n.url);
              }}
            >
              <span className="tree__toggle" aria-hidden="true">
                {n.children.length ? open ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : null}
              </span>
              <span className="tree__path" title={n.url}>
                <Highlight text={pathOf(n.url)} q={filter} />
              </span>
              <span className="tree__title">{n.title ? <Highlight text={n.title} q={filter} /> : <em>No title</em>}</span>
              {error ? <span className="badge badge--danger">{n.status ?? 'Error'}</span> : n.status !== 200 ? <span className="badge badge--neutral">{n.status}</span> : null}
              {n.total > 0 && <span className="count" title={`${n.total} pages below`}>{n.total.toLocaleString()}<span className="sr-only"> pages below</span></span>}
            </div>
            {n.children.length > 0 && open && (
              <ul role="group">{render(n.children, level + 1)}</ul>
            )}
          </li>
        );
      });

  return (
    <>
      <p className="note" id="tree-help" style={{ marginBottom: 10 }}>
        Use the arrow keys to move through the tree; press Enter to open a page in a new tab.
      </p>
      <ul className="tree" role="tree" aria-label="Site structure by click depth" aria-describedby="tree-help" onKeyDown={onKey}>
        {render(roots, 1)}
      </ul>
    </>
  );
}

// ── Options ───────────────────────────────────────────────────────────────────
export function SitemapOptionsPage() {
  const { id } = useParams();
  const mapId = Number(id);
  const navigate = useNavigate();
  const { me } = useAuth();
  const { push } = useToast();
  const detail = useApi<Detail>(`/sitemaps/${mapId}`);
  const [o, setO] = useState<SitemapOptions | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  usePage(detail.data ? `Map Options · ${hostOf(detail.data.url)}` : 'Map Options');
  useEffect(() => {
    if (detail.data && !o) setO(detail.data.options);
  }, [detail.data, o]);

  if (detail.error) return <ErrorBanner message={detail.error} onRetry={() => void detail.reload()} />;
  if (!o) return <LoadingBlock rows={6} />;
  const set = <K extends keyof SitemapOptions>(k: K, v: SitemapOptions[K]) => setO((cur) => (cur ? { ...cur, [k]: v } : cur));
  const setSchedule = (patch: Partial<SitemapOptions['schedule']>) => setO((cur) => (cur ? { ...cur, schedule: { ...cur.schedule, ...patch } } : cur));
  const num = (v: string) => (v === '' ? Number.NaN : Number(v));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.put(`/sitemaps/${mapId}/options`, { options: o });
      push({ kind: 'success', title: 'Map options saved' });
      navigate(`/sitemaps/${mapId}`);
    } catch (err) {
      const ae = err as ApiError;
      const map: Record<string, string> = {};
      for (const f of ae.fields) map[f.path] = f.message;
      setErrors(map);
      setFormError(ae.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack-lg" onSubmit={save} noValidate>
      {formError && (
        <div className="banner banner--danger" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>{formError}</div>
        </div>
      )}
      <section className="card" aria-labelledby="mo-crawl">
        <div className="card__head">
          <h2 id="mo-crawl">Crawl</h2>
        </div>
        <div className="card__body stack">
          <RadioGroup<'site' | 'folder'> legend="Scope" name="mscope" value={o.scope} onChange={(v) => set('scope', v)} options={[{ value: 'site', label: 'Entire site' }, { value: 'folder', label: 'Folder', hint: 'Only pages in the start page folder and below.' }]} />
          <div className="editor__group">
            <TextField label="Maximum pages" type="number" min={1} max={5000} value={Number.isFinite(o.maxPages) ? o.maxPages : ''} error={errors.maxPages} onChange={(e) => set('maxPages', num(e.target.value))} />
            <div />
          </div>
          <fieldset className="fieldset">
            <legend>Link depth</legend>
            <div className="stack" style={{ gap: 10 }}>
              <label className="radio">
                <input type="radio" name="mdepth" checked={o.depthMode === 'entire'} onChange={() => set('depthMode', 'entire')} />
                <span>Explore the entire site</span>
              </label>
              <div className="row" style={{ gap: 10 }}>
                <label className="radio">
                  <input type="radio" name="mdepth" checked={o.depthMode === 'limited'} onChange={() => set('depthMode', 'limited')} />
                  <span>Only pages up to</span>
                </label>
                <span className="inline-num">
                  <label htmlFor="mo-maxdepth" className="sr-only">Maximum clicks from the start page</label>
                  <input id="mo-maxdepth" className="input" type="number" min={1} max={50} disabled={o.depthMode !== 'limited'} value={Number.isFinite(o.maxDepth) ? o.maxDepth : ''} aria-invalid={!!errors.maxDepth} aria-describedby={errors.maxDepth ? 'mo-maxdepth-e' : undefined} onChange={(e) => set('maxDepth', num(e.target.value))} />
                  <span className="small">clicks from the start page</span>
                </span>
              </div>
              {errors.maxDepth && <p id="mo-maxdepth-e" className="field__error">{errors.maxDepth}</p>}
            </div>
          </fieldset>
          <TextArea label="Blocked links" rows={5} value={o.blocks} onChange={(e) => set('blocks', e.target.value)} placeholder={'*.pdf\n/private/*'} hint="One pattern per line; * is a wildcard." error={errors.blocks} />
          <Checkbox label="Obey robots.txt" checked={o.obeyRobots} onChange={(v) => set('obeyRobots', v)} />
        </div>
      </section>
      <section className="card" aria-labelledby="mo-sched">
        <div className="card__head">
          <h2 id="mo-sched">Schedule</h2>
        </div>
        <div className="card__body editor__group">
          <SelectField
            label="When to map"
            value={o.schedule.frequency}
            onChange={(e) => setSchedule({ frequency: e.target.value as ScheduleFrequency })}
            options={[
              { value: 'none', label: 'Not scheduled' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
          <div />
          <TextField label="Start date" type="date" disabled={o.schedule.frequency === 'none'} value={o.schedule.startDate} onChange={(e) => setSchedule({ startDate: e.target.value })} hint="Leave empty to start from today." />
          <TextField label="Time" type="time" disabled={o.schedule.frequency === 'none'} value={o.schedule.time} onChange={(e) => setSchedule({ time: e.target.value })} hint={`Your timezone: ${me?.timezone ?? 'UTC'}`} />
        </div>
      </section>
      <div className="editor__foot">
        <button type="submit" className="btn btn--success" disabled={saving}>
          {saving && <Loader2 size={16} className="spin" aria-hidden="true" />}
          Save
        </button>
        <Link to={`/sitemaps/${mapId}`} className="btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
