import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate } from '../lib/format';
import { cssVar, useTheme } from '../lib/theme';

export interface TrendPoint { scanId: number; date: string; priority: number; other: number }

/** Issue trend: dotted red (priority) and amber (other) lines on a 0–100% axis, with a screen-reader table. */
export function TrendChart({ points, height = 200 }: { points: TrendPoint[]; height?: number }) {
  if (points.length < 2) {
    return <p className="muted small" style={{ padding: '24px 0' }}>The trend chart appears after two completed scans.</p>;
  }
  const [theme] = useTheme(); // re-render with the active theme's colours
  const c = { grid: cssVar('--chart-grid'), axis: cssVar('--chart-axis'), priority: cssVar('--chart-priority'), other: cssVar('--chart-other'), surface: cssVar('--surface'), border: cssVar('--border'), text: cssVar('--text') };
  const data = points.map((p) => ({ ...p, label: fmtDate(p.date) }));
  return (
    <figure style={{ margin: 0 }}>
      <div aria-hidden="true" style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid key={theme} stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.axis }} tickLine={false} axisLine={{ stroke: c.grid }} minTickGap={24} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: c.axis }} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} contentStyle={{ borderRadius: 10, border: `1px solid ${c.border}`, fontSize: 12, background: c.surface, color: c.text }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="priority" name="Priority Issues" stroke={c.priority} strokeWidth={2.5} strokeDasharray="2 4" strokeLinecap="round" dot={{ r: 3.5, fill: c.priority }} isAnimationActive={false} />
            <Line type="monotone" dataKey="other" name="Other Issues" stroke={c.other} strokeWidth={2.5} strokeDasharray="2 4" strokeLinecap="round" dot={{ r: 3.5, fill: c.other }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Percent of pages with issues by scan date</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Priority issues</th>
            <th scope="col">Other issues</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.scanId}>
              <td>{d.label}</td>
              <td>{d.priority}%</td>
              <td>{d.other}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
