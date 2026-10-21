import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import './db/index.js';
import { syncRuleCatalog } from './engine/rules/catalog.js';
import { loadAuth, requireAuth } from './auth/session.js';
import { authRouter, securityRouter } from './routes/auth.js';
import { sitesRouter } from './routes/sites.js';
import { reportsRouter } from './routes/reports.js';
import { accountRouter } from './routes/account.js';
import { adminRouter } from './routes/admin.js';
import { sitemapsRouter } from './routes/sitemaps.js';
import { exportsRouter } from './routes/exports.js';
import { oauthApiRouter, oauthPublicRouter } from './routes/oauth.js';
import { eventsHandler } from './routes/events.js';
import { errorHandler, HttpError } from './lib/http.js';
import { recoverInterruptedJobs, shutdownWorkers, tick } from './engine/queue.js';
import { startScheduler } from './engine/scheduler.js';
import { closeBrowser } from './engine/browser.js';
import { refreshStoredStats } from './engine/stats.js';
import { ensureSeed } from './scripts/seedData.js';

syncRuleCatalog();
ensureSeed();
refreshStoredStats();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Security headers for our own UI (Plan.md §10/§14).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(loadAuth);

// ── OAuth 2.0 for connected apps (token/revoke/metadata are called server-to-server) ──
app.use(oauthPublicRouter);

// ── API v1 ────────────────────────────────────────────────────────────────────
const api = Router();
api.use('/auth', authRouter);
api.get('/health', (_req, res) => res.json({ ok: true, chrome: !!config.chromePath, version: '1.0.0' }));
api.use(requireAuth);
api.use('/account', securityRouter);
api.get('/events', eventsHandler);
api.use(sitesRouter);
api.use(reportsRouter);
api.use(accountRouter);
api.use(adminRouter);
api.use(sitemapsRouter);
api.use(exportsRouter);
api.use(oauthApiRouter);
api.use((_req, _res, next) => next(new HttpError(404, 'Unknown API endpoint.')));
app.use('/api/v1', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Use /api/v1.' }));

// ── Protected media (screenshots, client logos) ───────────────────────────────
app.use('/media', requireAuth, (req, res, next) => {
  const [, dir, file] = req.path.split('/');
  const base = dir === 'screenshots' ? config.screenshotsDir : dir === 'uploads' ? config.uploadsDir : null;
  if (!base || !file || file.includes('..')) return next(new HttpError(404, 'Not found'));
  const full = path.join(base, path.basename(file));
  if (!fs.existsSync(full)) return next(new HttpError(404, 'Not found'));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(full);
});

// ── Frontend ──────────────────────────────────────────────────────────────────
if (config.isProd) {
  const dist = path.join(config.root, 'dist/web');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(config.root, 'vite.config.ts'), server: { middlewareMode: true, hmr: { port: config.port + 1 } }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.use(errorHandler);

recoverInterruptedJobs();
startScheduler();
void tick();

const server = app.listen(config.port, () => {
  console.log(`\n  SortSite Tools by Ecomback  →  ${config.baseUrl}`);
  console.log(`  Chrome: ${config.chromePath ?? 'NOT FOUND (static checks only — set CHROME_PATH)'}`);
  console.log(`  Data:   ${config.dataDir}\n`);
});

const shutdown = async () => {
  server.close();
  await shutdownWorkers();
  await closeBrowser();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
