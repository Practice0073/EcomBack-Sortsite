![Ecomback](./assets/ecomback-logo.svg)

# SortSite Tools by Ecomback

Website quality scanner for Ecomback and its clients. It crawls a site (Shopify-first) and reports **accessibility (WCAG 2.0–2.2, ADA, Section 508, EN 301 549, PDF/UA)**, **broken links**, **SEO**, **browser compatibility**, **HTML/CSS standards** and **usability**. It keeps trend history, a 3D site map, a prioritized fix plan and branded exports.

- Product spec: [Plan.md](./Plan.md)
- Every change: [change-logs.md](./change-logs.md)

## Requirements

| Need | Notes |
|---|---|
| Node.js 22.5+ (tested on 25) | Uses the built-in `node:sqlite`, so no database server is needed |
| Google Chrome | Used for rendering, axe-core accessibility checks, screenshots and PDF export. Found automatically on macOS, Linux and Windows; override with `CHROME_PATH`. Without Chrome, only static checks run. |

## Run on localhost

```bash
npm install
npm run dev
```

Open **http://localhost:4000** and sign in with the account created on first run:

| Email | Password |
|---|---|
| `admin@ecomback.com` | `Ecomback-Local-2026!` |

Change the password under **Account › Security**. Seed different credentials with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_NAME` before the first run.

Production build: `npm run build && npm start`. Wipe all local data: `npm run reset`.

Checks: `npm run typecheck`, `npm run check:links` (broken-link verdict parity between TypeScript and SQL) and `npm run check:rules` (known-answer tests for the rule corrections; the in-browser part needs Chrome).

## Deploying

The scanner is a long-running Node process: it keeps Chrome open, runs scans for up to an hour, stores results in SQLite on disk and streams progress over Server-Sent Events. It therefore needs a host that runs a **persistent container or server** — Railway, Render, Fly.io, DigitalOcean App Platform, a VPS, or any Docker host. It cannot run inside Vercel's serverless functions (no persistent disk, no Chrome, time limits far below a scan).

### 1. Container (API + scanner + web app in one image)

```bash
docker compose up -d --build          # http://localhost:4000
# or
docker build -t sortsite-tools .
docker run -d -p 4000:4000 -v sortsite-data:/data --shm-size=1g \
  -e BASE_URL=https://scan.example.com -e SECRET_KEY='long random string' sortsite-tools
```

The image installs Chromium, builds the web app and runs as the unprivileged `node` user. Keep the `/data` volume: it holds the database, screenshots and exports. Set `BASE_URL` to the public https address (email links, OAuth metadata, cookie security), `SECRET_KEY` so stored credentials survive a rebuild, and `TRUST_PROXY=1` when a proxy or PaaS sits in front (the Dockerfile sets it).

### 2. Vercel in front (optional)

If you want the app on a Vercel domain, deploy the **web app only** to Vercel and point it at the container: `vercel.json` builds `dist/web` and rewrites `/api/*`, `/media/*`, `/oauth/token`, `/oauth/revoke` and `/.well-known/*` to the API host, so the browser sees one origin and sign-in cookies work unchanged. Replace `https://sortsite-api.example.com` in `vercel.json` with your container's https address, and set the container's `BASE_URL` to the Vercel address. Long-lived event streams are not guaranteed through proxies, so the web app falls back to polling the scan list every 5 seconds whenever the stream drops.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port (Vite HMR uses PORT+1) |
| `BASE_URL` | `http://localhost:PORT` | Public address: email links, OAuth metadata; session cookies are `Secure` in production unless this is `http://` |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` setting (`1` behind one proxy/PaaS) so client IPs come from `X-Forwarded-For` |
| `DATA_DIR` | `./data` | Database, screenshots, exports, outbox |
| `CHROME_PATH` | auto-detected | Chrome/Chromium executable |
| `CHROME_ARGS` | unset | Extra Chrome flags, e.g. `--no-sandbox --disable-gpu` in containers |
| `PAGE_CONCURRENCY` / `SCAN_CONCURRENCY` | `4` / `2` | Pages rendered in parallel per scan / scans in parallel |
| `SECRET_KEY` | random file in `data/.secret-key` | AES-256-GCM key for stored credentials and 2FA secrets |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | see above | First-run administrator |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | unset | Real email delivery. Without these, emails go to **Help › Email Outbox**. |
| `SCANNER_IPS` | `127.0.0.1 (local development)` | Comma-separated egress IPs shown on the Billing page for allowlisting |
| `AUDIT_RETENTION_DAYS` | `183` | Audit-log retention (about 6 months) |

## REST API

All endpoints live under `/api/v1` (Plan.md §12). For scripts, create a token under **Account › Settings › API tokens** and send it as a bearer token:

```bash
curl -H "Authorization: Bearer sst_…" http://localhost:4000/api/v1/sites
curl -H "Authorization: Bearer sst_…" -H "Content-Type: application/json" \
     -d '{"url":"https://example.com","scope":"site"}' http://localhost:4000/api/v1/scans
```

Live progress is streamed over Server-Sent Events at `/api/v1/events`.

## Connected apps (OAuth 2.0)

Other Ecomback tools, first the **Ecomback Remediation Platform**, connect through OAuth 2.0 (authorization code + PKCE) instead of shared tokens:

1. *Settings › Connected apps* → **Add Remediation Platform** → **Register app** → copy the `SORTSITE_*` lines into the other app's `.env` and restart it.
2. In the other app, press **Connect SortSite Tools**. The user signs in here, sees a consent screen and presses **Allow and connect**.
3. The app gets a scoped token (`scans:read`, `scans:write`) limited to scan and report endpoints. Disconnect it from either side.

Endpoints: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, metadata at `/.well-known/oauth-authorization-server`.

## Architecture

```
web/            React + TypeScript SPA (Vite)      — screens, design system, 3D site map
server/
  routes/       REST API (auth, sites/scans, reports, exports, sitemaps, account, admin, SSE)
  engine/       crawler, Chrome renderer, analyzers, rule catalog, queue, scheduler
  reports/      report data model + Word/PDF/HTML/Excel/CSV/JSON exporters
  auth/ lib/    sessions, CSRF, crypto (scrypt, AES-GCM, TOTP), audit, quotas
shared/         types and scan options shared by server and UI
assets/         Ecomback logo files
```

The job queue lives in SQLite, so a restart resumes interrupted scans from their saved crawl state.

Deployment files: `Dockerfile`, `docker-compose.yml`, `.dockerignore` (container), `vercel.json` (optional Vercel front end).

## How results are counted

- **Pages with issues** (the gauges and rings) = pages with at least one *priority* or *other* finding. Warnings are listed but never counted. The same definition is used live while a scan runs ("so far"), in the finished report, in exports and on the Dashboard.
- **Priority** = WCAG Level A failures, broken links and files, server errors, missing titles/viewport. **Other** = Level AA/AAA failures, HTML/CSS validation, SEO and usability problems. **Warnings** = best practices and findings that need a person to confirm.
- **Broken links**: on the scanned site every failed request is reported. On other people's sites only 404/410 and persistent 5xx count; refused requests (400, 401, 403, 405, 429, bot protection), certificate chains Node cannot verify and timeouts are listed under *Diagnostics › Links that could not be verified* instead. Every failed link is checked a second time before the report is built.

## Not in this version

- Billing plans and online payments (deferred by the owner). The Billing page shows quotas, usage and scanner IPs.
- The benchmark ("better/worse than average") blends local scans with a provisional 45% baseline until 20+ sites have been scanned (see Plan.md §18.2).
- Before launch, clear the use of the name "SortSite" with legal (Plan.md §18.1).
