import { useSearchParams, useParams, Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronLeft, GitCompare, Minus } from 'lucide-react';
import { qs } from '../lib/api';
import { useApi, usePage } from '../lib/app';
import { fmtDateTime, hostOf } from '../lib/format';
import { Bar, Empty, ErrorBanner, LoadingBlock, SelectField, SevDot } from '../components/ui';
import { CATEGORY_LABELS, type Category } from '@shared/options';
import type { Severity, SiteRow } from '@shared/types';
import '../styles/report.css';

interface Side { id: number; date: string | null; issuePct: number; priorityPct: number; score: number | null; pages: number }
interface RuleDelta { ruleId: string; title: string; category: Category; severity: Severity; pagesBefore: number; pagesAfter: number }
interface CompareResponse {
  scans: { id: number; date: string | null }[];
  comparison: {
    a: Side;
    b: Side;
    categories: { category: Category; label: string; before: number; after: number; issuesBefore: number; issuesAfter: number }[];
    fixed: RuleDelta[];
    introduced: RuleDelta[];
    changed: RuleDelta[];
  } | null;
}

export function ComparePage() {
  const { id } = useParams();
  const siteId = Number(id);
  const [params, setParams] = useSearchParams();
  const a = params.get('a');
  const b = params.get('b');
  const site = useApi<SiteRow>(`/sites/${siteId}`);
  const { data, error, loading, reload } = useApi<CompareResponse>(`/sites/${siteId}/compare${qs({ a, b })}`);
  usePage(site.data ? `Compare: ${hostOf(site.data.url)}` : 'Compare scans');

  const pick = (key: 'a' | 'b', value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === 'b' && !next.get('a') && data?.comparison) next.set('a', String(data.comparison.a.id));
    if (key === 'a' && !next.get('b') && data?.comparison) next.set('b', String(data.comparison.b.id));
    setParams(next, { replace: true });
  };

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <LoadingBlock rows={8} />;
  if (!data) return null;

  const back = (
    <Link to={`/sites/${siteId}`} className="row small" style={{ gap: 4, textDecoration: 'none', fontWeight: 500 }}>
      <ChevronLeft size={16} aria-hidden="true" /> Scan history
    </Link>
  );

  if (!data.comparison) {
    return (
      <div className="stack-lg">
        {back}
        <div className="card">
          <Empty icon={<GitCompare size={36} aria-hidden="true" />} title="Two finished scans needed">
            Run another scan of this site to compare before and after.
          </Empty>
        </div>
      </div>
    );
  }
  const c = data.comparison;
  const scanOptions = data.scans.map((s) => ({ value: String(s.id), label: `${fmtDateTime(s.date)} (#${s.id})` }));

  return (
    <div className="stack-lg">
      {back}
      <section className="card" aria-labelledby="cmp-pick">
        <div className="card__head">
          <h2 id="cmp-pick">Compare two scans</h2>
          <span className="muted small">Before is always the older scan.</span>
        </div>
        <div className="card__body cmp-pickers">
          <SelectField label="Before (scan A)" value={String(c.a.id)} onChange={(e) => pick('a', e.target.value)} options={scanOptions} />
          <ArrowRight size={20} aria-hidden="true" className="cmp-arrow" />
          <SelectField label="After (scan B)" value={String(c.b.id)} onChange={(e) => pick('b', e.target.value)} options={scanOptions} />
        </div>
      </section>

      <div className="cmp-kpis">
        <Kpi label="Pages with issues" before={c.a.issuePct} after={c.b.issuePct} unit="%" lowerIsBetter />
        <Kpi label="Pages with priority issues" before={c.a.priorityPct} after={c.b.priorityPct} unit="%" lowerIsBetter />
        <Kpi label="ADA / WCAG score" before={c.a.score ?? 0} after={c.b.score ?? 0} />
        <Kpi label="Pages checked" before={c.a.pages} after={c.b.pages} neutral />
      </div>

      <section className="card" aria-labelledby="cmp-cats">
        <div className="card__head">
          <h2 id="cmp-cats">By category</h2>
          <span className="muted small">% of pages with issues</span>
        </div>
        <div className="card__body stack">
          {c.categories.map((cat) => (
            <div key={cat.category} className="cmp-cat">
              <strong className="small">{CATEGORY_LABELS[cat.category]}</strong>
              <div className="cmp-cat__bars">
                <span className="xsmall muted">Before</span>
                <Bar value={cat.before} tone="warn" label={`${cat.label} before: ${cat.before}%`} />
                <span className="xsmall num">{Math.round(cat.before)}%</span>
                <span className="xsmall muted">After</span>
                <Bar value={cat.after} label={`${cat.label} after: ${cat.after}%`} tone={cat.after < cat.before ? 'success' : cat.after > cat.before ? 'danger' : 'progress'} />
                <span className="xsmall num">{Math.round(cat.after)}%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid-3">
        <DeltaList title="Fixed" tone="success" items={c.fixed} empty="No issue types were fully fixed." reportId={c.a.id} />
        <DeltaList title="New" tone="danger" items={c.introduced} empty="No new issue types appeared." reportId={c.b.id} />
        <DeltaList title="Changed" tone="neutral" items={c.changed} empty="No issue types in both scans." reportId={c.b.id} />
      </div>
    </div>
  );
}

function Kpi({ label, before, after, unit = '', lowerIsBetter = false, neutral = false }: { label: string; before: number; after: number; unit?: string; lowerIsBetter?: boolean; neutral?: boolean }) {
  const delta = Math.round((after - before) * 10) / 10;
  const good = neutral || delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const color = good === null ? 'var(--text-3)' : good ? 'var(--success)' : 'var(--danger)';
  return (
    <section className="card card__body kpi" aria-label={label}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">
        {Math.round(after * 10) / 10}
        {unit}
      </span>
      <span className="row small" style={{ gap: 4, color, fontWeight: 600 }}>
        <Icon size={16} aria-hidden="true" />
        {delta > 0 ? '+' : ''}
        {delta}
        {unit === '%' ? ' pts' : unit}
        <span className="muted" style={{ fontWeight: 400 }}>
          {' '}from {Math.round(before * 10) / 10}
          {unit}
        </span>
        {good !== null && <span className="sr-only">{good ? '(improved)' : '(worse)'}</span>}
      </span>
    </section>
  );
}

function DeltaList({ title, tone, items, empty, reportId }: { title: string; tone: 'success' | 'danger' | 'neutral'; items: RuleDelta[]; empty: string; reportId: number }) {
  const id = `delta-${title.toLowerCase()}`;
  return (
    <section className="card card--flush" aria-labelledby={id}>
      <div className="card__head">
        <h2 id={id} style={{ fontSize: '1rem' }}>
          {title}
        </h2>
        <span className={`badge badge--${tone === 'neutral' ? 'neutral' : tone}`}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted small" style={{ padding: 20 }}>{empty}</p>
      ) : (
        <ul role="list" className="delta-list">
          {items.slice(0, 60).map((r) => (
            <li key={r.ruleId}>
              <SevDot severity={r.severity} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link to={`/scans/${reportId}/report/issues/${r.category}`} className="small" style={{ fontWeight: 600 }}>
                  {r.title}
                </Link>
                <div className="xsmall muted">
                  {CATEGORY_LABELS[r.category]} · {r.pagesBefore} → {r.pagesAfter} pages
                </div>
              </div>
            </li>
          ))}
          {items.length > 60 && <li className="xsmall muted">+ {items.length - 60} more</li>}
        </ul>
      )}
    </section>
  );
}
