/**
 * The sign-in stage: SortSite's own signature visual — the isometric page-tower map — brought to life.
 * Pages rise as they are found, a scan beam sweeps across and colours each tower by its result, findings
 * surface as chips, and the score settles. Canvas 2D for the city (one draw per frame), DOM for the HUD
 * and chips (crisp text, framer-motion entrances). Decorative: the canvas carries one description, the
 * HUD is aria-hidden, there is a Pause control (WCAG 2.2.2) and reduced-motion shows the finished state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';

type Verdict = 'clean' | 'other' | 'priority';
interface Tower { ring: number; gx: number; gy: number; cx: number; cy: number; target: number; verdict: Verdict; foundAt: number; scannedAt: number; issues: number }
interface Chip { index: number; path: string; text: string; verdict: Verdict }

const TILE_W = 40;
const TILE_H = 20;
const SPACING = 1.3;
const RINGS = 6; // rings 0–5 → 121 towers
const LOOP_MS = 14000;
const BEAM_START = 2600;
const BEAM_END = 8400;
const SCORE_AT = 8700;
const FINAL_SCORE = 94;
const RGB: Record<Verdict | 'seed', [number, number, number]> = { clean: [143, 151, 255], other: [245, 184, 61], priority: [244, 76, 53], seed: [84, 93, 205] };
const PATHS: Record<Verdict, [string, string][]> = {
  priority: [['/products/linen-shirt', 'Image without alt text · WCAG 1.1.1'], ['/pages/contact', 'Form field without a label · WCAG 4.1.2'], ['/collections/sale', 'Broken link · 404']],
  other: [['/collections/all', 'Contrast 3.8:1 · WCAG 1.4.3'], ['/blogs/news', 'Meta description too long'], ['/cart', 'Focus outline removed · F78']],
  clean: [['/policies/refund-policy', 'No issues'], ['/pages/about', 'No issues']],
};
/** Minimum distance (world units) between chip anchors, so callouts never pile up. */
const CHIP_SPREAD = 150;

function ringCells(r: number): [number, number][] {
  if (r === 0) return [[0, 0]];
  const cells: [number, number][] = [];
  for (let x = -r; x <= r; x++) cells.push([x, -r]);
  for (let y = -r + 1; y <= r; y++) cells.push([r, y]);
  for (let x = r - 1; x >= -r; x--) cells.push([x, r]);
  for (let y = r - 1; y > -r; y--) cells.push([-r, y]);
  return cells;
}
const project = (gx: number, gy: number): [number, number] => [((gx - gy) * TILE_W * SPACING) / 2, ((gx + gy) * TILE_H * SPACING) / 2];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** Small deterministic PRNG so every loop is a slightly different site. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCity(seed: number): { towers: Tower[]; chips: Chip[]; bounds: { minX: number; maxX: number; minY: number; maxY: number } } {
  const rnd = mulberry32(seed);
  const towers: Tower[] = [];
  for (let ring = 0; ring < RINGS; ring++) {
    for (const [gx, gy] of ringCells(ring)) {
      const roll = rnd();
      const verdict: Verdict = ring === 0 ? 'clean' : roll < 0.07 ? 'priority' : roll < 0.24 ? 'other' : 'clean';
      const issues = verdict === 'clean' ? 0 : verdict === 'other' ? 1 + Math.floor(rnd() * 4) : 3 + Math.floor(rnd() * 9);
      const target = verdict === 'clean' ? 7 + rnd() * 5 : verdict === 'other' ? 16 + issues * 3 : 26 + issues * 2.2;
      const [cx, cy] = project(gx, gy);
      towers.push({ ring, gx, gy, cx, cy, target, verdict, issues, foundAt: 250 + ring * 380 + rnd() * 320, scannedAt: 0 });
    }
  }
  const xs = towers.map((t) => t.cx);
  const ys = towers.map((t) => t.cy);
  const bounds = { minX: Math.min(...xs) - TILE_W / 2, maxX: Math.max(...xs) + TILE_W / 2, minY: Math.min(...ys) - 50, maxY: Math.max(...ys) + TILE_H };
  const from = bounds.minX - 40;
  const to = bounds.maxX + 40;
  for (const t of towers) t.scannedAt = BEAM_START + ((t.cx - from) / (to - from)) * (BEAM_END - BEAM_START);
  // Painter's order: back to front.
  towers.sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.gx - b.gx);
  // Chips: the home page, two priority, one other, one clean — each far enough from the others to read.
  const chips: Chip[] = [];
  const farFromOthers = (t: Tower) => chips.every((c) => Math.hypot(towers[c.index]!.cx - t.cx, towers[c.index]!.cy - t.cy) >= CHIP_SPREAD);
  const homeIndex = towers.findIndex((t) => t.ring === 0);
  chips.push({ index: homeIndex, path: '/', text: 'No issues · 242 rules', verdict: 'clean' });
  const pick = (verdict: Verdict, n: number) => {
    const candidates = towers
      .map((t, i) => [t, i] as const)
      .filter(([t, i]) => t.verdict === verdict && t.ring > 0 && !chips.some((c) => c.index === i))
      .sort((a, b) => a[0].scannedAt - b[0].scannedAt);
    let k = 0;
    for (const [t, i] of candidates) {
      if (k >= n) break;
      if (!farFromOthers(t)) continue;
      const [path, text] = PATHS[verdict][k % PATHS[verdict].length]!;
      chips.push({ index: i, path, text, verdict });
      k++;
    }
  };
  pick('priority', 2);
  pick('other', 1);
  pick('clean', 1);
  return { towers, chips, bounds };
}

const mix = (a: [number, number, number], b: [number, number, number], p: number) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * p)}, ${Math.round(a[1] + (b[1] - a[1]) * p)}, ${Math.round(a[2] + (b[2] - a[2]) * p)})`;
const shade = (rgb: string, f: number) => {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(rgb)!;
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${ch(Number(m[1]))}, ${ch(Number(m[2]))}, ${ch(Number(m[3]))})`;
};

export function ScanStage({ dim = false }: { dim?: boolean }) {
  const reduceMotion = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const gradeRef = useRef<HTMLSpanElement>(null);
  const chipRefs = useRef(new Map<number, HTMLDivElement>());
  const [paused, setPaused] = useState(false);
  // The loop reads this ref, so pausing never restarts the effect (and the timeline) — it freezes in place.
  const pausedRef = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [visibleChips, setVisibleChips] = useState<number[]>([]);
  const city = useRef(buildCity(1));
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Rebuild the city when a loop restarts so each pass is a slightly different site.
  useEffect(() => {
    city.current = buildCity(generation + 1);
  }, [generation]);

  const draw = useCallback(
    (tRaw: number, size: { w: number; h: number }) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const { towers, bounds, chips } = city.current;
      const t = reduceMotion ? LOOP_MS - 900 : tRaw;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);

      // Composition: the city sits right of centre on wide screens, centred when the form stacks above it.
      const wide = size.w >= 1100;
      const zoom = Math.max(0.55, Math.min(1.5, Math.min(((wide ? 0.5 : 0.92) * size.w) / (bounds.maxX - bounds.minX), (0.62 * size.h) / (bounds.maxY - bounds.minY))));
      const originX = (wide ? 0.69 : 0.5) * size.w - ((bounds.minX + bounds.maxX) / 2) * zoom + pointer.current.x;
      const originY = (wide ? 0.5 : 0.46) * size.h - ((bounds.minY + bounds.maxY) / 2) * zoom + pointer.current.y;
      const fade = reduceMotion ? 1 : Math.min(1, t / 450, (LOOP_MS - t) / 450);
      ctx.globalAlpha = fade * (dim ? 0.55 : 1);
      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(zoom, zoom);

      const hw = TILE_W / 2;
      const hh = TILE_H / 2;
      // Floor tiles.
      for (const tw of towers) {
        const appear = easeOut(clamp01((t - tw.foundAt + 200) / 500));
        if (appear <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(tw.cx, tw.cy - hh * 1.3);
        ctx.lineTo(tw.cx + hw * 1.3, tw.cy);
        ctx.lineTo(tw.cx, tw.cy + hh * 1.3);
        ctx.lineTo(tw.cx - hw * 1.3, tw.cy);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,255,255,${0.035 * appear})`;
        ctx.fill();
      }
      // Towers.
      let scanned = 0;
      for (const tw of towers) {
        const appear = easeOut(clamp01((t - tw.foundAt) / 450));
        if (appear <= 0) continue;
        const grow = easeOut(clamp01((t - tw.scannedAt) / 650));
        if (t >= tw.scannedAt) scanned++;
        const h = (4 + (tw.target - 4) * grow) * appear;
        const base = mix(RGB.seed, RGB[tw.verdict], grow);
        const flash = 1 - clamp01((t - tw.scannedAt) / 420);
        // left face
        ctx.beginPath();
        ctx.moveTo(tw.cx - hw, tw.cy - h);
        ctx.lineTo(tw.cx, tw.cy + hh - h);
        ctx.lineTo(tw.cx, tw.cy + hh);
        ctx.lineTo(tw.cx - hw, tw.cy);
        ctx.closePath();
        ctx.fillStyle = shade(base, -0.18);
        ctx.fill();
        // right face
        ctx.beginPath();
        ctx.moveTo(tw.cx + hw, tw.cy - h);
        ctx.lineTo(tw.cx, tw.cy + hh - h);
        ctx.lineTo(tw.cx, tw.cy + hh);
        ctx.lineTo(tw.cx + hw, tw.cy);
        ctx.closePath();
        ctx.fillStyle = shade(base, -0.38);
        ctx.fill();
        // top face
        ctx.beginPath();
        ctx.moveTo(tw.cx, tw.cy - hh - h);
        ctx.lineTo(tw.cx + hw, tw.cy - h);
        ctx.lineTo(tw.cx, tw.cy + hh - h);
        ctx.lineTo(tw.cx - hw, tw.cy - h);
        ctx.closePath();
        ctx.fillStyle = shade(base, 0.22);
        ctx.fill();
        if (flash > 0 && t >= tw.scannedAt && !reduceMotion) {
          ctx.fillStyle = `rgba(255,255,255,${0.7 * flash})`;
          ctx.fill();
        }
      }
      // Scan beam: a glowing plane sweeping across the city.
      if (!reduceMotion && t >= BEAM_START && t <= BEAM_END + 300) {
        const from = bounds.minX - 40;
        const to = bounds.maxX + 40;
        const bx = from + ((t - BEAM_START) / (BEAM_END - BEAM_START)) * (to - from);
        const g = ctx.createLinearGradient(bx - 70, 0, bx + 70, 0);
        g.addColorStop(0, 'rgba(159,176,255,0)');
        g.addColorStop(0.5, 'rgba(210,220,255,0.42)');
        g.addColorStop(0.52, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.54, 'rgba(210,220,255,0.42)');
        g.addColorStop(1, 'rgba(159,176,255,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(bx - 70, bounds.minY - 60, 140, bounds.maxY - bounds.minY + 120);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // HUD (direct DOM writes: no React re-render per frame).
      const total = towers.length;
      const pct = t < BEAM_START ? Math.min(0.12, (t / BEAM_START) * 0.12) : 0.12 + 0.88 * (scanned / total);
      if (barRef.current) barRef.current.style.width = `${Math.round(pct * 100)}%`;
      if (progressRef.current) {
        progressRef.current.textContent = t < BEAM_START ? `Finding pages · ${towers.filter((x) => t >= x.foundAt).length} found` : scanned < total ? `Analysing pages · ${scanned} / ${total}` : `Scan complete · ${total} pages · 2,522 files`;
      }
      const scoreP = easeOut(clamp01((t - SCORE_AT) / 1300));
      if (scoreRef.current) scoreRef.current.textContent = String(Math.round(FINAL_SCORE * scoreP));
      if (gradeRef.current) gradeRef.current.style.opacity = scoreP >= 1 ? '1' : '0';

      // Chips follow their towers; visibility changes are rare, so state updates stay rare.
      const now = chips.filter((c) => t >= towers[c.index]!.scannedAt + 150 && t < LOOP_MS - 650).map((c) => c.index);
      setVisibleChips((prev) => (prev.length === now.length && prev.every((v, i) => v === now[i]) ? prev : now));
      for (const c of chips) {
        const el = chipRefs.current.get(c.index);
        const tw = towers[c.index]!;
        if (!el) continue;
        el.style.left = `${originX + tw.cx * zoom}px`;
        el.style.top = `${originY + (tw.cy - tw.target - 10) * zoom}px`;
      }
    },
    [reduceMotion, dim],
  );

  // Animation loop with pause, loop restart and pointer parallax.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    let size = { w: wrap.clientWidth, h: wrap.clientHeight };
    const ro = new ResizeObserver(([e]) => {
      size = { w: Math.max(320, e!.contentRect.width), h: Math.max(320, e!.contentRect.height) };
    });
    ro.observe(wrap);
    let start = performance.now();
    let pausedAt: number | null = null;
    let last = 0;
    const frame = (now: number) => {
      if (pausedRef.current) {
        if (pausedAt === null) pausedAt = now;
        draw(last, size);
      } else {
        if (pausedAt !== null) {
          start += now - pausedAt;
          pausedAt = null;
        }
        let t = now - start;
        if (t >= LOOP_MS && !reduceMotion) {
          start = now;
          t = 0;
          setGeneration((g) => g + 1);
        }
        last = t;
        const p = pointer.current;
        p.x += (p.tx - p.x) * 0.05;
        p.y += (p.ty - p.y) * 0.05;
        draw(t, size);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onMove = (e: PointerEvent) => {
      if (reduceMotion || !window.matchMedia('(pointer: fine)').matches) return;
      const r = wrap.getBoundingClientRect();
      pointer.current.tx = ((e.clientX - r.left) / r.width - 0.5) * -18;
      pointer.current.ty = ((e.clientY - r.top) / r.height - 0.5) * -10;
    };
    wrap.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener('pointermove', onMove);
    };
  }, [draw, reduceMotion]);

  const { towers, chips } = city.current;
  return (
    <div ref={wrapRef} className={`stage ${dim ? 'stage--dim' : ''}`}>
      <canvas ref={canvasRef} className="stage__canvas" role="img" aria-label="Animated illustration: the pages of a site rise as towers, a scan beam colours each one by its result and the ADA / WCAG score settles at 94." />
      <div className="stage__hud stage__hud--tl" aria-hidden="true">
        <span className="mono">SCAN 0268 · ecomback.com</span>
        <span className="stage__cursor" />
      </div>
      <div className="stage__hud stage__hud--bl" aria-hidden="true">
        <span className="stage__bar">
          <span ref={barRef} />
        </span>
        <span ref={progressRef} className="mono">
          Finding pages
        </span>
      </div>
      <div className="stage__hud stage__hud--br" aria-hidden="true">
        <span className="stage__score">
          <span ref={scoreRef}>0</span>
          <small>/100</small>
        </span>
        <span className="mono">
          ADA / WCAG score <span ref={gradeRef} className="stage__grade">Grade A</span>
        </span>
      </div>
      <AnimatePresence>
        {chips
          .filter((c) => visibleChips.includes(c.index) && towers[c.index])
          .map((c) => (
            <motion.div
              key={`${generation}-${c.index}`}
              ref={(el: HTMLDivElement | null) => {
                if (el) chipRefs.current.set(c.index, el);
                else chipRefs.current.delete(c.index);
              }}
              className={`callout callout--${c.verdict}`}
              aria-hidden="true"
              initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
            >
              <span className="callout__path">{c.path}</span>
              <span className="callout__text">{c.text}</span>
            </motion.div>
          ))}
      </AnimatePresence>
      {!reduceMotion && (
        <button
          type="button"
          className="stage__pause"
          aria-pressed={paused}
          onClick={() => {
            pausedRef.current = !pausedRef.current;
            setPaused(pausedRef.current);
          }}
        >
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {paused ? 'Play' : 'Pause'}
        </button>
      )}
    </div>
  );
}
