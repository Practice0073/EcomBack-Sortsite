/** Tiny inline trend for dashboard rows (decorative; values are given in text next to it). */
export function Sparkline({ values, width = 110, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted xsmall">—</span>;
  const max = 100;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`).join(' ');
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const color = last > first ? 'var(--chart-priority)' : last < first ? 'var(--chart-clean)' : 'var(--chart-axis)';
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
