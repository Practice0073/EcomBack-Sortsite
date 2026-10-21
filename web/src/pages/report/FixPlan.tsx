import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Layers, ListChecks } from 'lucide-react';
import { useApi } from '../../lib/app';
import { fmtMinutes } from '../../lib/format';
import { Empty, ErrorBanner, HelpTip, LoadingBlock, SegmentedButtons, SevDot } from '../../components/ui';
import { CATEGORY_LABELS } from '@shared/options';
import { BUCKET_LABELS, useReport, type Bucket, type FixPlanResponse } from './context';

const BUCKET_HELP: Record<Bucket, string> = {
  'quick-win': 'High impact, low effort: do these first.',
  major: 'High impact, more effort: plan them into the next sprint.',
  'fill-in': 'Lower impact, low effort: batch them with related work.',
  later: 'Lower impact, more effort: schedule after the rest.',
};

export function FixPlan() {
  const { scanId, base } = useReport();
  const { data, error, loading, reload } = useApi<FixPlanResponse>(`/scans/${scanId}/report/fixplan`);
  const [bucket, setBucket] = useState<Bucket | 'all'>('all');
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <LoadingBlock rows={8} />;
  if (!data.items.length) return <div className="card"><Empty icon={<ListChecks size={36} aria-hidden="true" />} title="Nothing to fix">No issues were found that need a fix plan.</Empty></div>;

  const counts = (Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => ({ b, n: data.items.filter((i) => i.bucket === b).length, mins: data.items.filter((i) => i.bucket === b).reduce((s, i) => s + i.effortMinutes, 0) }));
  const items = bucket === 'all' ? data.items : data.items.filter((i) => i.bucket === bucket);
  const templates = data.items.filter((i) => i.templateLevel).length;

  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="fp-title">
        <div className="card__head">
          <h2 id="fp-title" className="row" style={{ gap: 8 }}>
            Prioritized fix plan
            <HelpTip label="How the plan is ranked" text="Issues are ranked by impact (severity × share of pages affected, accessibility weighted higher) divided by estimated effort. Theme-level issues sit in a shared template, so they are estimated as one fix." />
          </h2>
        </div>
        <div className="card__body fp-kpis">
          <div className="kpi">
            <span className="kpi__value">{fmtMinutes(data.totalMinutes)}</span>
            <span className="kpi__label row" style={{ gap: 4 }}><Clock size={14} aria-hidden="true" /> Estimated total effort</span>
          </div>
          <div className="kpi">
            <span className="kpi__value">{data.items.length}</span>
            <span className="kpi__label">Issue types to fix</span>
          </div>
          <div className="kpi">
            <span className="kpi__value">{templates}</span>
            <span className="kpi__label row" style={{ gap: 4 }}><Layers size={14} aria-hidden="true" /> Theme-level fixes</span>
          </div>
          {counts.map((c) => (
            <div className="kpi" key={c.b}>
              <span className="kpi__value">{c.n}</span>
              <span className="kpi__label">{BUCKET_LABELS[c.b]} · {fmtMinutes(c.mins)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card card--flush" aria-labelledby="fp-list">
        <div className="card__head">
          <h2 id="fp-list">Fixes in priority order</h2>
          <SegmentedButtons<Bucket | 'all'>
            label="Filter by group"
            value={bucket}
            onChange={setBucket}
            options={[{ value: 'all', label: 'All' }, ...(Object.keys(BUCKET_LABELS) as Bucket[]).map((b) => ({ value: b, label: BUCKET_LABELS[b] }))]}
          />
        </div>
        {bucket !== 'all' && <p className="small muted" style={{ padding: '12px 24px 0' }}>{BUCKET_HELP[bucket]}</p>}
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Prioritized fixes with impact and estimated effort</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Issue</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">Pages</th>
                <th scope="col" className="num">Impact</th>
                <th scope="col" className="num">Effort</th>
                <th scope="col">Group</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.ruleId}>
                  <td className="num muted">{data.items.indexOf(it) + 1}</td>
                  <td style={{ minWidth: 280 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                      <SevDot severity={it.severity} />
                      <div>
                        <Link to={`${base}/issues/${it.category}`} style={{ fontWeight: 600 }}>{it.title}</Link>
                        {it.templateLevel && (
                          <div style={{ marginTop: 4 }}>
                            <span className="badge badge--info"><Layers size={12} aria-hidden="true" /> Theme-level</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="small">{CATEGORY_LABELS[it.category]}</td>
                  <td className="num">{it.pageCount.toLocaleString()}</td>
                  <td className="num">{it.impact.toFixed(1)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtMinutes(it.effortMinutes)}</td>
                  <td><span className={`badge bucket bucket--${it.bucket}`}>{BUCKET_LABELS[it.bucket]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
