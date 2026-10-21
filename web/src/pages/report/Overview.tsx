import { Link } from 'react-router-dom';
import { ArrowRight, Info, ShoppingBag } from 'lucide-react';
import { BarRow, Gauge, HelpTip } from '../../components/ui';
import { CATEGORY_LABELS } from '@shared/options';
import type { Benchmark, CategoryStat } from '@shared/types';
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

  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="ov-title">
        <div className="card__body overview-hero">
          <Gauge value={pct} size={168} stroke={14} sub="of pages" ariaLabel={`${Math.round(pct)}% of pages have quality issues`} />
          <div className="stack" style={{ gap: 10 }}>
            <h2 id="ov-title" style={{ fontSize: '1.5rem' }}>
              {s.pagesWithIssues.toLocaleString()} {s.pagesWithIssues === 1 ? 'page' : 'pages'} with quality issues
            </h2>
            <BenchmarkBadge benchmark={s.benchmark} />
            <p className="muted">
              {s.pagesChecked.toLocaleString()} pages and {s.filesChecked.toLocaleString()} files checked by {s.rulesChecked.toLocaleString()} rules.{' '}
              <Link to={`${base}/pages/diagnostics`}>Diagnostics ({s.diagnosticsCount})</Link>
            </p>
            <p className="small" style={{ color: 'var(--text-2)', maxWidth: 720 }}>
              The gauge shows the share of checked pages with at least one priority or other issue. Warnings are listed in each category but do not count here. Open a category below to see the issues, the pages they appear on and how to fix them.
            </p>
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
              <p className="row xsmall muted" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Info size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
                Automated testing finds only part of accessibility problems. Confirm with keyboard and screen-reader testing before claiming conformance.
              </p>
            </div>
          </div>
        </section>

        {a11y && <CategoryCard stat={a11y} base={base} featured />}
      </div>

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

function CategoryCard({ stat, base, featured = false }: { stat: CategoryStat; base: string; featured?: boolean }) {
  const label = CATEGORY_LABELS[stat.category];
  const id = `cat-${stat.category}`;
  const bars = stat.category === 'accessibility' ? stat.bars.filter((b) => /^Level|Warnings/.test(b.label)) : stat.bars.slice(0, 6);
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
