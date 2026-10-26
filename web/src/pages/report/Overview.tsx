import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileStack, Files, Flame, Info, Layers, ListChecks, Minus, ShoppingBag, Target } from 'lucide-react';
import { BarRow, Gauge, HelpTip, SevDot } from '../../components/ui';
import { fmtDate, plural } from '../../lib/format';
import { CATEGORY_LABELS } from '@shared/options';
import type { Benchmark, CategoryStat, ReportSummary, TopIssue } from '@shared/types';
import { useReport } from './context';

const GRADE = (s: number) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 55 ? 'D' : 'F');

export const SCORE_HELP =
  'ADA / WCAG score: starts at 100. Each failing accessibility rule deducts points — priority issues 4 + 8 × the share of pages affected, other issues 1.5 + 3 × the share. Warnings do not deduct. It measures automated findings only and is not a legal statement of compliance.';

export function BenchmarkBadge({ benchmark }: { benchmark: Benchmark }) {
  const cls = benchmark.label === 'better' ? 'badge--success' : benchmark.label === 'worse' ? 'badge--danger' : 'badge--neutral';
  const text = benchmark.label === 'better' ? 'Better than average' : benchmark.label === 'worse' ? 'Worse than average' : 'About average';
  return (
    <span className="benchmark">
      <span className={`badge ${cls}`}>{text}</span>
      <HelpTip label="About the benchmark" text={`Average: ${benchmark.value}% of pages with issues. ${benchmark.source}`} />
    </span>
  );
}

export function Overview() {
  const { summary: s, base } = useReport();
  const a11y = s.categories.find((c) => c.category === 'accessibility');
  const others = s.categories.filter((c) => c.category !== 'accessibility' && c.enabled);
  const pct = s.pagesChecked ? (s.pagesWithIssues / s.pagesChecked) * 100 : 0;
  const running = !!s.running;

  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="ov-title">
        <div className="card__body overview-hero">
          <Gauge value={pct} size={168} stroke={14} sub="of pages" ariaLabel={`${Math.round(pct)}% of pages have quality issues`} />
          <div className="stack" style={{ gap: 10 }}>
            <h2 id="ov-title" style={{ fontSize: '1.5rem' }}>
              {s.pagesWithIssues.toLocaleString()} {s.pagesWithIssues === 1 ? 'page' : 'pages'} with quality issues{running && <span className="muted" style={{ fontWeight: 500 }}> so far</span>}
            </h2>
            <div className="row" style={{ gap: 10 }}>
              <BenchmarkBadge benchmark={s.benchmark} />
              {s.previous && <SinceLastScan summary={s} />}
            </div>
            <p className="muted">
              {s.pagesChecked.toLocaleString()} pages and {s.filesChecked.toLocaleString()} files checked by {s.rulesChecked.toLocaleString()} rules.{' '}
              <Link to={`${base}/pages/diagnostics`}>Diagnostics ({s.diagnosticsCount})</Link>
            </p>
            <p className="small" style={{ color: 'var(--text-2)', maxWidth: 720 }}>
              The gauge is the share of checked pages with at least one priority or other issue. Open a category below to see each issue, the pages it appears on and how to fix it.
            </p>
            <ul className="sev-legend" aria-label="Severity legend">
              <li><SevDot severity="priority" /> <strong>Priority</strong> — blocks visitors or search engines: WCAG Level A failures, broken links, server errors</li>
              <li><SevDot severity="other" /> <strong>Other</strong> — Level AA, validation, SEO and usability problems to fix</li>
              <li><SevDot severity="warning" /> <strong>Warnings</strong> — best practices and items to review by hand; not counted in the gauges</li>
            </ul>
            {s.shopify && (
              <p className="row small" style={{ gap: 6 }}>
                <span className="badge badge--success">
                  <ShoppingBag size={12} aria-hidden="true" /> Shopify detected
                </span>
                <span className="muted">The Shopify preset was applied (cart coverage, duplicate URL filtering, theme vs. app assets).</span>
              </p>
            )}
          </div>
        </div>
        <div className="ov-kpis" role="list" aria-label="Scan at a glance">
          <Kpi icon={<FileStack size={16} />} value={s.pagesChecked} label="Pages checked" />
          <Kpi icon={<Files size={16} />} value={s.filesChecked} label="Files checked" />
          <Kpi icon={<ListChecks size={16} />} value={s.rulesChecked} label="Rules applied" />
          <Kpi icon={<Target size={16} />} value={s.issueTypes.failing} label="Issue types found" hint={s.issueTypes.warnings ? `+ ${plural(s.issueTypes.warnings, 'warning type')}` : undefined} />
          <Kpi icon={<Flame size={16} />} value={`${Math.round(s.scan.priorityPct)}%`} label="Pages with priority issues" tone={s.scan.priorityPct > 0 ? 'danger' : 'success'} />
        </div>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="score-title">
          <div className="card__head">
            <h2 id="score-title" className="row" style={{ gap: 8 }}>
              ADA / WCAG compliance score <HelpTip label="How the score is calculated" text={SCORE_HELP} />
            </h2>
          </div>
          <div className="card__body row" style={{ gap: 24, alignItems: 'center' }}>
            <Gauge value={s.complianceScore} tone="score" size={132} label={String(s.complianceScore)} sub={`Grade ${GRADE(s.complianceScore)}`} ariaLabel={`Compliance score ${s.complianceScore} out of 100, grade ${GRADE(s.complianceScore)}`} />
            <div className="stack" style={{ gap: 8, flex: '1 1 220px', minWidth: 0 }}>
              <p className="small" style={{ color: 'var(--text-2)' }}>
                Tested against {s.options.rules.accessibility.enabled ? `WCAG ${s.options.rules.accessibility.wcagVersion} Level ${s.options.rules.accessibility.wcagLevel}` : 'no accessibility rules (turned off in options)'}.
              </p>
              {s.previous && s.previous.complianceScore !== null && (
                <Delta now={s.complianceScore} before={s.previous.complianceScore} higherIsBetter unit="" what="score" />
              )}
              <p className="row xsmall muted" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Info size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
                Automated testing finds only part of accessibility problems. Confirm with keyboard and screen-reader testing before claiming conformance.
              </p>
            </div>
          </div>
        </section>

        {a11y && <CategoryCard stat={a11y} base={base} featured />}
      </div>

      {s.topIssues.length > 0 && <TopIssues items={s.topIssues} base={base} pages={s.pagesChecked} />}

      {others.length > 0 && (
        <div className="grid-auto">
          {others.map((c) => (
            <CategoryCard key={c.category} stat={c} base={base} />
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, value, label, hint, tone }: { icon: ReactNode; value: number | string; label: string; hint?: string; tone?: 'danger' | 'success' }) {
  return (
    <div className="ov-kpi" role="listitem">
      <span className="ov-kpi__icon" aria-hidden="true">{icon}</span>
      <span className="ov-kpi__value" style={tone ? { color: tone === 'danger' ? 'var(--priority)' : 'var(--success)' } : undefined}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
      <span className="ov-kpi__label">{label}</span>
      {hint && <span className="ov-kpi__hint">{hint}</span>}
    </div>
  );
}

/** Change against the previous completed scan of the site, in percentage points. */
function SinceLastScan({ summary: s }: { summary: ReportSummary }) {
  const prev = s.previous!;
  const delta = Math.round((s.scan.issuePct - prev.issuePct) * 10) / 10;
  const Icon = delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const cls = delta === 0 ? 'badge--neutral' : delta > 0 ? 'badge--danger' : 'badge--success';
  return (
    <Link to={`/sites/${s.site.id}/compare?a=${prev.scanId}&b=${s.scan.id}`} className={`badge ${cls}`} style={{ textDecoration: 'none' }} title={`Compare with the scan of ${fmtDate(prev.finishedAt)}`}>
      <Icon size={13} aria-hidden="true" />
      {delta === 0 ? 'No change' : `${delta > 0 ? '+' : ''}${delta} pts`} since {fmtDate(prev.finishedAt)}
      <span className="sr-only"> — {delta > 0 ? 'more' : delta < 0 ? 'fewer' : 'the same'} pages with issues than the previous scan. Opens the comparison.</span>
    </Link>
  );
}

function Delta({ now, before, higherIsBetter, unit, what }: { now: number; before: number; higherIsBetter: boolean; unit: string; what: string }) {
  const delta = Math.round((now - before) * 10) / 10;
  const good = delta === 0 ? null : higherIsBetter ? delta > 0 : delta < 0;
  const Icon = delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="row small" style={{ gap: 4, color: good === null ? 'var(--text-3)' : good ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
      <Icon size={15} aria-hidden="true" />
      {delta === 0 ? `Same ${what} as the previous scan` : `${delta > 0 ? '+' : ''}${delta}${unit} ${what} since the previous scan`}
      {good !== null && <span className="sr-only">{good ? ' (improved)' : ' (worse)'}</span>}
    </p>
  );
}

/** The failing rules that reach the most pages: what to fix first, with a jump to each category tab. */
function TopIssues({ items, base, pages }: { items: TopIssue[]; base: string; pages: number }) {
  return (
    <section className="card card--flush" aria-labelledby="top-issues">
      <div className="card__head">
        <div>
          <h2 id="top-issues">Most widespread issues</h2>
          <p className="small muted" style={{ marginTop: 2 }}>Failing rules affecting the most pages — the fastest way to move the gauge.</p>
        </div>
        <Link to={`${base}/issues/${items[0]?.category ?? 'accessibility'}`} className="row small" style={{ gap: 4, fontWeight: 600 }}>
          All issues <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <ol className="top-issues" aria-label="Most widespread issues">
        {items.map((it, i) => {
          const share = pages ? Math.min(100, (it.pages / pages) * 100) : 0;
          return (
            <li key={it.ruleId} className="top-issue">
              <span className="top-issue__rank" aria-hidden="true">{i + 1}</span>
              <div className="top-issue__main">
                <Link to={`${base}/issues/${it.category}`} className="top-issue__title">
                  <SevDot severity={it.severity} /> {it.title}
                </Link>
                <span className="top-issue__meta">
                  <span className="chip">{CATEGORY_LABELS[it.category]}</span>
                  <span className="xsmall muted">{it.section}</span>
                  {it.templateLevel && (
                    <span className="badge badge--info">
                      <Layers size={12} aria-hidden="true" /> Theme-level: fix once
                    </span>
                  )}
                </span>
              </div>
              <div className="top-issue__reach">
                <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{plural(it.pages, 'page')}</span>
                <span className="bar" role="img" aria-label={`${Math.round(share)}% of pages`}>
                  <span style={{ width: `${Math.max(share, 1)}%`, background: it.severity === 'priority' ? 'var(--priority)' : 'var(--warning-dot)' }} />
                </span>
                <span className="xsmall muted">{plural(it.occurrences, 'occurrence')}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CategoryCard({ stat, base, featured = false }: { stat: CategoryStat; base: string; featured?: boolean }) {
  const label = CATEGORY_LABELS[stat.category];
  const id = `cat-${stat.category}`;
  const bars = stat.category === 'accessibility' ? stat.bars.filter((b) => /^Level|Warnings/.test(b.label)) : stat.bars;
  return (
    <section className="card cat-card" aria-labelledby={id}>
      <div className="card__head">
        <h2 id={id} style={{ fontSize: featured ? '1.15rem' : '1rem' }}>
          {label}
        </h2>
        <Link to={`${base}/issues/${stat.category}`} className="row small" style={{ gap: 4, fontWeight: 600 }}>
          View issues <ArrowRight size={14} aria-hidden="true" />
          <span className="sr-only"> for {label}</span>
        </Link>
      </div>
      <div className="card__body stack">
        {!stat.enabled ? (
          <p className="muted small">Not checked in this scan (turned off in Options).</p>
        ) : (
          <>
            <div className="row" style={{ gap: 16 }}>
              <Gauge value={stat.issuePct} size={featured ? 92 : 72} stroke={featured ? 9 : 7} ariaLabel={`${label}: ${Math.round(stat.issuePct)}% of pages have issues`} />
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <strong>{stat.pagesWithIssues.toLocaleString()}</strong> <span className="muted small">pages with issues</span>
                <div className="row xsmall" style={{ gap: 10, marginTop: 6 }}>
                  <span className="row" style={{ gap: 4 }}><span className="sev-dot sev-dot--priority" aria-hidden="true" />{stat.priorityCount.toLocaleString()} priority</span>
                  <span className="row" style={{ gap: 4 }}><span className="sev-dot sev-dot--other" aria-hidden="true" />{stat.otherCount.toLocaleString()} other</span>
                  <span className="row" style={{ gap: 4 }}><span className="sev-dot sev-dot--warning" aria-hidden="true" />{stat.warningCount.toLocaleString()} warnings</span>
                </div>
              </div>
            </div>
            {bars.length > 0 && (
              <div className="stack" style={{ gap: 10 }}>
                {bars.map((b) => (
                  <BarRow key={b.label} label={b.label} pct={b.pct} help={b.help || undefined} tone={b.label === 'Warnings' ? 'warn' : 'danger'} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
