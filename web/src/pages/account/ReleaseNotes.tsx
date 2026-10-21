import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useApi, usePage } from '../../lib/app';
import { fmtDate } from '../../lib/format';
import { Empty, ErrorBanner, LoadingBlock, SegmentedButtons } from '../../components/ui';
import './shared';

interface Note { id: number; version: string; title: string; category: string; date: string; newFeatures: string[]; ruleChanges: string[]; fixes: string[] }

const TONE: Record<string, string> = { Release: 'badge--success', Beta: 'badge--info', Rules: 'badge--warning', Fix: 'badge--danger' };

export function ReleaseNotesPage() {
  usePage('Release Notes');
  const { data, error, loading, reload } = useApi<Note[]>('/release-notes');
  const [category, setCategory] = useState('all');
  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load release notes.'} onRetry={() => void reload()} />;
  const categories = [...new Set(data.map((n) => n.category))];
  const shown = category === 'all' ? data : data.filter((n) => n.category === category);

  return (
    <div className="stack-lg" style={{ maxWidth: 960 }}>
      {categories.length > 1 && <SegmentedButtons label="Filter by category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]} />}
      {!shown.length ? (
        <div className="card">
          <Empty icon={<Sparkles size={36} aria-hidden="true" />} title="No release notes" />
        </div>
      ) : (
        shown.map((n) => (
          <article key={n.id} className="card" aria-labelledby={`rn-${n.id}`}>
            <div className="card__head">
              <div className="row" style={{ gap: 10 }}>
                <span className={`badge ${TONE[n.category] ?? 'badge--neutral'}`}>{n.category}</span>
                <h2 id={`rn-${n.id}`}>
                  {n.version} — {n.title}
                </h2>
              </div>
              <time className="small muted" dateTime={n.date}>
                {fmtDate(n.date)}
              </time>
            </div>
            <div className="card__body stack note-card">
              {(
                [
                  ['New Features', n.newFeatures],
                  ['Rule Changes', n.ruleChanges],
                  ['Fixes', n.fixes],
                ] as const
              )
                .filter(([, list]) => list.length)
                .map(([heading, list]) => (
                  <section key={heading}>
                    <h3 style={{ fontSize: '0.95rem' }}>{heading}</h3>
                    <ul>
                      {list.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
