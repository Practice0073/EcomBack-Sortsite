import { EventEmitter } from 'node:events';
import { isMainThread, parentPort } from 'node:worker_threads';
import type { ScanProgress } from '../../shared/types.js';

export type AppEvent =
  | { type: 'scan.progress'; accountId: number; progress: ScanProgress }
  | { type: 'scan.finished'; accountId: number; scanId: number; siteId: number; status: string }
  | { type: 'sitemap.progress'; accountId: number; sitemapId: number; runId: number; status: string; pagesFound: number; pagesDone: number; currentUrl: string | null }
  | { type: 'notification'; accountId: number; userId: number | null; title: string; body: string; kind: string; link: string | null };

class Bus extends EventEmitter {
  /** In a scan worker thread, events are posted to the main thread, which re-emits them to SSE clients. */
  emitEvent(e: AppEvent) {
    if (!isMainThread && parentPort) parentPort.postMessage({ kind: 'app-event', event: e });
    else this.emit('event', e);
  }
}

/** In-process event bus feeding the SSE stream (/api/v1/events). */
export const bus = new Bus();
bus.setMaxListeners(500);

export const isRelayedEvent = (msg: unknown): msg is { kind: 'app-event'; event: AppEvent } =>
  typeof msg === 'object' && msg !== null && (msg as { kind?: unknown }).kind === 'app-event';
