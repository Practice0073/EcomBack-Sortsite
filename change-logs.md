![Ecomback Logo](./assets/ecomback-logo.svg)

# SortSite Tools by Ecomback: Change Log

Every change to this project is recorded here, newest first. Each entry lists what changed, why, the files touched and how it was verified.
Scope source: [Plan.md](./Plan.md). The Office (.docx) remediation plans are **out of scope** for this project (owner decision, 19 Oct 2026).

Format: `## [version] — date`, then **Added / Changed / Fixed / Verified** sections.

---

## Railway deployment — 26 Oct 2026

Owner request: host the scanner on Railway behind the Vercel web app.

### Fixed
- Sign-in showed **"[object Object]"** on the Vercel deployment: when the API host is unreachable, Vercel's rewrite answers `502` with `{"error":{"code":"502","message":…}}`, and the web client displayed that object. Non-string `error` bodies now fall back to "Cannot reach the server…" (502–504) or "Request failed (status)". *File:* `web/src/lib/api.ts`.

### Changed
- `Dockerfile`: removed `VOLUME ["/data"]`. Railway's builder rejects the `VOLUME` instruction; `/data` is now mounted at run time (Railway volume, `docker run -v`, or the named volume in `docker-compose.yml`, which already mounts it explicitly).

### Verified
- `docker-compose.yml` and the README `docker run` example both mount `/data` explicitly, so local container runs keep their data.

---

## Repository move — 26 Oct 2026

Owner request: move the code to the GitHub repository that will be connected to Vercel.

### Changed
- Git remote `origin` now points to `https://github.com/Practice0073/EcomBack-Sortsite.git`; the previous remote (`ecomback-official/PM-sortsite`) is kept as `old-origin`. All pending work (v1.1.0 and later UI changes) committed and pushed to `main`. No code changes.

### Verified
- `npm run typecheck` clean; `npm run build` produces `dist/web` (the Vercel build command and output directory in `vercel.json`).
- No `.env`, database or `data/` files are tracked (`.gitignore`).

---

## [1.1.0] — 22 Oct 2026: Accurate results, live issue percentages, report overview, deployment

Owner request: "issue percent should populate accordingly", a more mature UI/UX, and a path to publishing (Vercel).

### Why the percentages were wrong
Every scanned site showed 98–100% of pages with issues and ~100% with *priority* issues. Queries over the stored results found rules firing on every page that were false positives; after correction, ecomback.com's priority pages went from 98.2% to 12.7% and its ADA/WCAG score from 53 to 65; the Shopify Dawn demo store goes from 100% priority pages to 0% (score 100).
- **"Page title missing" on 100% of ecomback.com pages** — the pages have titles. An `<img>` (tracking pixel) inside `<head>` makes the HTML parser close `<head>` early, so `$('head title')` found nothing. All title lookups now use `$('title')`. *Files:* `server/engine/analyzers/search.ts`, `accessibility.ts`, `scanRunner.ts`.
- **Broken links on 100% of pages** — facebook.com answers `400` to anything that is not a browser (a footer link on every page), and a government site with an incomplete certificate chain (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) was "broken" although browsers open it. New verdict: on the scanned site every failure is broken; on other sites only 404/410 and persistent 5xx are broken, while refused requests (400/401/403/405/429…), certificate problems, reset sockets, temporary DNS failures and timeouts are "could not verify" (listed in Diagnostics with the reason). `BROKEN_SQL` is NULL-safe so `NOT BROKEN_SQL` works; `npm run check:links` proves the TypeScript and SQL forms agree on 74 combinations. *File:* `server/engine/linkStatus.ts`.
- **Browser compatibility: `cursor: pointer` / `resize` "not supported on iPhone/iPad"** on every page — touch browsers have no pointer or resize handles, so nothing changes for visitors; likewise `autocapitalize`/`inputmode`/`enterkeyhint` on desktop browsers. Both are skipped. *File:* `server/engine/analyzers/compatibility.ts`.
- **CSS "Unknown property src / font-display / unicode-range"** and **"device-width is not a valid value for width"** — descriptors inside `@font-face` / `@viewport` were validated as properties. Declarations directly inside at-rules now use css-tree's descriptor grammar; unknown vendor at-rules are skipped. *File:* `server/engine/analyzers/standards.ts`.
- **F87 "text inserted with CSS" on every ecomback.com page** — Elementor's `elementor-screen-only` helper (1×1 px, clipped) gets `::after` content for device detection. Visually hidden elements (clip, 1 px, opacity 0, aria-hidden) are no longer F87 failures. **F24** no longer treats links styled `color: currentColor`/`inherit` as browser-coloured (Dawn's product cards: 260 false findings on 14 pages). *File:* `server/engine/cssTechniques.ts`.
- **"Text is too small" for `font-size: 0`** (the hide-text technique) is skipped. *File:* `server/engine/browser.ts`.
- **`<ul role="list">` reported as redundant ARIA** (216 warnings on 14 Dawn pages) — it is the documented VoiceOver fix. **"Meta description missing (Bing)"** is now *other*, like the Google rule; as *priority* it made clean stores 100% red. *Files:* `server/engine/analyzers/accessibility.ts`, `server/engine/rules/catalog.ts`.

### Added
- **Stored results repaired** (`server/engine/maintenance.ts`, meta key `results-version`): the corrected rules are applied to finished scans at start-up (title findings on pages with a title, refused links, pointer-only CSS, descriptors, font-size 0, hidden F87, list roles, Bing severity); per-page counters and statistics are recomputed, link diagnostics rebuilt, and each report gets a "Results updated by newer rules" diagnostic with a cumulative tally. On this database: 20,216 findings removed and 24 reclassified across 5 scans.
- **Failed links are checked a second time** (`recheckFailedLinks`) after a pause, before the report is built; links that answer normally are not reported as broken (diagnostic "Failed links checked a second time"). *File:* `server/engine/scanRunner.ts`.
- **Live issue percentages**: `issue_pct` / `priority_pct` / `other_pct` are updated with every progress event (same definition as the finished report) and carried in `ScanProgress.issuePct`; Home, Scans and Scan History show a live ring ("100% so far", *Live* badge) while a scan runs. A site whose last scan failed shows *Failed* and the reason instead of "Never". *Files:* `scanRunner.ts`, `shared/types.ts`, `server/routes/dto.ts`, `web/src/pages/Home.tsx`, `Scans.tsx`, `History.tsx`, `web/src/components/ui.tsx`, `web/src/styles/pages.css`.
- **Report overview**: severity legend; "scan at a glance" strip (pages, files, rules, issue types, pages with priority issues); change since the previous scan (percentage points, score delta, link to Compare); **Most widespread issues** (top failing rules with reach bars, category, theme-level badge); the Compatibility card lists all seven browsers (it cut the list at six). Issue rings read as a traffic light (≤5% green, ≤30% amber, else red). `ReportSummary` gains `issueTypes`, `topIssues`, `previous`. *Files:* `web/src/pages/report/Overview.tsx`, `web/src/styles/report.css`, `server/reports/data.ts`, `shared/types.ts`.
- **Inventory** file lists use the link verdict (broken / could not verify / ok) instead of "status ≥ 400". *Files:* `server/reports/data.ts`, `web/src/pages/report/Pages.tsx`, `context.tsx`.
- **Polling fallback for live events**: when the SSE stream fails twice (proxies, Vercel rewrites), the leader tab polls `/scans` every 5 s and synthesises the same events; it stops when the stream reconnects. *File:* `web/src/lib/app.tsx`.
- **Deployment**: `Dockerfile` (Node 22 + Chromium, unprivileged user, health check), `docker-compose.yml` (persistent `/data` volume, 1 GB shm), `.dockerignore`, `vercel.json` (web app on Vercel with `/api`, `/media`, `/oauth/token|revoke`, `/.well-known` rewritten to the API host) and a README "Deploying" section. New settings `TRUST_PROXY` and `CHROME_ARGS`; session cookies are `Secure` in production unless `BASE_URL` is `http://`; `/api/v1/health` reports the package version. *Files:* `server/config.ts`, `server/index.ts`, `server/auth/session.ts`, `server/engine/browser.ts`, `README.md`.
- **Checks**: `npm run check:links` (verdict parity) and `npm run check:rules` (known-answer tests for every correction above; the in-browser part needs Chrome). Version 1.1.0 (`package.json`, engine version, sidebar footer via `__APP_VERSION__`, release-notes entry added to existing databases). *Files:* `server/scripts/checkLinkVerdicts.ts`, `checkRules.ts`, `seedData.ts`, `vite.config.ts`, `web/src/vite-env.d.ts`.
- **Sign-in pages redesigned** (23 Oct; first pass copied the owner's Client & Team Portal reference, then the owner asked for something unique and more elite). The final design is a dark cinematic stage built from SortSite's own signature visual: the isometric page-tower map, alive. Pages rise as they are found, a scan beam sweeps across and colours each tower by its result (periwinkle clean, amber other, coral priority), findings surface as callouts (`/products/linen-shirt · Image without alt text · WCAG 1.1.1` …), the HUD counts pages and files and the ADA / WCAG score settles at 94 / Grade A; the loop restarts with a slightly different site every 14 s, with pointer parallax. Over it, a frosted glass card: monospace overline, editorial headline ("Welcome back." + an italic Instrument Serif accent in coral), fields, brand-navy button (white in the dark theme), "Forgot password?", and the "Need an account?" note (billing@ecomback.com / 1-818-839-8888). Top bar: brand lockup, theme toggle, "Contact Ecomback"; footer: legal links and version. Two-factor, forgot/reset-password and OAuth consent share the layout with their own headlines; the card never greys its button while fields are empty (a message explains what is missing). Accessibility: canvas described, HUD and callouts aria-hidden, a Pause control that freezes the timeline in place, reduced motion shows the finished state with no autoplay. Performance: canvas 2D for the city, DOM writes for the HUD, framer-motion only for callouts; the stage is a lazy chunk so signed-in pages never load it. `ThemeToggle` moved to `web/src/components/ThemeToggle.tsx`. *Files:* `web/src/components/ScanStage.tsx` (new), `web/src/pages/Login.tsx`, `web/src/pages/OAuthConsent.tsx`, `web/src/styles/auth.css` (new), `web/src/styles/pages.css` (old auth block removed), `web/src/components/AppShell.tsx`, `web/index.html` (Instrument Serif).

### Why Vercel alone is not possible
The scanner keeps Chrome open, runs scans for up to an hour, stores results in SQLite on disk and streams progress; Vercel's serverless functions have no persistent disk, no Chrome and time limits far below a scan. The container runs anywhere (Railway, Render, Fly.io, a VPS); Vercel can serve the web app in front of it through the rewrites in `vercel.json` (replace `sortsite-api.example.com`).

### Verified
- `tsc --noEmit` clean; `vite build` succeeds; `npm run check:links` OK (74 combinations, 16 spot checks); `npm run check:rules` 16/16.
- Folder scan of the Shopify Dawn demo (`/collections/`, 14 pages) under the new rules: 0 priority pages (was 100%), 0 F24 findings (was 260), 0 cursor/resize/@font-face findings, score 100. Live `issuePct` observed in the API from the first page onward and on the Scans and History screens ("100% so far", *Live*); the Scans table has no horizontal overflow at 1440 px with a running row. Test sites (ecomback.com page-links, Dawn demo, W3C demo) were deleted afterwards.
- A test scan of www.ecomback.com failed with `UND_ERR_CONNECT_TIMEOUT`: this Mac could not reach ecomback.com at all at the time (curl timed out too); the Scans list now shows *Failed* with the reason.
- Screenshots (1440 px light and dark, 390 px) of Home, Scans, Scan History, Overview (ecomback.com and Dawn), Diagnostics, Inventory and Dashboard reviewed after the changes.
- Sign-in pages: screenshots at 1920/1440/1280 px (light and dark), 390 px and reduced motion, plus forgot/reset/consent states; headless probes confirm the timeline (finding → analysing → complete → score 94 → loop at 14 s), that Pause freezes it in place and Play resumes, that every control is clickable (hit test through the fixed layers) and that the tab order reaches every control.

---

## [1.0.0-dev.18] — 20 Oct 2026: No false accessibility issues on pages Chrome could not render

### Fixed
- **Pages that timed out in Chrome reported false Level A/AA issues.** In scan 21, two product pages hit the 180 s navigation timeout. They were then checked from raw HTML, which reported button-name, label, link-name, duplicate-id and password-autocomplete. The site's scripts provide those labels and names, and the password field is in a hidden popup. When Chrome is available but a page cannot be rendered, accessibility checks are now skipped for that page, and it is listed under Diagnostics ("render-failed"), as before. The raw-HTML fallback still runs when Chrome is not installed at all. *Files:* `server/engine/context.ts` (`renderFailed`), `server/engine/scanRunner.ts`, `server/engine/analyzers/accessibility.ts`.

### Verified
- `tsc --noEmit` is clean.
- Analyzer called directly on a page with an empty button, unlabelled input and empty link: `renderFailed: true` → no findings. Without Chrome → static fallback runs (static-fallback, html-has-lang, link-name, button-name, label).
- Scan 21 (Match PowerMapper mode) completed: 500 pages (page cap), 312 of them `?pr_prod_strat` variants, accessibility issues on 73 pages (14.6%). Level A: 8 rules on 53 pages; Level AA: 3 rules on 25 pages. The 2 render-failed pages account for the button-name, label, link-name, link-purpose and password hits.

---

## [1.0.0-dev.17] — 20 Oct 2026: Deleting a scan no longer crashes running scans

### Fixed
- **A running scan failed with "database is locked" when another scan was deleted.** Scan 19 crashed at 17:26, right after "Deleted 4 scan(s)" (audit log). Cause: `page_refs.page_id` references `scan_pages` but had no index, so deleting each page scanned the whole `page_refs` table (190k rows). Deleting one scan held SQLite's write lock for 31 s, longer than the 5 s busy timeout. Fixes:
  - New index `page_refs_page ON page_refs(page_id)` (created at startup; built in under 1 s). *File:* `server/db/schema.sql`.
  - `deleteScans` deletes child rows leaf-first in batches of 2,000, each in its own transaction, so the lock is released between batches. *File:* `server/engine/scanService.ts`.
  - `busy_timeout` raised from 5 s to 30 s, so a scan waits through a long write instead of failing. *File:* `server/db/index.ts`.

### Verified
- `tsc --noEmit` is clean.
- On a copy of the live database (`VACUUM INTO`), never the real one: deleting scan 14 the old way held the lock 31.2 s. With batching but no index, one batch still took 29.7 s (the `scan_pages` batch). With the index, deleting scan 17 (5,753 issues, 33,368 page refs, 208 pages) took 3.4 s, and the longest lock was 411 ms.
- After restart, the index exists in the live database, and the running scan 20 resumed.

---

## [1.0.0-dev.16] — 20 Oct 2026: "Match PowerMapper" results mode (default)

Owner request: results must be the same as PowerMapper.

### Added
- **Options › Reports › Results compatibility**: *Match PowerMapper* (default) or *Standard*. New option `reports.compatibility: 'powermapper' | 'standard'`; saved site options without it pick up the default.
  - **Page counting like PowerMapper.** Shopify product-recommendation links (`?pr_prod_strat=…&pr_rec_id=…&pr_rec_pid=…&pr_ref_pid=…&pr_seq=…`) are crawled and counted as separate pages, as PowerMapper does (its Oct 19 report counts these variants; 20 of its 32 F24 pages are such variants). Standard mode still strips them. Tracking parameters (utm_*, gclid, …) are stripped in both modes.
  - **Rule set like PowerMapper.** The axe rules PowerMapper does not test are skipped: `list`, `listitem` (list structure) and `target-size` (WCAG 2.2 2.5.8). Standard mode runs them.
  - *Files:* `shared/options.ts`, `server/engine/url.ts` (`normalizeUrl` gains an optional `keepParams`), `server/engine/scanRunner.ts`, `web/src/pages/EditScan.tsx`.

### Not fixable in code
- F24 on PowerMapper's Affirm "pay over time" links: Affirm renders only for US visitors, and this Mac browses from Pakistan. Matching it needs a US connection (VPN) during the scan.

### Notes
- Scan 18 ended "failed" at 17:15: a restart during my edit resumed it on code where the new constant was referenced before it was defined (`ReferenceError`, server log). Up to that point, scan 18 confirmed `accessibility.nested-interactive` on 1 page site-wide, as PowerMapper does.

### Verified
- `tsc --noEmit` is clean.

---

## [1.0.0-dev.15] — 20 Oct 2026: Button-inside-link rule; counts show failures only

Source: a live-site comparison of PowerMapper (Oct 19) vs scan 17, verified in the browser.

### Added
- **New rule: interactive element inside a link or button** (`accessibility.nested-interactive`, WCAG A 4.1.2, priority). PowerMapper flags `<button>` inside `<a>` on `/apps/subscriptions` (Appstle app); we missed it. axe's `nested-interactive` does not cover links, and the button is added by JavaScript, so the HTML validator never sees it. The check runs on the rendered DOM: any link, button, form field or focusable element inside `a[href]` or `button`. *Files:* `server/engine/rules/catalog.ts`, `server/engine/analyzers/accessibility.ts`.

### Changed
- **Page counts show failures only; "needs review" is listed separately.** A rule row read "175 pages" when only 2 pages failed. Rows now show the failing pages, with "+N to review" underneath. Section headers ("4 issues on 30 pages") count only failing findings, which now agrees with the overview gauge. Word/HTML/PDF exports say "Found on 2 pages (+206 to review)." *Files:* `web/src/pages/report/Issues.tsx`, `server/routes/reports.ts`, `server/reports/issueReport.ts`, `issueReportDocx.ts`, `issueReportHtml.ts`.
- **"Theme-level: fix once" counts only failing findings.** Contrast was labelled theme-level for 2 failing pages because 206 review pages were counted. *File:* `server/reports/data.ts`.

### Not changed (from the comparison)
- No crawl gap. `/apps/subscriptions` and `/pages/wholesale-products` are in scan 17's page list. The first had only warnings and review items until this rule existed.
- F24 (Affirm links) still differs: Affirm does not render from Pakistan (verified by the comparison, `country: PK`).

### Verified
- `tsc --noEmit` is clean.
- Rendered `/apps/subscriptions`: 1 hit, `<button class="appstle_order-detail_update-button …">` inside `<a>` (PowerMapper's element). Home page: 0.
- Scan 17 report in headless Chrome: Level A "4 issues on 30 pages" (was 35 in the comparison); Level AA "3 issues on 36 pages" (was 175); contrast "2 pages +206 to review"; no theme-level label on contrast.

---

## [1.0.0-dev.14] — 20 Oct 2026: Hidden password fields not flagged (PowerMapper parity)

### Changed
- **Password autocomplete (WCAG 1.3.5) skips password fields hidden by CSS.** glacierpeakholistics.com has a sign-up popup on every page whose password field (`#signUpForm-password`) has no `autocomplete`. The popup is closed (`display: none`), and PowerMapper's Oct 19 run does not flag it, so we flagged 202 pages where PowerMapper flagged 0. Before the DOM snapshot, Chrome now marks password inputs that are not rendered (`data-ss-hidden`), and the check skips them. Visible password fields are still checked. *Files:* `server/engine/browser.ts`, `server/engine/analyzers/accessibility.ts`.

### Verified
- `tsc --noEmit` is clean.
- Live probe of `/pages/blog`: three password inputs. `#CustomerPassword` and `#wlm-pwd` have `autocomplete="current-password"`. `#signUpForm-password` has none and is not rendered, since its ancestor is a hidden dialog.
- Full rescan (scan 17, JavaScript "All", 208 pages, 0 render failures): password autocomplete 0 pages (scan 15: 202; PowerMapper Oct 19: 0). F78 5 pages. Accessibility issues on 51 pages (24.5%).
- JavaScript-off scan 16 (208 pages) confirms the site's own accessibility script fixes issues only when JavaScript runs: with JavaScript off, contrast is confirmed on 87 pages and link purpose on 115. PowerMapper's light Oct 19 result therefore matches a JavaScript-on run.

---

## [1.0.0-dev.13] — 20 Oct 2026: Retry pages when the local network drops

### Fixed
- **Pages fell back to static-only checks after a local network blip.** In scan 15, 8 of 207 pages failed to render in Chrome: 6 with `net::ERR_NETWORK_CHANGED` / `ERR_CONNECTION_RESET` (this Mac's network) and 2 with navigation timeouts. Those pages were checked from raw HTML only, which produced false Level A hits (button-name, link-name, label, duplicate-id on 8 pages) for labels the site's JavaScript adds. `renderPage` now retries network errors twice (after 3 s and 10 s). Timeouts are not retried, which would add another 180 s. *File:* `server/engine/browser.ts`.

### Verified
- `tsc --noEmit` is clean.
- An unresolvable host retries and then reports `ERR_NAME_NOT_RESOLVED` after 15.3 s (3 attempts). `/products/ip-ha`, which failed in scan 15, renders normally (845 KB DOM).
- Scan 15 (JavaScript "All", 207 pages) after the F78 fix: F78 on 5 pages (scan 14: 201; PowerMapper Oct 17: 25, Oct 19: 3).

---

## [1.0.0-dev.12] — 20 Oct 2026: F78 focus check matches PowerMapper

### Fixed
- **F78 (WCAG 2.4.7) flagged every page.** The check treated any link with its own solid border as hiding the focus outline, so the site's menu links (`a.toggle-level`) were flagged on all 201 pages of glacierpeakholistics.com (scan 14). PowerMapper's Oct 17 report gives only two F78 reasons: a `:focus` rule that removes the outline, and "outline-color matches background". The border heuristic is removed. Each visible link (up to 400 per page) is now focused, and the check flags it when its computed focus outline has the same colour as the background behind it. The existing outline-removed-without-replacement check is unchanged. *File:* `server/engine/cssTechniques.ts`.

### Verified
- `tsc --noEmit` is clean.
- Live pages in headless Chrome, with the cross-origin stylesheets the scanner fetches: home page 0 F78 (was every menu link). `/pages/blog` flags 4 `ai-blog-button` links (outline rgb(58,44,86) on background rgb(58,44,86)). `/pages/pet-wellness-scan-information` flags the Paw-Gest and ProBio card buttons, the same elements PowerMapper lists. `/pages/scan-info` flags 1 `ai-responsive-button`, where PowerMapper lists "Explore Articles".
- Remediation Platform e2e suite rerun after the overnight sleep: 17/17 pass.

---

## [1.0.0-dev.11] — 20 Oct 2026: No leaked Chrome after sleep or restart

### Fixed
- **A Chrome process was leaked when the computer slept.** Closing the lid (00:04 → 14:48, per `pmset -g log`) dropped the scan's connection to Chrome. The scanner launched a new Chrome and carried on, but the old one kept running with the scan's four open pages. Now when the connection drops, that Chrome process is killed. *File:* `server/engine/browser.ts` (`getBrowser`).
- **A Chrome process could be orphaned on server restart.** While a worker was shutting down, a page still in progress could call `getBrowser()` after `closeBrowser()` and launch a new Chrome just before the thread exited (seen: Chrome launched 1 s before the new server started, with no parent). `closeBrowser()` is now final for its thread, and later launches are refused. *File:* `server/engine/browser.ts`.
- Not a defect: scan 14 "hung" for 15 hours only because the Mac was asleep. It resumed by itself on wake (169 → 190 pages within a minute).

### Verified
- `tsc --noEmit` is clean.
- Restarted the dev server under the new code while scan 14 was running: afterwards the only puppeteer Chrome is the new server's own, with no orphan. Scan 14 resumed from its saved crawl state.

---

## [1.0.0-dev.10] — 19 Oct 2026: Live-events console error fixed

### Fixed
- **"Failed to execute 'postMessage' on 'BroadcastChannel': Channel is closed" console error.** If the app unmounted before this tab was granted the live-events leader lock (React StrictMode mounts twice in development), the lock callback still ran afterwards. It opened an SSE stream that posted into the closed channel and was never released. Now an `AbortSignal` withdraws the queued lock request on unmount, a lock granted after unmount is released immediately, and the stream handler ignores events after disposal. *File:* `web/src/lib/app.tsx`.

### Verified
- `tsc --noEmit` is clean.
- Headless Chrome, two signed-in tabs, Home → Settings → Scans: no BroadcastChannel errors (the only errors are the expected 401s from the login page's session check), and the second tab still shows live scan progress relayed through the channel.

---

## [1.0.0-dev.9-theme] — 19 Oct 2026: Remediation Platform colour scheme, light and dark themes

### Changed
- **Colour scheme now matches the Ecomback Remediation Platform** (owner request). Light: background #f4f4f8, ink #12132b, navy #000082 primary, link #1a1ab8, and a royal-blue sidebar with coral and periwinkle glows. The active nav item has a soft highlight and a coral left bar. *Files:* `web/src/styles/tokens.css`, `components.css`, `base.css`, `pages.css`, `report.css`, `workspace.css`.
- Hard-coded colours in the CSS, charts (`TrendChart`, `Sparkline`), the Gauge and the 3D site map are replaced with tokens. Canvas and recharts code reads the tokens via `cssVar()` and redraws when the theme changes.
- The **Sidebar theme** setting is hidden from Account › Settings because the sidebar now follows the light/dark theme. The stored value is still saved and ignored.

### Added
- **Dark theme** (`:root[data-theme='dark']`, using the Remediation Platform's dark values: background #0a0b18, surface #12142a, periwinkle #8f97ff primary).
- **Sun/moon toggle** in the top bar (`aria-pressed`). The choice is saved in `localStorage` (`ss.theme`); if nothing is saved, the OS preference is used. An inline script in `web/index.html` applies the theme before first paint. *Files:* `web/src/lib/theme.ts` (new), `web/src/components/AppShell.tsx`, `web/index.html`.
- The auth pages follow the theme and show the white logo in dark mode (`web/src/pages/Login.tsx`).

### Verified
- Puppeteer screenshots at 1440 px in both themes for Home, Scans, Site, Report, Accessibility issues and Settings, compared with the Remediation Platform.
- Contrast is ≥ 4.5:1 for body text, muted text, placeholder, links, primary/success/danger button text, sidebar text, banners, tooltips and snippets in both themes. The lowest pair is the light placeholder at 4.89:1.
- `tsc --noEmit` is clean and `vite build` succeeds.

---

## [1.0.0-dev.9] — 19 Oct 2026: PowerMapper result parity (in progress) and report tabs

### Changed
- **Report Summary tabs are now Overview · Site Map · What was Tested** (owner request): the Fix Plan and Accessibility Statement tabs and the Overview shortcuts to them are removed, and old links redirect to Overview. `FixPlan.tsx` and `Statement.tsx` are kept so the tabs can be restored. *Files:* `web/src/pages/report/ReportShell.tsx`, `Overview.tsx`.
- **Accessibility severity follows the WCAG level, as in PowerMapper:** Level A failures are priority (red), Level AA/AAA failures are other (amber), and best practices and "needs review" items are warnings. Warnings are listed but no longer count towards "pages with issues". Previously the best-practice rule `aria-allowed-role` alone made every page count, giving 100%. *Files:* `server/engine/analyzers/accessibility.ts`, `server/engine/rules/catalog.ts`.
- The Shopify preset no longer skips `/apps/*` pages (app proxy pages are real customer pages, and PowerMapper scans them). *File:* `server/engine/url.ts`.

### Added
- **CSS-cascade checks implemented from the W3C technique documents** (`server/engine/cssTechniques.ts`; runs in the rendered page, and fetches cross-origin stylesheets once per scan):
  - **F24 (1.4.3/1.4.6/1.4.8):** a text colour from the browser default (links use the browser's own :link colour) on an author background, or the reverse.
  - **F78 (2.4.7):** the focus outline removed with no replacement, or a link border/outline that occludes it (W3C examples 1–3).
  - **2.2.2:** CSS animations longer than 5 s that start automatically. prefers-reduced-motion is noted but doesn't exempt them, as it is a technique for 2.3.3.
  - **F87 (1.3.1):** meaningful text inserted with CSS `::before`/`::after` (computed, so CSS that already cancels it is not flagged).
- **Static checks:** 2.4.4 non-descriptive link text ("Read more"), 2.4.2 placeholder page titles, 1.3.5 password autocomplete, redundant ARIA (`aria-disabled` + `disabled`, `aria-required` + `required`, implicit roles), and `aria-disabled` on links.

### Verified
- A known-answer fixture reproduces PowerMapper's output: an Affirm-style link and its `sr-only` span flagged for F24 with "rgb(0, 0, 238) from the browser's default settings"; a bordered button flagged for F78; an infinite ticker flagged for 2.2.2. A themed link, inherited text on a coloured box, and a 2 s animation are not flagged.
- The 2.2.2 check flags the same `.infinite-text` element PowerMapper flagged on `/pages/pet-wellness-scan-information`.
- **Not yet verified:** the full-site comparison with PowerMapper's results (rescan running).

---

## [1.0.0-dev.8] — 19 Oct 2026: Connected apps (OAuth 2.0) for the Remediation Platform

### Added
- **OAuth 2.0 authorization server for "Connected apps"**: authorization code + PKCE (S256), client authentication (HTTP Basic or client_secret_post), single-use 5-minute codes, exact-match redirect URIs (https, or http for localhost only), revocation (RFC 7009), and metadata at `/.well-known/oauth-authorization-server`. *Files:* `server/routes/oauth.ts`, schema tables `oauth_apps` / `oauth_codes`, new `api_tokens` columns `app_id` / `scope` / `code_hash` (added automatically).
- **Scopes:** `scans:read` and `scans:write`. App tokens can only reach scan, report, export and sitemap endpoints, never users, security, settings, billing or API tokens. *File:* `server/auth/session.ts`.
- **Consent screen** at `/oauth/authorize`: signs the user in first (including two-factor), names the app and exactly what it can do, offers "Not you?", and sends them back on Allow or Cancel. *File:* `web/src/pages/OAuthConsent.tsx`.
- **Settings › Connected apps**: register apps (one-click **Add Remediation Platform** preset), show the client secret once with ready-to-paste `.env` lines, rotate secrets, remove apps, list active connections with **Disconnect**, plus the developer endpoint reference. *File:* `web/src/pages/account/ConnectedApps.tsx`.
- Registered **Ecomback Remediation Platform** (redirect `http://localhost:4610/oauth/callback/sortsite`) and wrote its `SORTSITE_*` lines into the Remediation Platform's `.env` (owner-only permissions kept).

### Changed
- Personal API tokens (Settings › API tokens) no longer list or delete app connections; those live under Connected apps.

### Fixed
- The Alerts card on Settings had no inner padding (a `fieldset` reset overrode the card body). *File:* `web/src/styles/components.css`.
- The consent screen is centred when there is no side card. *Files:* `web/src/pages/Login.tsx`, `web/src/styles/pages.css`.

### Verified
- **Browser test** of the full workflow against the Remediation Platform (isolated copy on port 4611): Connect → SortSite login → consent → back, connected.
- **13/13 security checks pass:**
  - state echoed;
  - wrong PKCE verifier, wrong client secret and mismatched `redirect_uri` rejected;
  - codes are single-use, and a replayed code revokes exactly the token issued from it;
  - read-only tokens can't start scans;
  - app tokens can't reach `/users` or `/account/tokens`;
  - revoked tokens stop working;
  - http redirect URIs on non-localhost hosts are refused.
- **Import test:** a scan started from the Remediation Platform crawled 20 pages here and imported 67 findings as 41 issues.

---

## [1.0.0-dev.7] — 19 Oct 2026: Issue Report export format, scan stuck at 99%, hide Clients

### Added
- **"Issue Report" export format**, modelled on the owner's reference `PowerMapperReport.docx`. *Files:* `server/reports/issueReport.ts` (shared layout model), `issueReportDocx.ts` (Word), `issueReportHtml.ts` (HTML/PDF).
  - **Page and type:** A4 with 1" margins. Header shows the site URL with the date right-aligned; footer shows page numbers. Calibri body, Calibri Light headings.
  - **Opening:** the title, "Site quality report for … produced on …", and a summary table with red/grey bars ("N pages with … problems" plus "Totals: N URLs checked").
  - **Body:** Heading 1 per category with an intro, then Heading 2 per level with "N issues on N pages".
  - **Each issue:** a severity icon; title and description with inline code; guideline links; then per page a condensed code snippet with the offending attribute marked in red, "line N", and the page URL as a link.
  - **Same Word styles as the reference:** Title, Heading1/2, Issue, Details, Snippet, HTML Code, HTML Marked Code.
  - **Snippet shortening** matches the reference style (`<div id='csm-smart-banner-...' class='csm-sb-preferences ...' style='--csm-sb-buttons-...' aria-hidden='true'>...</div>`).
  - **Ecomback branding** (logo in the header, "SortSite Tools by Ecomback" in the footer) replaces the reference's vendor branding.
  - **Own severity icons** (red disc / amber disc / amber ring) instead of the reference's images, per the IP note in Plan.md. *File:* `server/reports/icons.ts`.
  - **By report type:** Word uses this format for Full, Issues-only, Summary (no per-page snippets) and Executive (summary table plus top fixes). HTML/PDF use it for Full, Issues-only and Summary; the Executive HTML/PDF keep the visual overview with gauges and score.
  - Repeated explanations are shown once per issue, and generic boilerplate "how to fix" text is left out.
- `assets/ecomback-logo.png`, rendered from the official SVG: the Word header fallback and the logo in emails (Gmail and Outlook block SVG).
- **Phase-aware scan progress:** "Analysing pages" (0–80%), "Checking links and files" (80–98%, with links done/total and ETA), "Building the report" (99%). *Files:* `server/engine/scanRunner.ts` (`progressOf`), `shared/types.ts`, `web/src/components/scan.tsx`; new `links_total` / `links_done` / `links_started_at` columns (added automatically to existing databases).

### Fixed
- **A scan sat at 99% for about 90 minutes** (glacierpeakholistics.com).
  - **Shared back-off:** when any external site answered 429/503, one shared external throttle slowed *every* external link check to 1 request per 10 s. Each external host now has its own throttle; back-off is capped at 3 s and speed recovers after successful responses. *File:* `server/engine/fetcher.ts`.
  - **Progress bar:** it only measured pages, so the link-check phase showed as a frozen 99%. It now has its own phase and progress (see Added).
  - **Per-link time limit:** each link check now has a hard time budget, so a server that never answers can't hold up the scan.
- **False broken links:** 401/403/429/999 responses, and 503s or timeouts from other sites, mean "blocked or rate-limited", not "missing". They are now reported in Diagnostics as "could not verify" instead of as broken links. *Files:* `server/engine/linkStatus.ts`, `scanRunner.ts`, `server/reports/data.ts`.
- **"Attempted to use detached Frame" render failures** (a page navigating itself mid-analysis): the page is now re-rendered once. *File:* `server/engine/browser.ts`.
- **Orphaned Chrome processes** after a server restart: workers now close their browser on shutdown, and the scan resumes from saved state. *Files:* `server/engine/queue.ts`, `scanWorker.ts`, `server/index.ts`.
- **Duplicate diagnostics** after an early restart: a scan restarting before its first save now clears partial data first.

### Changed
- **Clients is hidden from the sidebar for now** (owner request). The page still works by direct URL; remove `hidden: true` in `web/src/components/AppShell.tsx` to show it again.
- The old Word renderer (`server/reports/docx.ts`) was removed; nothing referenced it after the switch.

### Verified
- **Word report:** generated for the glacierpeakholistics.com scan and rendered with macOS Quick Look next to the reference. The same structure and styles appear, with 6 categories, 19 levels, 58 issues and 8,813 snippets.
- **Snippet shortening:** the `aria-hidden` snippet is character-for-character identical to the reference.
- **Executive and Summary:** both render in the new format.
- **Restart test:** a scan interrupted by a server restart left no orphaned Chrome processes and resumed, tracking links 671/671 to completion.
- `tsc` is clean.

---

## [1.0.0-dev.6] — 19 Oct 2026: Hide the Subscription menu

### Changed
- **The sidebar's Subscription group (Billing, Audit History, Users) is hidden for now** (owner request). The pages, their data and their API endpoints stay intact, and the routes still work by direct URL. To bring the group back, set `hidden: false` on the Subscription group in `web/src/components/AppShell.tsx`.
- The "Disk quota nearly full" alert now opens the **Scans** list (where old scans can be deleted) instead of the hidden Billing page. *File:* `server/lib/quota.ts`.
- The 403 diagnostic no longer points to the Billing page. *File:* `server/engine/scanRunner.ts`.

### Fixed
- A running scan's progress block widened the Date column and clipped the Issues column on the Scans list. *Files:* `web/src/styles/pages.css`, `web/src/pages/Scans.tsx`.
- **A resumed scan briefly showed "0 pages found, 0 done"** because the first progress update was sent before the saved state was restored. It now shows the restored counts immediately. *File:* `server/engine/scanRunner.ts`.

### Verified
- Sidebar screenshot shows Workspace → Account → Help with no Subscription group. The Scans list fits at 1440px with a live scan row.
- A live scan (glacierpeakholistics.com) interrupted by a server restart resumed with its pages kept and showed 117 found / 16 done straight after the restart. `tsc` is clean.

---

## [1.0.0-dev.5] — 19 Oct 2026: UI/UX polish round, scan workers, multi-tab fix

### Added
- **Report screens:** report shell with Options…/Scan Now/format dropdown/green Download and export history; Overview with compliance score; isometric 3D Site Map (zoom, pan, keyboard, table fallback); What was Tested; Issues per category with filters, expandable occurrences and "Export this view"; Inventory; Issues by Page; Diagnostics; Fix Plan; Accessibility Statement helper; before/after Compare page. *Files:* `web/src/pages/report/*`, `web/src/pages/Compare.tsx`, `web/src/styles/report.css`.
- **Scan worker threads** (Plan §13): each scan runs in its own worker thread with its own Chrome and SQLite connection, and events are relayed to the main thread. *Files:* `server/engine/scanWorker.ts`, `server/engine/queue.ts`, `server/lib/events.ts`.
- **Per-category benchmarks:** each Issues tab compares against the average for *that* category rather than the overall figure. *Files:* `server/engine/stats.ts`, `server/reports/data.ts`, `shared/types.ts`.
- **"N failing · N to review"** on issue rows where a rule has both confirmed failures and manual-review items.
- A reusable `SiteCell` (thumbnail, bold host, truncated address) used across tables. *File:* `web/src/components/ui.tsx`.
- `README.md` with run instructions, configuration and API usage; `.gitignore`.

### Fixed
- **The API froze for up to 51 s while a scan finalised**, because HTML/CSS validation ran on the web server's thread. With worker threads, the worst latency across 145 probes during a full scan is now 0.009 s.
- **The app could hang with several tabs open:** browsers allow 6 connections per host, and every tab held a live-events stream. Now one tab, elected with Web Locks, holds the stream and shares it over BroadcastChannel; the server releases closed streams immediately. *Files:* `web/src/lib/app.tsx`, `server/routes/events.ts`.
- **Contradictory numbers:** the Accessibility gauge said 5% while the "Level A" bar said 100%, and a rule row said "5 pages" while the header said "1 page". Bars and row counts now follow the same rules as the gauges, and section totals are computed from the rows they show. *Files:* `server/engine/stats.ts`, `server/routes/reports.ts`, `server/reports/data.ts`. Stored stats for existing scans are recomputed once at start-up.
- **Issues by Page "Issues ↓" sort** actually sorted by priority first; each column now sorts by what it says.
- **Mobile horizontal scroll** (Home 432px, Dashboard 1072px, What was Tested 794px at a 390px screen): hidden screen-reader text inside tables escaped its scroll box, and flex/grid children could not shrink. All pages are now 390px wide.
- The hamburger menu showed on desktop; a stray focus ring framed the main area; the sidebar product label wrapped awkwardly; the Log Out icon shrank; the Dashboard's Report button was clipped; URLs broke character by character; row "Options…" buttons were heavy primary buttons; stopped scans with 0 pages showed a 0% ring; Edit Scan's Save was enabled with no changes; the report title was truncated; "1 pages" grammar.
- Dashboard no longer loads the 378 KB chart library just for its sparklines. *File:* `web/src/components/Sparkline.tsx`.

### Verified
- Screenshots (1440px) of Home, Scans, History, Dashboard, Edit Scan, Security, Billing, report Overview, Site Map, Issues, Issues by Page and Fix Plan, reviewed after the fixes.
- The 390px overflow sweep passes on every screen (wide data tables scroll inside their own container by design).
- 8 tabs open → a 9th tab loads the Dashboard with data in 0.54 s; live scan progress appears in all 3 open tabs.
- `tsc --noEmit` is clean and `vite build` succeeds.

---

## [1.0.0-dev.4] — 19 Oct 2026: Shopify preset field test

### Verified
- Scanned Shopify's public Dawn demo store (`theme-dawn-demo.myshopify.com`) with a 20-page cap. Shopify was detected; the preset seeded `/cart`, `/collections/all`, `/collections`, `/account/login` and `/blogs/news`. Collection-scoped product links (`/collections/x/products/y`) were merged into `/products/y`, and the diagnostics recorded "Page limit reached (42 more found)" and "Checkout not scanned". There were no render or analyzer failures. ADA/WCAG score 95.

---

## [1.0.0-dev.3] — 19 Oct 2026: Engine fixes found in live testing

### Fixed
- **Chrome rendering failed on every page** (`__name is not defined`). The TypeScript runtime wraps functions with a `__name` helper that doesn't exist inside the page. A shim is now injected before and after navigation. *File:* `server/engine/browser.ts`.
- **Standards analyzer crashed** on the html-validate `deprecated` rule, because its documentation needs the message context. The context is now passed, with a safe fallback URL. Obsolete-markup rules use a generic description instead of one naming a single element. *File:* `server/engine/analyzers/standards.ts`.
- **Wrong line numbers for bare tags** (e.g. `<b>` matched the first `<B>` on the page). The locator now tries a unique opening tag first, then the element's own text, then a distinctive attribute, and returns no line rather than a wrong one. *File:* `server/engine/source.ts`.
- `setContent` no longer uses `networkidle0`, which the current Puppeteer doesn't allow there. *File:* `server/engine/browser.ts`.

### Verified
- Rescanned the W3C "BAD" demo (15 pages, 166 links). Render and analyzer failures went from 15/15 to 0. Reported line numbers match the live source: lines 1, 157, 173, 174 and 330 were checked by hand.
- All 27 report/admin API endpoints return 200. All 8 export formats download with correct MIME types and file names (PDF full/executive, Word, HTML, Excel, CSV issues/pages, JSON). The HTML summary was rendered in Chrome and the branding confirmed visually.

---

## [1.0.0-dev.2] — 19 Oct 2026: Frontend

### Added
- **Design system** in Ecomback brand tokens taken from ecomback.com: Poppins, navy `#01027F`, coral `#F44C35`, red `#AF1C08`. Dark/light sidebar, focus rings, reduced-motion support. *Files:* `web/src/styles/tokens.css`, `base.css`, `components.css`, `pages.css`.
- **Brand assets:** official logo SVG, a white variant for the dark sidebar, the "e" icon mark, and a favicon. *Files:* `assets/`, `web/public/`.
- **App shell:** sidebar with Workspace / Account / Subscription / Help groups, active pill with glow, top bar with page title, contextual buttons and Log Out, a notifications bell fed by live events, toasts, global loading bar, skip link, and a mobile drawer. *File:* `web/src/components/AppShell.tsx`.
- **UI library:** gauges, bars, help tooltips, guideline chips, severity dots, status badges, a focus-trapped modal, a typed-confirmation modal, form fields with error association, a password field with show/hide and strength meter, tabs, sortable headers, pagination, empty and loading states. *File:* `web/src/components/ui.tsx`.
- **Login, 2FA, forgot and reset password pages**, matching the reference sign-in layout (white header, form, help card, dark three-column footer) and linking to real ecomback.com pages. *File:* `web/src/pages/Login.tsx`.
- **Home** (New Scan card with four scope radios, auto-https URL validation, Recent Scans/Sitemaps), **Scans list** (search, sortable columns, per-row Options…/Scan Now/Stop Scan, live progress, schedule label, disk %, issue ring, bulk actions, client filter, pagination) and **Scan History** (screenshot, gauge, priority/other trend chart with screen-reader table, live scan row, resume, Delete Scans and Delete Site with typed confirmation). *Files:* `web/src/pages/Home.tsx`, `Scans.tsx`, `History.tsx`, `web/src/components/scan.tsx`, `TrendChart.tsx`.
- **Edit Scan** (all six sections from Plan §2.6/§5.8 with field-level errors and an unsaved-changes guard), **Sitemaps** (list, interactive ARIA tree map, depth chart, sitemap.xml/CSV downloads, options) and the **Portfolio Dashboard**. *Files:* `web/src/pages/EditScan.tsx`, `Sitemaps.tsx`, `Dashboard.tsx`, `web/src/styles/workspace.css`.
- **Account and admin pages:** Clients (white-label workspaces with logos), Settings (timezone, date format, sidebar theme, alerts, API tokens), Security (password change, 2FA with QR code and recovery codes, sessions), Billing (quota/usage summary only; payments deferred), Audit History, Users (invite, roles, permissions matrix), Release Notes, Rule Library, Email Outbox. *Files:* `web/src/pages/account/*`, `web/src/styles/account.css`.

---

## [1.0.0-dev.1] — 19 Oct 2026: Backend, scan engine, exports

### Added
- **Project scaffold:** Express 5 + TypeScript (strict) API with Vite middleware for React. One command, `npm run dev`, serves http://localhost:4000. SQLite storage via Node's built-in `node:sqlite` (no native build step). *Files:* `package.json`, `tsconfig.json`, `vite.config.ts`, `server/index.ts`, `server/config.ts`.
- **Data model** (Plan §11): accounts, users, sessions, plans, subscriptions, invoices, clients, sites, scans, scan_pages, scan_resources, page_refs, rules, issues, diagnostics, sitemaps (+ runs and nodes), audit_events, notifications, alert_settings, report_exports, release_notes, emails, api_tokens. *File:* `server/db/schema.sql`.
- **Security** (Plan §10): scrypt password hashing; the password policy from §2.8; TOTP 2FA with recovery codes; httpOnly session cookies with idle timeout and "remember me"; CSRF tokens; per-IP rate limiting; account lockout after 5 failures; AES-256-GCM encryption at rest for stored crawler credentials and TOTP secrets; 6-month audit log; security headers; Bearer API tokens. *Files:* `server/auth/session.ts`, `server/lib/crypto.ts`, `server/routes/auth.ts`, `server/lib/audit.ts`.
- **Scan engine** (Plan §6):
  - Queue-based crawler with robots.txt, scope (site / folder / page / page + links), link depth, related and additional domains, wildcard blocklists, adaptive throttling with 429/503 back-off, timeouts, retries, and HTTP Basic / custom header / Shopify Web Bot Auth / cookie authorisation.
  - Headless Chrome rendering with DOM modes None / Smart / All, homepage screenshots, live progress with ETA, stop/resume, and crash recovery from persisted state.
  - *Files:* `server/engine/*.ts`.
- **Analyzers and rule catalog** (Plan §7):
  - Accessibility: axe-core for WCAG 2.0–2.2 A/AA/AAA, ARIA, Section 508 and EN 301 549; screen-reader heuristics; PDF/UA-1; reading age.
  - Compatibility: MDN browser-compat data checked against each browser's current release, honouring `@supports` and prefixed fallbacks.
  - Errors: broken links and resources with line numbers, redirects, mixed content, charset, soft 404s, spelling in 5 languages with a brand-word filter, forbidden/required text, page weight.
  - Search: Google, Bing and DuckDuckGo rules, robots.txt, structured data, keywords, duplicates.
  - Standards: html-validate, CSS grammar validation, obsolete features, DOCTYPE.
  - Usability: new-window links, small text, horizontal scroll at 375px, favicon, 404 handling, image dimensions, autocomplete, readability.
  - Every rule has an ID, severity, guideline mapping, description, fix advice, effort estimate and version. WCAG data is generated from the official W3C JSON.
  - *Files:* `server/engine/analyzers/*`, `server/engine/rules/*`, `shared/wcag.ts`.
- **Shopify-first preset** (Plan §15): auto-detection, cart/collection seeds, duplicate-URL filtering, collection→product canonicalisation, theme vs app asset handling, storefront password unlock, and a checkout coverage note.
- **Reports API** (Plan §5.7, §12): summary, issues by category with sections and occurrences, issues by page, inventory, diagnostics, 3D site-map data, what-was-tested, prioritized fix plan with theme-level detection and effort, before/after comparison, accessibility statement data, ADA/WCAG compliance score, benchmark. *Files:* `server/reports/data.ts`, `server/routes/reports.ts`.
- **Exports** (Plan §8): Word, PDF (Chrome, with branded header and footer), HTML, Excel, CSV (with formula-injection protection) and JSON; full / summary / executive / issues-only report types; export history; disk accounting. *Files:* `server/reports/*`, `server/routes/exports.ts`.
- **Scheduling and notifications** (Plan §9): daily/weekly/monthly in the account timezone (DST-safe); emailed scheduled reports with a PDF attachment; alerts for completed, failed, issue rise and quota near limit; a local email outbox when no SMTP is configured. *Files:* `server/engine/scheduler.ts`, `afterScan.ts`, `server/mail/mailer.ts`.
- **Sitemaps module** (Plan §2.7, §5.9): fast link-only crawl, click-depth tree, sitemap.xml and CSV exports. *Files:* `server/engine/sitemapRunner.ts`, `sitemapService.ts`, `server/routes/sitemaps.ts`.
- **Account APIs:** settings, alerts, notifications, API tokens, users and roles (Administrator / Analyst / Viewer with a permissions matrix), client workspaces, audit history with filters, billing summary (quotas, disk, scanner IPs), release notes, rule library, portfolio dashboard, SSE live events. *Files:* `server/routes/*`.

### Deferred (owner decision)
- Billing plans and payments: the Billing page shows quotas and usage only.
