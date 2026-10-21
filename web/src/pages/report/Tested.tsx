import { CheckCircle2, MinusCircle } from 'lucide-react';
import { useApi } from '../../lib/app';
import { ErrorBanner, LoadingBlock } from '../../components/ui';
import { useReport, type TestedResponse } from './context';

export function Tested() {
  const { scanId } = useReport();
  const { data, error, loading, reload } = useApi<TestedResponse>(`/scans/${scanId}/report/tested`);
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <LoadingBlock rows={6} />;
  return (
    <div className="grid-2 tested">
      <section className="card card--flush" aria-labelledby="tested-g">
        <div className="card__head">
          <h2 id="tested-g">Guidelines</h2>
          <span className="muted small">{data.guidelines.filter((g) => g.checked).length} of {data.guidelines.length} checked</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Guidelines checked in this scan</caption>
            <thead>
              <tr>
                <th scope="col">Guideline</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.guidelines.map((g) => (
                <tr key={g.name} className={g.checked ? undefined : 'is-muted'}>
                  <th scope="row" className="row-head">
                    {g.name}
                  </th>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      {g.checked ? <CheckCircle2 size={17} color="var(--success)" aria-hidden="true" /> : <MinusCircle size={17} aria-hidden="true" />}
                      <span className="small">{g.checked ? `Checked${g.note ? ` (${g.note})` : ''}` : 'Not checked for this scan'}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card card--flush" aria-labelledby="tested-o">
        <div className="card__head">
          <h2 id="tested-o">Scan options</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Options used for this scan</caption>
            <thead>
              <tr>
                <th scope="col">Option</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.scanOptions.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row" className="row-head">
                    {k}
                  </th>
                  <td className="small" style={{ wordBreak: 'break-word' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
