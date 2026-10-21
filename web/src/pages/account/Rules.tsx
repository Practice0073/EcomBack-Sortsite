import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ExternalLink, Search } from 'lucide-react';
import { qs } from '../../lib/api';
import { useApi, usePage } from '../../lib/app';
import { fmtMinutes } from '../../lib/format';
import { Empty, ErrorBanner, GuidelineChip, LoadingBlock, SelectField, SevDot } from '../../components/ui';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@shared/options';
import { SEVERITY_LABELS, type GuidelineRef, type Severity } from '@shared/types';
import './shared';

interface RuleRow { id: string; title: string; category: Category; severity: Severity; section: string; version: string }
interface RuleDetail extends RuleRow { description: string; fix: string; guidelines: GuidelineRef[]; effortMinutes: number; helpUrl: string | null }

export function RulesPage() {
  usePage('Rule Library');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const [search, setSearch] = useState(q);
  const { data, error, loading, reload } = useApi<RuleRow[]>(`/rules${qs({ q, category })}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams(params);
    if (search.trim()) p.set('q', search.trim());
    else p.delete('q');
    setParams(p, { replace: true });
  };

  return (
    <div className="stack-lg">
      <p className="muted">Every check SortSite Tools runs, with what it means and how to fix it. Thousands of generated browser-compatibility rules appear only when you search (for example “safari” or “text-wrap”).</p>
      <form className="card card__body filters" onSubmit={submit} role="search" aria-label="Search rules">
        <div style={{ gridColumn: 'span 2' }}>
          <label htmlFor="rule-q" className="field__label" style={{ display: 'block', marginBottom: 6 }}>
            Search rules
          </label>
          <input id="rule-q" className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. contrast, alt text, canonical" />
        </div>
        <SelectField
          label="Category"
          value={category}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value) p.set('category', e.target.value);
            else p.delete('category');
            setParams(p, { replace: true });
          }}
          options={[{ value: '', label: 'All categories' }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
        />
        <div>
          <button type="submit" className="btn btn--primary">
            <Search size={15} aria-hidden="true" />
            Search
          </button>
        </div>
      </form>

      <section className="card card--flush" aria-label="Rules">
        {loading && !data ? (
          <div className="card__body"><LoadingBlock rows={6} /></div>
        ) : error ? (
          <div className="card__body"><ErrorBanner message={error} onRetry={() => void reload()} /></div>
        ) : !data?.length ? (
          <Empty icon={<BookOpen size={36} aria-hidden="true" />} title="No rules match">Try a different word or category.</Empty>
        ) : (
          <>
            <p className="small muted" role="status" style={{ padding: '12px 16px 0' }}>
              {data.length === 500 ? 'Showing the first 500 matches — refine your search to see more.' : `${data.length.toLocaleString()} rule${data.length === 1 ? '' : 's'}`}
            </p>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Rules</caption>
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Category</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Section</th>
                    <th scope="col">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id}>
                      <td style={{ minWidth: 280 }}>
                        <Link to={`/rules/${encodeURIComponent(r.id)}`} style={{ fontWeight: 600 }}>
                          {r.title}
                        </Link>
                        <div className="xsmall muted"><code>{r.id}</code></div>
                      </td>
                      <td>{CATEGORY_LABELS[r.category]}</td>
                      <td>
                        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <SevDot severity={r.severity} />
                          {SEVERITY_LABELS[r.severity]}
                        </span>
                      </td>
                      <td>{r.section}</td>
                      <td>{r.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function RuleDetailPage() {
  const { id = '' } = useParams();
  const ruleId = decodeURIComponent(id);
  const { data, error, loading, reload } = useApi<RuleDetail>(`/rules/${encodeURIComponent(ruleId)}`);
  usePage(data?.title ?? 'Rule');

  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorBanner message={error ?? 'Rule not found.'} onRetry={() => void reload()} />;

  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <Link to="/rules" className="row small" style={{ gap: 6, fontWeight: 600 }}>
        <ArrowLeft size={15} aria-hidden="true" />
        Rule Library
      </Link>
      <article className="card" aria-labelledby="rule-title">
        <div className="card__head">
          <div>
            <h2 id="rule-title" style={{ fontSize: '1.3rem' }}>{data.title}</h2>
            <code className="xsmall muted">{data.id}</code>
          </div>
          <span className="row" style={{ gap: 6 }}>
            <SevDot severity={data.severity} />
            <strong>{SEVERITY_LABELS[data.severity]}</strong>
          </span>
        </div>
        <div className="card__body stack-lg">
          <dl className="dl">
            <dt>Category</dt>
            <dd>{CATEGORY_LABELS[data.category]}</dd>
            <dt>Section</dt>
            <dd>{data.section}</dd>
            <dt>Typical effort</dt>
            <dd>{data.effortMinutes ? `About ${fmtMinutes(data.effortMinutes)} per occurrence` : '—'}</dd>
            <dt>Rule version</dt>
            <dd>{data.version}</dd>
          </dl>
          <section>
            <h3>What it means</h3>
            <p className="prose-block" style={{ marginTop: 6 }}>{data.description}</p>
          </section>
          <section>
            <h3>How to fix it</h3>
            <p className="prose-block" style={{ marginTop: 6 }}>{data.fix}</p>
          </section>
          {!!data.guidelines.length && (
            <section>
              <h3>Guidelines</h3>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                {data.guidelines.map((g) => (
                  <GuidelineChip key={`${g.label}${g.url ?? ''}`} label={g.label} url={g.url} />
                ))}
              </div>
            </section>
          )}
          {data.helpUrl && (
            <a href={data.helpUrl} target="_blank" rel="noreferrer noopener" className="btn" style={{ alignSelf: 'flex-start' }}>
              <ExternalLink size={15} aria-hidden="true" />
              More guidance
              <span className="sr-only">(opens in new tab)</span>
            </a>
          )}
        </div>
      </article>
    </div>
  );
}
