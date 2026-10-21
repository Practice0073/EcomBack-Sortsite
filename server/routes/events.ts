import type { Request, Response } from 'express';
import { authed } from '../auth/session.js';
import { bus, type AppEvent } from '../lib/events.js';
import { q } from '../db/index.js';

/** Server-Sent Events: live scan/map progress and notifications for the signed-in account (Plan.md §12). */
export function eventsHandler(req: Request, res: Response) {
  req.socket.setTimeout(0);
  const user = authed(req);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const visibleSite = (siteId: number) => !user.client_id || q.get('SELECT id FROM sites WHERE id = ? AND client_id = ?', [siteId, user.client_id]) !== undefined;
  const onEvent = (e: AppEvent) => {
    if (e.accountId !== user.account_id) return;
    if (e.type === 'notification' && e.userId && e.userId !== user.id) return;
    if (e.type === 'scan.progress' && !visibleSite(e.progress.siteId)) return;
    if (e.type === 'scan.finished' && !visibleSite(e.siteId)) return;
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  };
  bus.on('event', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  // The response socket closing is the reliable signal that the client went away (tab closed, navigated).
  const cleanup = () => {
    clearInterval(ping);
    bus.off('event', onEvent);
  };
  res.on('close', cleanup);
  req.socket.setKeepAlive(true, 20_000);
}
