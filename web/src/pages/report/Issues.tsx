import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, ChevronRight, Download, ExternalLink, Layers, SearchX } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApi } from '../../lib/app';
import { hostOf, pathOf } from '../../lib/format';
import { BarRow, Empty, ErrorBanner, Gauge, GuidelineChip, HelpTip, LoadingBlock, SelectField, SevDot, Spinner, TextField } from '../../components/ui';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@shared/options';
import type { IssueGroup, Severity } from '@shared/types';
import { BenchmarkBadge } from './Overview';
import { csvCell, downloadText, ruleHref, useReport, type IssuesResponse, type OccurrencesResponse } from './context';

const EXPLAIN: Record<Category, string> = {
  accessibility:
    'Accessibility issues stop people with disabilities from using the site with screen readers, keyboards, magnifiers or voice control. Automated testing cannot catch every problem — some checks need a person, so also test with a keyboard and a screen reader.',
  compatibility: 'Features that the current version of a selected browser does not support. Visitors on those browsers may see a different layout or missing functionality.',
  errors: 'Broken links and files, server and configuration problems, spelling and your content rules.',
  search: 'Problems that make pages harder for Google, Bing and DuckDuckGo to understand, index or show well in results.',
  standards: 'Markup and CSS that do not follow the HTML Living Standard or the W3C CSS grammar. Browsers try to recover, but results vary.',
  usability: 'Best practices that make pages easier to read and use, especially on phones.',
};

const SECTION_ORDER = ['Level A', 'Level AA', 'Level AAA', 'ARIA', 'Screen readers', 'PDF/UA', 'Reading age', 'Warnings'];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function IssuesTab() {
  const { category: raw } = useParams();
  const { scanId, summary, base } = useReport();
  const category = (CATEGORIES as readonly string[]).includes(raw ?? '') ? (raw as Category) : 'accessibility';
  const stat = summary.categories.find((c) => c.category === category);
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [guideline, setGuideline] = useState('');
  const [text, setText] = useState('');
  const dGuideline = useDebounced(guideline);
  const dText = useDebounced(text);
  const path = `/scans/${scanId}/report/issues${qs({ category, severity, guideline: dGuideline, q: dText })}`;
  const { data, error, loading, reload } = useApi<IssuesResponse>(path);
  const filtered = severity !== 'all' || !!dGuideline || !!dText;

  const sections = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, IssueGroup[]>();
    for (const g of data.groups) map.set(g.section, [...(map.get(g.section) ?? []), g]);
    const names = [...map.keys()].sort((a, b) => {
      const ia = SECTION_ORDER.indexOf(a);
      const ib = SECTION_ORDER.indexOf(b);
      return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b);
    });
    return names.map((name) => ({ name, groups: map.get(name)!, info: data.sections.find((s) => s.name === name) }));
  }, [data]);

  const exportView = () => {
    if (!data) return;
    const rows = [
      ['Section', 'Severity', 'Rule ID', 'Issue', 'Guidelines', 'Pages', 'Occurrences', 'Theme-level'].map(csvCell).join(','),
      ...data.groups.map((g) => [g.section, g.severity, g.ruleId, g.title, g.guidelines.map((x) => x.label).join('; '), g.pageCount, g.occurrenceCount, g.templateLevel ? 'yes' : 'no'].map(csvCell).join(',')),
    ];
    downloadText(`sortsite-${hostOf(summary.site.url)}-${category}-issues.csv`, `﻿${rows.join('\r\n')}`, 'text/csv');
  };

  if (!stat?.enabled) {
    return (
      <div className="card">
        <Empty title={`${CATEGORY_LABELS[category]} was not checked`}>Turn it on under Options to include it in the next scan.</Empty>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="cat-head">
        <div className="card__body overview-hero">
          <Gauge value={stat.issuePct} size={128} sub="of pages" ariaLabel={`${CATEGORY_LABELS[category]}: ${Math.round(stat.issuePct)}% of pages have issues`} />
          <div className="stack" style={{ gap: 10 }}>
            <h2 id="cat-head" style={{ fontSize: '1.35rem' }}>
              {stat.pagesWithIssues.toLocaleString()} {stat.pagesWithIssues === 1 ? 'page' : 'pages'} with {CATEGORY_LABELS[category].toLowerCase()} issues
            </h2>
            <BenchmarkBadge benchmark={summary.categoryBenchmarks[category]} />
            <p className="small" style={{ color: 'var(--text-2)', maxWidth: 760 }}>
              {EXPLAIN[category]}
            </p>
          </div>
        </div>
      </section>

      {category === 'accessibility' ? (
        <div className="grid-2">
          <section className="card" aria-labelledby="wcag-card">
            <div className="card__head">
              <h2 id="wcag-card" style={{ fontSize: '1rem' }}>
                WCAG {summary.options.rules.accessibility.wcagVersion}
              </h2>
            </div>
            <div className="card__body stack" style={{ gap: 10 }}>
              {stat.bars.filter((b) => b.label.startsWith('Level')).map((b) => (
                <BarRow key={b.label} label={b.label} pct={b.pct} help={b.help || undefined} />
              ))}
            </div>
          </section>
          <section className="card" aria-labelledby="aria-card">
            <div className="card__head">
              <h2 id="aria-card" style={{ fontSize: '1rem' }}>WAI-ARIA</h2>
            </div>
            <div className="card__body stack" style={{ gap: 10 }}>
              {data ? (
                <>
                  <BarRow label="Errors" pct={data.aria.errorsPct} help="Pages where ARIA roles, states or properties are used incorrectly, so assistive technology gets wrong information." />
                  <BarRow label="Warnings" pct={data.aria.warningsPct} tone="warn" help="ARIA usage that needs manual review." />
                </>
              ) : (
                <Spinner />
              )}
            </div>
          </section>
        </div>
      ) : (
        stat.bars.length > 0 && (
          <section className="card" aria-labelledby="bars-card">
            <div className="card__head">
              <h2 id="bars-card" style={{ fontSize: '1rem' }}>{CATEGORY_LABELS[category]} by guideline</h2>
            </div>
            <div className="card__body report-bars">
              {stat.bars.map((b) => (
                <BarRow key={b.label} label={b.label} pct={b.pct} help={b.help || undefined} />
              ))}
            </div>
          </section>
        )
      )}

      <section className="card card--flush" aria-labelledby="issue-list">
        <div className="card__head">
          <h2 id="issue-list">Issues</h2>
          <button type="button" className="btn btn--sm" onClick={exportView} disabled={!data?.groups.length}>
            <Download size={14} aria-hidden="true" />
            Export this view
          </button>
        </div>
        <div className="issue-filters" role="search" aria-label="Filter issues">
          <SelectField
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity | 'all')}
            options={[
              { value: 'all', label: 'All severities' },
              { value: 'priority', label: 'Priority' },
              { value: 'other', label: 'Other' },
              { value: 'warning', label: 'Warnings' },
            ]}
          />
          <TextField label="Guideline" placeholder="e.g. 1.4.3, ARIA, Section 508" value={guideline} onChange={(e) => setGuideline(e.target.value)} />
          <TextField label="Search issues" type="search" placeholder="Words in the issue title" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {error ? (
          <div style={{ padding: 24 }}><ErrorBanner message={error} onRetry={() => void reload()} /></div>
        ) : loading && !data ? (
          <div style={{ padding: 24 }}><LoadingBlock rows={6} /></div>
        ) : !data?.groups.length ? (
          <Empty icon={<SearchX size={36} aria-hidden="true" />} title={filtered ? 'No issues match these filters' : 'No issues found'}>
            {filtered ? 'Clear the filters to see every issue.' : `No ${CATEGORY_LABELS[category].toLowerCase()} issues were found on the checked pages.`}
          </Empty>
        ) : (
          <div aria-live="polite" aria-busy={loading}>
            {sections.map((sec) => (
              <section key={sec.name} className="issue-section" aria-labelledby={`sec-${slug(sec.name)}`}>
                <div className="issue-section__head">
                  <h3 id={`sec-${slug(sec.name)}`}>{sec.name}</h3>
                  <span className="muted small">
                    {sec.groups.length} {sec.groups.length === 1 ? 'issue' : 'issues'} on {(() => { const n = sec.info?.pages ?? Math.max(...sec.groups.map((g) => g.pageCount)); return `${n.toLocaleString()} ${n === 1 ? 'page' : 'pages'}`; })()}
                  </span>
                </div>
                {sec.groups.map((g) => (
                  <IssueRow key={g.ruleId} group={g} scanId={scanId} base={base} />
                ))}
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function IssueRow({ group: g, scanId, base }: { group: IssueGroup; scanId: number; base: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="xrow" data-open={open}>
      <button type="button" className="xrow__head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <SevDot severity={g.severity} />
        <span style={{ minWidth: 0 }}>
          <span className="xrow__title">{g.title}</span>
          <span className="xrow__meta">
            {g.guidelines.slice(0, 4).map((x) => (
              <span key={x.label} className="chip">{x.label}</span>
            ))}
            {g.templateLevel && (
              <span className="badge badge--info">
                <Layers size={12} aria-hidden="true" /> Theme-level: fix once in a shared template
              </span>
            )}
          </span>
        </span>
        <span className="small muted" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
          {(() => {
            // Failures only; pages where the rule only needs manual review are shown separately.
            const failing = g.severity === 'warning' ? g.pageCount : g.confirmedPageCount;
            return `${failing.toLocaleString()} ${failing === 1 ? 'page' : 'pages'}`;
          })()}
          {g.severity !== 'warning' && g.confirmedPageCount < g.pageCount && (
            <span className="xsmall" style={{ display: 'block' }}>
              +{(g.pageCount - g.confirmedPageCount).toLocaleString()} to review
            </span>
          )}
        </span>
        <ChevronRight size={18} className="xrow__chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="xrow__body" id={bodyId}>
          <IssueDetail group={g} scanId={scanId} base={base} />
        </div>
      )}
    </div>
  );
}

function IssueDetail({ group: g, scanId, base }: { group: IssueGroup; scanId: number; base: string }) {
  const [pages, setPages] = useState<OccurrencesResponse['pages']>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    api
      .get<OccurrencesResponse>(`/scans/${scanId}/report/issues/${encodeURIComponent(g.ruleId)}/pages?page=${page}`, { quiet: true })
      .then((r) => {
        if (!alive) return;
        setPages((cur) => (page === 1 ? r.pages : [...cur, ...r.pages]));
        setTotal(r.totalPages);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [scanId, g.ruleId, page]);

  return (
    <div className="stack issue-detail">
      <div className="issue-advice">
        <p>{g.description}</p>
        <p>
          <strong>How to fix: </strong>
          {g.fix}
        </p>
        <div className="row" style={{ gap: 6 }}>
          {g.guidelines.map((x) => (
            <GuidelineChip key={x.label} label={x.label} url={x.url} />
          ))}
          <Link className="chip chip--plain" to={ruleHref(g.ruleId)}>
            <BookOpen size={12} aria-hidden="true" /> Rule details
          </Link>
          {g.helpUrl && (
            <a className="chip chip--plain" href={g.helpUrl} target="_blank" rel="noreferrer noopener">
              More guidance <ExternalLink size={11} aria-hidden="true" />
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          )}
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <h4 className="small">
        Affected pages {total > 0 && <span className="muted">({pages.length} of {total} shown)</span>}
      </h4>
      <ul role="list" className="occ-list">
        {pages.map((p) => (
          <li key={p.pageId} className="occ">
            <div className="row" style={{ gap: 8 }}>
              <Link to={`${base}/pages/issues?page=${p.pageId}`} className="occ__url">
                {pathOf(p.url)}
              </Link>
              <a href={p.url} target="_blank" rel="noreferrer noopener" className="xsmall" aria-label={`Open ${p.url} in a new tab`}>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
              <span className="xsmall muted">
                {p.total} {p.total === 1 ? 'occurrence' : 'occurrences'}
              </span>
            </div>
            {p.lines.map((l, i) => (
              <div key={i} className="occ__line">
                <span className="line-chip">{l.line ? `Line ${l.line}` : 'Rendered DOM'}</span>
                {l.snippet && <code className="snippet">{l.snippet}</code>}
                {l.detail && l.detail !== l.snippet && <p className="xsmall muted occ__detail">{l.detail}</p>}
                {l.selector && <p className="xsmall muted occ__detail">Selector: <code>{l.selector}</code></p>}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {busy && <Spinner label="Loading pages" />}
      {!busy && pages.length < total && (
        <button type="button" className="btn btn--sm" onClick={() => setPage((n) => n + 1)} style={{ alignSelf: 'flex-start' }}>
          Load more pages
        </button>
      )}
      <HelpTip label="About line numbers" text="Line numbers point at the original page source. Elements added by JavaScript have no source line and are marked 'Rendered DOM'." />
    </div>
  );
}
