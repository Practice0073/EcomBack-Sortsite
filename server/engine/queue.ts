import { Worker } from 'node:worker_threads';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { bus, isRelayedEvent } from '../lib/events.js';
import { runSitemap } from './sitemapRunner.js';

const running = new Set<string>();
const workers = new Set<Worker>();
let shuttingDown = false;
let ticking = false;

/**
 * Job queue backed by the database: queued scans/sitemaps are picked up in order, respecting global and
 * per-plan concurrency. Because state lives in SQLite, a crash or restart never loses jobs.
 */
export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    while (running.size < config.scanConcurrency) {
      const job = nextJob();
      if (!job) break;
      const key = `${job.kind}:${job.id}`;
      running.add(key);
      if (job.kind === 'scan') q.run("UPDATE scans SET status = 'running' WHERE id = ? AND status = 'queued'", [job.id]);
      else q.run("UPDATE sitemap_runs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?", [nowIso(), job.id]);
      const work = job.kind === 'scan' ? runScanInWorker(job.id) : runSitemap(job.id);
      void work.finally(() => {
        running.delete(key);
        void tick();
      });
    }
  } finally {
    ticking = false;
  }
}

/** Run one scan in a worker thread; resolves when the thread exits. A crashed worker marks the scan failed. */
function runScanInWorker(scanId: number): Promise<void> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./scanWorker.ts', import.meta.url), { workerData: { scanId } });
    workers.add(worker);
    worker.on('message', (msg: unknown) => {
      if (isRelayedEvent(msg)) bus.emitEvent(msg.event);
    });
    worker.on('error', (e) => console.error(`[scan ${scanId}] worker error`, e));
    worker.on('exit', (code) => {
      workers.delete(worker);
      if (shuttingDown) return resolve(); // stays 'running'; recovered and resumed on next start
      if (code !== 0) {
        q.run("UPDATE scans SET status = 'failed', finished_at = ?, error = ? WHERE id = ? AND status = 'running'", [nowIso(), `Scan worker stopped unexpectedly (exit code ${code}).`, scanId]);
      }
      resolve();
    });
  });
}

function nextJob(): { kind: 'scan' | 'map'; id: number } | null {
  // Per-account concurrency (plan.concurrent_scans) — skip accounts already at their limit.
  const scan = q.get<{ id: number }>(
    `SELECT sc.id FROM scans sc JOIN sites s ON s.id = sc.site_id JOIN accounts a ON a.id = s.account_id JOIN plans p ON p.id = a.plan_id
      WHERE sc.status = 'queued'
        AND (SELECT COUNT(*) FROM scans x JOIN sites y ON y.id = x.site_id WHERE y.account_id = s.account_id AND x.status = 'running') < p.concurrent_scans
      ORDER BY sc.queued_at, sc.id LIMIT 1`,
  );
  if (scan && !running.has(`scan:${scan.id}`)) return { kind: 'scan', id: scan.id };
  const map = q.get<{ id: number }>("SELECT id FROM sitemap_runs WHERE status = 'queued' ORDER BY queued_at, id LIMIT 1");
  if (map && !running.has(`map:${map.id}`)) return { kind: 'map', id: map.id };
  return null;
}

/** Crash recovery: anything left "running" by a previous process is re-queued and resumes from saved state. */
export function recoverInterruptedJobs() {
  const scans = q.run("UPDATE scans SET status = 'queued' WHERE status = 'running'").changes;
  const maps = q.run("UPDATE sitemap_runs SET status = 'queued' WHERE status = 'running'").changes;
  if (scans || maps) console.log(`[queue] recovered ${scans} scan(s) and ${maps} sitemap run(s) interrupted by a restart`);
}

/** Ask every scan worker to close its Chrome and exit; give up after 5 s. */
export async function shutdownWorkers() {
  shuttingDown = true;
  const exits = [...workers].map(
    (w) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          void w.terminate();
          resolve();
        }, 5000);
        w.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
        w.postMessage({ type: 'shutdown' });
      }),
  );
  await Promise.all(exits);
}

export const isRunning = (kind: 'scan' | 'map', id: number) => running.has(`${kind}:${id}`);
