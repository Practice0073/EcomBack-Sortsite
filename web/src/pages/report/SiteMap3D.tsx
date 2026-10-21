import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { cssVar, useTheme } from '../../lib/theme';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minus, Plus, Table2, Box } from 'lucide-react';
import { useApi } from '../../lib/app';
import { pathOf } from '../../lib/format';
import { Empty, ErrorBanner, LoadingBlock } from '../../components/ui';
import { useReport, type SiteMapNode } from './context';

const TILE_W = 44; // isometric tile width (world units)
const TILE_H = 22;
const SPACING = 1.35; // grid cells between towers
const COLORS = { priority: '#c4321d', other: '#e08a00', clean: '#15803d' } as const;

interface Tower {
  node: SiteMapNode;
  gx: number;
  gy: number;
  h: number;
  color: string;
  issues: number;
  /** Screen-space (world, before pan/zoom) silhouette for hit testing. */
  poly: [number, number][];
  cx: number;
  cy: number;
}

/** Square rings around the origin: ring r has 8r cells (ring 0 is the centre). */
function ringCells(r: number): [number, number][] {
  if (r === 0) return [[0, 0]];
  const cells: [number, number][] = [];
  for (let x = -r; x <= r; x++) cells.push([x, -r]);
  for (let y = -r + 1; y <= r; y++) cells.push([r, y]);
  for (let x = r - 1; x >= -r; x--) cells.push([x, r]);
  for (let y = r - 1; y > -r; y--) cells.push([-r, y]);
  return cells;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

const project = (gx: number, gy: number): [number, number] => [(gx - gy) * (TILE_W / 2) * SPACING, (gx + gy) * (TILE_H / 2) * SPACING];

/** Build towers: each page is a tower; click depth decides its ring (home in the centre); height = issues (log-scaled). */
function layout(nodes: SiteMapNode[]): Tower[] {
  const byDepth = new Map<number, SiteMapNode[]>();
  for (const n of nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const towers: Tower[] = [];
  let ring = 0;
  for (const d of depths) {
    const group = byDepth.get(d)!.sort((a, b) => b.priority + b.other - (a.priority + a.other) || a.url.localeCompare(b.url));
    let i = 0;
    while (i < group.length) {
      for (const [gx, gy] of ringCells(ring)) {
        if (i >= group.length) break;
        const node = group[i++]!;
        const issues = node.priority + node.other;
        const h = 6 + Math.log2(1 + issues) * 16;
        const color = node.priority > 0 ? COLORS.priority : node.other > 0 ? COLORS.other : COLORS.clean;
        const [cx, cy] = project(gx, gy);
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;
        const poly: [number, number][] = [
          [cx - hw, cy - h],
          [cx, cy - hh - h],
          [cx + hw, cy - h],
          [cx + hw, cy],
          [cx, cy + hh],
          [cx - hw, cy],
        ];
        towers.push({ node, gx, gy, h, color, issues, poly, cx, cy });
      }
      ring++;
    }
  }
  // Painter's order: back (smaller gx+gy) first.
  return towers.sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.gx - b.gx);
}

function inPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function SiteMap3D() {
  const { scanId, base } = useReport();
  const { data, error, loading, reload } = useApi<SiteMapNode[]>(`/scans/${scanId}/report/sitemap`);
  const [asTable, setAsTable] = useState(false);
  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <LoadingBlock rows={8} />;
  if (!data.length) return <div className="card"><Empty icon={<Box size={36} aria-hidden="true" />} title="No pages to map yet">The site map appears once pages have been checked.</Empty></div>;

  return (
    <section className="card" aria-labelledby="sm-title">
      <div className="card__head">
        <div>
          <h2 id="sm-title">Site map</h2>
          <p className="small muted">Each page is a tower. Height shows the number of issues; distance from the centre shows click depth from the home page.</p>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
          {asTable ? <Box size={15} aria-hidden="true" /> : <Table2 size={15} aria-hidden="true" />}
          {asTable ? 'Show 3D map' : 'Show as table'}
        </button>
      </div>
      <div className="card__body">{asTable ? <SiteMapTable nodes={data} base={base} /> : <TowerCanvas nodes={data} base={base} />}</div>
    </section>
  );
}

function TowerCanvas({ nodes, base }: { nodes: SiteMapNode[]; base: string }) {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const towers = useMemo(() => layout(nodes), [nodes]);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [theme] = useTheme(); // redraw the canvas when light/dark changes
  const [hover, setHover] = useState<number | null>(null); // index into towers
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [grow, setGrow] = useState(1);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const helpId = useId();
  const liveId = useId();
  const reduceMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  // Keyboard order: most issues first, so the worst pages are reached quickly.
  const kbOrder = useMemo(() => towers.map((t, i) => [t, i] as const).sort((a, b) => b[0].issues - a[0].issues || a[0].node.depth - b[0].node.depth).map(([, i]) => i), [towers]);

  const fit = useCallback(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of towers) for (const [x, y] of t.poly) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const pad = 40;
    const zoom = Math.min(2.2, Math.max(0.15, Math.min((size.w - pad * 2) / (maxX - minX || 1), (size.h - pad * 2) / (maxY - minY || 1))));
    setView({ zoom, x: size.w / 2 - ((minX + maxX) / 2) * zoom, y: size.h / 2 - ((minY + maxY) / 2) * zoom });
  }, [towers, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(320, Math.floor(entry!.contentRect.width));
      setSize({ w, h: Math.max(380, Math.min(640, Math.round(w * 0.62))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(fit, [fit]);

  // Grow-in animation (skipped when the user prefers reduced motion).
  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const start = performance.now();
    setGrow(0);
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setGrow(1 - (1 - p) ** 3);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [towers, reduceMotion]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const palette = { bg: cssVar('--map-bg', '#f8f8fb'), floor: cssVar('--map-floor', '#e6e8f2'), highlight: cssVar('--map-highlight', '#000082') };
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);

    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    // Ground tiles.
    for (const t of towers) {
      ctx.beginPath();
      ctx.moveTo(t.cx, t.cy - hh * 1.25);
      ctx.lineTo(t.cx + hw * 1.25, t.cy);
      ctx.lineTo(t.cx, t.cy + hh * 1.25);
      ctx.lineTo(t.cx - hw * 1.25, t.cy);
      ctx.closePath();
      ctx.fillStyle = palette.floor;
      ctx.fill();
    }
    towers.forEach((t, i) => {
      const h = t.h * grow;
      const active = i === hover || i === focusIdx;
      const base = active ? shade(t.color, 0.15) : t.color;
      // Left face.
      ctx.beginPath();
      ctx.moveTo(t.cx - hw, t.cy - h);
      ctx.lineTo(t.cx, t.cy + hh - h);
      ctx.lineTo(t.cx, t.cy + hh);
      ctx.lineTo(t.cx - hw, t.cy);
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.12);
      ctx.fill();
      // Right face.
      ctx.beginPath();
      ctx.moveTo(t.cx + hw, t.cy - h);
      ctx.lineTo(t.cx, t.cy + hh - h);
      ctx.lineTo(t.cx, t.cy + hh);
      ctx.lineTo(t.cx + hw, t.cy);
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.32);
      ctx.fill();
      // Top face.
      ctx.beginPath();
      ctx.moveTo(t.cx, t.cy - hh - h);
      ctx.lineTo(t.cx + hw, t.cy - h);
      ctx.lineTo(t.cx, t.cy + hh - h);
      ctx.lineTo(t.cx - hw, t.cy - h);
      ctx.closePath();
      ctx.fillStyle = shade(base, 0.28);
      ctx.fill();
      if (active) {
        ctx.lineWidth = 2.5 / view.zoom;
        ctx.strokeStyle = palette.highlight;
        ctx.beginPath();
        t.poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y + (t.h - h) * (k < 3 ? 1 : 0)) : ctx.moveTo(x, y + (t.h - h))));
        ctx.closePath();
        ctx.stroke();
      }
    });
  }, [towers, size, view, hover, focusIdx, grow, theme]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(clientX - rect.left - view.x) / view.zoom, (clientY - rect.top - view.y) / view.zoom] as const;
  };
  const hit = (clientX: number, clientY: number): number | null => {
    const [x, y] = toWorld(clientX, clientY);
    for (let i = towers.length - 1; i >= 0; i--) if (inPoly(x, y, towers[i]!.poly)) return i;
    return null;
  };

  const zoomBy = (factor: number, cx = size.w / 2, cy = size.h / 2) =>
    setView((v) => {
      const zoom = Math.max(0.1, Math.min(6, v.zoom * factor));
      return { zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom };
    });

  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  };
  // Stop page scroll while zooming the map with the wheel.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const prevent = (e: globalThis.WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', prevent, { passive: false });
    return () => c.removeEventListener('wheel', prevent);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) {
        setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        return;
      }
    }
    setHover(hit(e.clientX, e.clientY));
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const i = hit(e.clientX, e.clientY);
      if (i !== null) navigate(`${base}/pages/issues?page=${towers[i]!.node.id}`);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step = 40;
    const move = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    const cycle = (dir: 1 | -1) => {
      const pos = focusIdx === null ? -1 : kbOrder.indexOf(focusIdx);
      setFocusIdx(kbOrder[(pos + dir + kbOrder.length) % kbOrder.length]!);
    };
    switch (e.key) {
      case 'ArrowLeft': move(step, 0); break;
      case 'ArrowRight': move(-step, 0); break;
      case 'ArrowUp': move(0, step); break;
      case 'ArrowDown': move(0, -step); break;
      case '+': case '=': zoomBy(1.2); break;
      case '-': case '_': zoomBy(1 / 1.2); break;
      case '0': fit(); break;
      case 'n': case ']': cycle(1); break;
      case 'p': case '[': cycle(-1); break;
      case 'Enter':
        if (focusIdx !== null) navigate(`${base}/pages/issues?page=${towers[focusIdx]!.node.id}`);
        break;
      case 'Escape': setFocusIdx(null); break;
      default:
        return;
    }
    e.preventDefault();
  };

  const tip = hover ?? focusIdx;
  const tipTower = tip !== null ? towers[tip] : null;
  const tipPos = tipTower ? { left: tipTower.cx * view.zoom + view.x, top: (tipTower.cy - tipTower.h) * view.zoom + view.y } : null;
  const counts = { priority: towers.filter((t) => t.node.priority > 0).length, other: towers.filter((t) => t.node.priority === 0 && t.node.other > 0).length, clean: towers.filter((t) => t.issues === 0).length };
  const focusedNode = focusIdx !== null ? towers[focusIdx]!.node : null;

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="sm-legend" aria-label="Legend">
          <span><i style={{ background: COLORS.priority }} aria-hidden="true" /> Priority issues ({counts.priority})</span>
          <span><i style={{ background: COLORS.other }} aria-hidden="true" /> Other issues only ({counts.other})</span>
          <span><i style={{ background: COLORS.clean }} aria-hidden="true" /> No issues ({counts.clean})</span>
          <span className="muted">Taller = more issues</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="icon-btn" onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={18} /></button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={18} /></button>
          <button type="button" className="btn btn--sm" onClick={fit}><Maximize2 size={14} aria-hidden="true" /> Reset view</button>
        </div>
      </div>
      <div ref={wrapRef} className="sm-wrap" style={{ height: size.h }}>
        <canvas
          ref={canvasRef}
          className="sm-canvas"
          style={{ width: size.w, height: size.h, cursor: hover !== null ? 'pointer' : drag.current?.moved ? 'grabbing' : 'grab' }}
          tabIndex={0}
          role="img"
          aria-label={`3D site map of ${towers.length} pages: ${counts.priority} with priority issues, ${counts.other} with other issues only, ${counts.clean} without issues.`}
          aria-describedby={`${helpId} ${liveId}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setFocusIdx(null)}
        />
        {tipTower && tipPos && (
          <div className="sm-tip" style={{ left: tipPos.left, top: tipPos.top }} aria-hidden="true">
            <strong>{pathOf(tipTower.node.url)}</strong>
            {tipTower.node.title && <span className="sm-tip__title">{tipTower.node.title}</span>}
            <span>
              {tipTower.issues} issue{tipTower.issues === 1 ? '' : 's'} ({tipTower.node.priority} priority, {tipTower.node.other} other) · {tipTower.node.warning} warnings
            </span>
            <span>Click depth {tipTower.node.depth}</span>
          </div>
        )}
      </div>
      <p id={helpId} className="xsmall muted">
        Drag to pan, scroll to zoom, click a tower to open the page's issues. Keyboard: focus the map, then arrow keys pan, + and − zoom, 0 resets, N / P step through pages (most issues first) and Enter opens the page.
      </p>
      <p id={liveId} className="sr-only" aria-live="polite">
        {focusedNode ? `${pathOf(focusedNode.url)}: ${focusedNode.priority} priority and ${focusedNode.other} other issues, click depth ${focusedNode.depth}. Press Enter to open.` : ''}
      </p>
    </div>
  );
}

function SiteMapTable({ nodes, base }: { nodes: SiteMapNode[]; base: string }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Pages by click depth with issue counts</caption>
        <thead>
          <tr>
            <th scope="col">Page</th>
            <th scope="col" className="num">Depth</th>
            <th scope="col" className="num">Priority</th>
            <th scope="col" className="num">Other</th>
            <th scope="col" className="num">Warnings</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id}>
              <td>
                <a
                  href={`${base}/pages/issues?page=${n.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`${base}/pages/issues?page=${n.id}`);
                  }}
                  style={{ wordBreak: 'break-all' }}
                >
                  {pathOf(n.url)}
                </a>
                {n.title && <div className="xsmall muted">{n.title}</div>}
              </td>
              <td className="num">{n.depth}</td>
              <td className="num">{n.priority}</td>
              <td className="num">{n.other}</td>
              <td className="num">{n.warning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
