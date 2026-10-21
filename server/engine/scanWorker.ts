/**
 * Scan worker thread (Plan.md §13 "scan workers"): each scan runs off the main thread, so CPU-heavy
 * analysis (HTML/CSS validation, axe result processing, parsing) never blocks the API or the UI.
 * The worker has its own SQLite connection and Chrome instance; events are relayed to the main thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { syncRuleCatalog } from './rules/catalog.js';
import { runScan } from './scanRunner.js';
import { closeBrowser } from './browser.js';

const { scanId } = workerData as { scanId: number };

// Graceful shutdown (server restart): close this worker's Chrome so no browser process is orphaned.
// Crawl state is saved every few seconds, so the scan resumes where it left off on the next start.
parentPort?.on('message', (msg: unknown) => {
  if ((msg as { type?: string } | null)?.type === 'shutdown') {
    void closeBrowser().finally(() => process.exit(0));
  }
});
parentPort?.unref(); // the listener must not keep a finished worker alive
syncRuleCatalog();
try {
  await runScan(scanId);
} finally {
  await closeBrowser();
}
