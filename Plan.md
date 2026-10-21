![Ecomback Logo](./assets/ecomback-logo.png)

# SortSite Tools by Ecomback
## Complete Product, UI/UX and Engineering Build Plan
**Version 1.0 - 19 Oct 2026 - Owner: Ecomback (ecomback.com)**

> Branding rule: every screen, report, email and export carries the Ecomback logo and the product name 'SortSite Tools by Ecomback'. Logo file: /assets/ecomback-logo.png (plus SVG, dark and light variants). Brand colors and fonts must be taken from ecomback.com (NOT verified: the site could not be read during research).

> Legal and IP note: the reference app (PowerMapper OnDemand Suite / SortSite) is a commercial product. This plan reproduces functional scope and UX patterns for an original build. Do NOT copy PowerMapper code, rule text, logos, icons, branding or engine. Build or license the rule engine. Clear the use of the name 'SortSite' with legal before launch.

---

## 0. Table of Contents
1. Vision and Goals
2. Reference Product Audit
3. Branding and Design System
4. Information Architecture and Navigation
5. Screen-by-Screen Specification
6. Scan Engine Specification
7. Rule Catalog
8. Reports and Exports
9. Scheduling and Notifications
10. Accounts, Billing, Quotas, Security
11. Data Model
12. API Design
13. System Architecture
14. Non-Functional Requirements
15. Ecomback-Specific Differentiators
16. Roadmap and Milestones
17. QA and Acceptance Checklist
18. Risks and Open Questions

---

## 1. Vision and Goals
Goal: a white-label, Ecomback-branded website quality scanner. It crawls a customer site (especially Shopify / e-commerce) and reports accessibility (WCAG/ADA), broken links, SEO, usability, compatibility and standards issues, with trend history and exportable reports.

Primary users: Ecomback staff (administrators, analysts), Ecomback clients (read-only or limited), agency partners.

Success metrics:
- A full-site scan of up to 500 pages completes in under 60 minutes.
- Scan results are consistent run-to-run on unchanged sites.
- Every export format in section 8 works.
- The UI covers 100 percent of the features in sections 2 and 5.

---

## 2. Reference Product Audit (observed in the app)

### 2.1 Global shell
| Element | Observed behavior |
|---|---|
| Left dark sidebar | Logo + product name at top. Groups: Home, Scans, Sitemaps; Account (Settings, Security); Subscription (Billing, Audit History, Users); Help (Release Notes) |
| Active nav item | Purple highlighted pill with glow |
| Top bar | Page title right-aligned; Log Out button (purple, lock icon) |
| Contextual top-bar buttons | Options... (purple), Scan Now (light); on reports also a report-type dropdown + green Download button |
| Palette | Dark navy sidebar, purple primary, green = save/download, red = stop/delete/priority, amber = other issues |
| Typography | Clean geometric sans-serif, large bold page headings |

### 2.2 Home
- Tabs: Scans | Sitemaps.
- New Scan card: scope radios (Entire Site / Folder / Page / Page and Links), Site address input (placeholder https://example.com), Scan button, helper text about broken links, accessibility and browser compatibility.
- Recent Scans table: thumbnail, address, date, issue-percent ring; running jobs show a live progress thumbnail, a green 'Started' badge and a Stop Scan button.

### 2.3 Scans list
- New Scan... button, search box + Search button.
- Sortable columns: Address (start page of scan), Date (scan finished), Disk (percent of quota), Issues (percent of pages).
- Row: website thumbnail, URL link, Options... button, Scan Now button, 'Not scheduled' label, date chip, percent used, circular issue gauge (red arc).
- Running row: progress percent, started-time badge, 'Scan running', time remaining, red Stop Scan.

### 2.4 Scan history (per site)
- Header: site URL, 'Next scan: Not scheduled'.
- Summary strip: homepage screenshot, circular gauge (percent of pages with issues), 'Issues' label, trend chart (dotted lines: red = Priority Issues, amber = Other Issues; 0-100 percent axis, date ticks).
- History table: Date (sortable), Scope, Disk, Issues.
- Running scan row: progress bar, started time, 'N pages found, N done', current URL being analyzed, time remaining, Stop Scan.
- Completed rows: date link, scope ('Site scan'), disk percent used, issue ring.
- Footer: 'N scans - percent used - size' and red Delete Scans button.

### 2.5 Scan report
Top bar: Options..., Scan Now, report-format dropdown (e.g. Full Report - Word), Download. Top tabs: Summary | Issues | Pages, plus the scanned URL link.

Summary > Overview
- Big gauge (percent of pages with issues), 'N pages with quality issues', benchmark badge ('worse than average' with ? tooltip), 'N pages and files checked by N rules', Diagnostics link, explanatory text.
- Accessibility card: pages with issues, benchmark, progress bars for Level A, Level AA, Warnings.

Summary > Site Map
- 3D isometric tower map. Each page is a tower; height = number of errors, width = click depth from home page. Hover shows page details.

Summary > What was Tested
- Guideline status table: WAI-ARIA, JAWS / NVDA / VoiceOver compatibility, Scan Problems, EN 301 549, PDF/UA-1, Section 508, WCAG 2.0 / 2.1 / 2.2, each 'Checked / Not checked for this scan'.
- Scan options table (see 5.8).

Issues > Accessibility
- Gauge + benchmark + explanation (automated testing cannot catch everything).
- WCAG 2.2 card (Level A / AA bars with ? help) and ARIA card (Errors / Warnings bars with ? help).
- Sections Level A, Level AA, etc.: 'N issues on N pages'. Each issue is an expandable row with a red/amber dot, description, guideline chip (e.g. WCAG A 4.1.2, ARIA 5.2.8.6, WCAG A F87) and affected-pages count.

Pages > Inventory
- Table: Type / URL count / Description. Documents (HTML, PDF, Other), Images (GIF, PNG, JPEG, SVG, Other), Misc (CSS, JavaScript). Expandable rows; zero-count rows greyed.

Pages > Issues by Page
- Gauge + benchmark; table of Issues (count), Description and URL (link), Guideline, Line. Expandable rows.

Pages > Diagnostics
- 'Informative' list (not errors): CSS/HTML caching config, server information, links blocked by robots.txt, link counts, rate limiting, unexpected status codes, broken links, 403 responses, links blocked by the scanner; each with a page count and expand arrow.

### 2.6 Edit Scan (Options...)
- Start page field + scope dropdown (Entire Site etc.).
- Left rail of 6 sections: Rules, Blocks, Reports, Links, Crawler, Schedule. Bottom: green Save and Cancel.

Rules (sub-tabs Accessibility, Compatibility, Errors, Search, Standards, Usability; each has an enable checkbox)
- Accessibility: WCAG (e.g. 2.2 AA), ARIA (1.3), US standards, EU standards, PDF standards, Screen reader support, Reading age (Universal).
- Compatibility: Chrome, Edge, Firefox, Opera, Safari macOS, Android, iPhone / iPad.
- Errors and Broken Links: Spell check (language dropdown) + 'Ignore capitalized words'; Forbidden text textarea; Required text textarea; page-weight radio (Don't check / Report pages larger than N kilobytes).
- Search: Google, DuckDuckGo, Bing, robots.txt guidelines, Best practices checkboxes; 'Optimize these keywords' textarea.
- Standards: Validate CSS, Validate HTML, Check for obsolete features; legacy DOCTYPE validator radio (modern vs legacy).
- Usability: Best practices, Readability.

Blocks: blocked-links textarea with pattern examples (*.pdf, a single URL, /forbidden/*) and a robots-exclusion note.
Reports: JavaScript DOM changes radio (None / Smart / All); max pages shown per issue (default 140); max line numbers per issue (default 5); caution about report size.
Links: follow related domains checkbox; additional domains textarea; link depth (entire site / only N clicks from start page); external links (check all / first N per site).
Crawler: Request Authorisation dropdown (None, plus HTTP auth / Shopify Web Bot Auth).
Schedule: When to scan (Not scheduled / daily / weekly / monthly) + start date; 'scan up to 500 pages' note; Email report to dropdown (Nobody, ...).

### 2.7 Sitemaps
New Map... button, search, table with Address, Date, Disk, thumbnail, Options... and Map Now per row.

### 2.8 Account and Subscription pages
- Settings: Timezone dropdown, Date/time format dropdown, Save/Cancel.
- Security: Change Password (current, new, confirm; show/hide eye icons; rule: passphrase of 16+ characters, or 8+ with mixed case and digits or punctuation); Two-Factor Authentication (status banner, authenticator-app QR flow).
- Billing: Summary (company, plan name and start date, scan quotas daily/weekly/monthly, users allowed, disk quota with percent used, Scanner IP addresses for allowlisting); Charges table with Date and View Invoice links.
- Audit History: changes in the last 6 months; When (sortable), Who, What (badge), Details.
- Users: plan-limit banner; table of Name, Status, Permissions, Last Login.
- Release Notes: cards with category badge, version title, New Features, Rule Changes, Fixes, date.

---

## 3. Branding and Design System (Ecomback)
| Item | Spec |
|---|---|
| Product name | SortSite Tools by Ecomback |
| Logo placement | Sidebar header (full lockup), login page, report cover, PDF/Word headers and footers, email templates, favicon (icon mark) |
| Colors | Ecomback brand palette (hex codes to be supplied). Semantic: Success green, Danger/Priority red, Warning/Other amber, Info blue |
| Typography | Ecomback brand font with system sans fallback |
| Components | Buttons (primary, secondary, success, danger), tabs, pills, cards, data tables, circular gauges, progress bars, chips, badges, tooltips, accordions, modals, toasts, dropdowns, textareas, radios, checkboxes, search box |
| Modes | Light and dark sidebar; our own UI must pass WCAG 2.2 AA |
| Responsive | Desktop first; tablet and mobile with collapsible sidebar |
| Accessibility | Full keyboard navigation, visible focus rings, ARIA landmarks, prefers-reduced-motion, screen-reader labels on all gauges and charts |

---

## 4. Information Architecture and Navigation
~~~
Login / 2FA
|-- App Shell (sidebar + top bar)
    |-- Home (Scans | Sitemaps tabs, New Scan card, Recent Scans)
        |-- Scans (list) -> Scan History (per site) -> Scan Report
            |      |   Report: Summary (Overview | Site Map | What was Tested)
                |      |           Issues (Accessibility + Compatibility, Errors, Search, Standards, Usability)
                    |      |           Pages (Inventory | Issues by Page | Diagnostics)
                        |      |-- Options... (Edit Scan: Rules, Blocks, Reports, Links, Crawler, Schedule)
                            |-- Sitemaps (list) -> Map Options / Map Now / Map result
                                |-- Account: Settings, Security
                                    |-- Subscription: Billing, Audit History, Users
                                        |-- Help: Release Notes (+ Docs, Support)
                                        ~~~

                                        ---

                                        ## 5. Screen-by-Screen Specification
                                        Every screen below must be built with every listed element.

                                        ### 5.1 Login and 2FA
                                        Email, password (show/hide), Sign in, Forgot password, 2FA code field, recovery-code option, Ecomback logo, error and lockout states.

                                        ### 5.2 App Shell
                                        Sidebar (logo, 3 nav groups, active state, collapse on mobile), top bar (page title, contextual buttons, Log Out), toast/notification area, global loading bar.

                                        ### 5.3 Home
                                        New Scan card (4 scope radios, URL input with validation and auto-https, Scan button). Tabs Scans / Sitemaps. Recent Scans table (thumbnail, link, date or 'Started' badge, issue ring, live progress, Stop Scan).

                                        ### 5.4 Scans List
                                        New Scan modal or page; search by URL; sortable headers (Address, Date, Disk, Issues); row actions (Options..., Scan Now, Stop Scan); per-row thumbnail, schedule status, quota percent, issue ring; pagination; empty state; delete site; bulk actions (enhancement).

                                        ### 5.5 Scan History
                                        Header (URL, next scan), screenshot, issue ring, trend chart with legend (priority vs other) and date axis, history table (sortable Date, Scope, Disk, Issues), live-scan row (progress, pages found/done, current URL, ETA, Stop Scan), footer totals, Delete Scans (confirm modal with typed confirmation), pagination.

                                        ### 5.6 Report Shell
                                        Top-bar actions: Options..., Scan Now, format dropdown, Download. Tabs Summary / Issues / Pages, URL link, sub-tabs per section. Loading skeletons and a 'scan still running' banner.

                                        ### 5.7 Report Tabs
                                        - Overview: gauge, counts, benchmark badge + tooltip, rules-checked count, Diagnostics link, per-category cards (Accessibility, plus Compatibility, Errors, Search, Standards, Usability when enabled).
                                        - Site Map (3D towers): WebGL/canvas isometric renderer, hover tooltip (URL, issue count, depth), zoom and pan, legend, accessible fallback table.
                                        - What was Tested: guideline status table with icons and greyed rows, scan-options table.
                                        - Issues tabs: category gauge, standards cards with bars and ? tooltips, severity sections (Level A, Level AA, Warnings, ARIA errors), expandable issue rows with guideline chips linking to rule documentation, affected-pages count, expanded view with pages, line numbers and code snippets, filters (severity, guideline, text search), export of the current view.
                                        - Inventory: grouped type table, expandable file lists, counts, zero-state greying.
                                        - Issues by Page: sortable list, expandable per-page issue details (description, guideline, line, snippet, fix advice), search/filter, link to the live page.
                                        - Diagnostics: informational message list with page counts and expandable URL lists.

                                        ### 5.8 Edit Scan (all fields from 2.6)
                                        | Scan option | Default |
                                        |---|---|
                                        | JavaScript DOM changes | All |
                                        | Obey robots.txt | On |
                                        | Blocked links | None specified |
                                        | Legacy DOCTYPEs | Use legacy parser |
                                        | HTTP authorisation headers | Off |
                                        | Max pages shown per issue | 140 |
                                        | Max lines shown per issue | 5 |
                                        | Server load throttle | Auto |
                                        | Page timeout | 180000 ms |
                                        | Link depth | Explore entire site |
                                        | External links | Check first 20 per external site |
                                        | Include related domains | Off |
                                        | Include additional domains | None specified |

                                        Plus Save (validation and unsaved-changes warning), Cancel, per-tab enable checkboxes (sub-options disabled until enabled).

                                        ### 5.9 Sitemaps
                                        List, New Map..., search, Options..., Map Now, visual map output (to be defined; output view was not observed).

                                        ### 5.10 Settings / Security / Billing / Audit History / Users / Release Notes
                                        Implement as in 2.8, plus: password strength meter; 2FA enable/disable and recovery-code regeneration; invoice PDF view; add/edit/remove users with roles (Administrator, Analyst, Viewer); audit filters (date, user, type); release-note filtering by category.

                                        ---


                                        ## 6. Scan Engine Specification
                                        1. Crawler: queue-based; respects robots.txt (toggle); link-depth and domain scoping; URL blocklist patterns (wildcards); rate limiting and server-load throttle; page timeout; retries; auth (HTTP headers, Shopify bot auth, cookies).
                                        2. Renderer: headless Chromium with DOM-change mode (None / Smart / All) to test the post-JavaScript DOM.
                                        3. Fetcher: inventory of HTML, PDF, images, CSS, JS; status-code, caching-header and server-info capture.
                                        4. Analyzers: accessibility, compatibility, errors/links, search/SEO, standards (HTML/CSS validators), usability and readability.
                                        5. Progress: live counters (found/done), current URL, ETA, stop and resume.
                                        6. Limits: per-plan page caps (e.g. up to 500 pages per scan) and per-account disk quota.
                                        7. Screenshots: homepage thumbnail per scan.
                                        8. Scanner IPs: fixed list published on the Billing page for client allowlisting.

                                        ---

                                        ## 7. Rule Catalog
                                        - Accessibility: WCAG 2.0 / 2.1 / 2.2 (A, AA, AAA), WAI-ARIA 1.3, Section 508, EN 301 549, PDF/UA-1, screen reader compatibility (JAWS, NVDA, VoiceOver), reading age.
                                        - Compatibility: per-browser feature support (Chrome, Edge, Firefox, Opera, Safari, Android, iOS), refreshed with each browser release.
                                        - Errors: broken links, empty pages, config errors, spell check, forbidden/required text, page weight.
                                        - Search: Google, Bing, DuckDuckGo guidelines, robots.txt, best practices, keyword optimization.
                                        - Standards: HTML5 validation, CSS validation, obsolete features, legacy DTDs.
                                        - Usability: best practices, readability.
                                        - Diagnostics: informational messages (not errors).
                                        - Each rule has: ID, severity (Priority / Other / Warning), guideline mapping, plain-language description, fix guidance, code-snippet extraction, version number (shown in release notes).

                                        ---

                                        ## 8. Reports and Exports
                                        - Formats: Full Report (Word), PDF, HTML, CSV and Excel (issues and pages), JSON (API).
                                        - Report types: full, summary, executive, issues-only.
                                        - Branding: Ecomback logo on cover and header, 'SortSite Tools by Ecomback' footer, client name, scan date, scope, options used.
                                        - Contents: summary gauges, benchmarks, issue tables, page lists, inventory, diagnostics, what-was-tested.
                                        - Download flow: dropdown selects format, green Download button, progress state, history of generated reports.

                                        ---

                                        ## 9. Scheduling and Notifications
                                        - Schedule: Not scheduled, Daily, Weekly, Monthly, with start date and time (account timezone).
                                        - Quota counters per plan (daily/quick scans, weekly scheduled, monthly scheduled).
                                        - Email report to: Nobody, account users, custom addresses; Ecomback-branded HTML email with link or attachment.
                                        - Alerts: scan completed, scan failed, issue percentage rose by more than N points, quota near limit.
                                        - Next-scan display on the Scan History header.

                                        ---

                                        ## 10. Accounts, Billing, Quotas, Security
                                        - Roles: Administrator, Analyst, Viewer, with a permissions matrix.
                                        - Plans: name, scan quotas, user count, disk quota; upgrade flow.
                                        - Billing: payments handled by a PCI-compliant provider (e.g. Stripe). No card data stored by us. Invoices viewable and downloadable.
                                        - Security: password policy as in 2.8, 2FA (TOTP), session timeout, login rate limiting, audit log (6-month retention, configurable), encryption at rest and in transit.
                                        - Disk quota: per-scan storage accounting; deleting scans frees space.

                                        ---


                                        ## 11. Data Model (core tables)
                                        accounts, users, roles, sessions, plans, subscriptions, invoices, sites (start URL, scope, options JSON, schedule), scans (site_id, status, started/finished, pages_found/done, issue_pct, disk_bytes), scan_pages, scan_resources (type, url, status), issues (rule_id, page_id, line, snippet, severity), rules, guidelines, diagnostics, sitemaps, audit_events, notifications, report_exports, release_notes.

                                        ---

                                        ## 12. API Design (REST, /api/v1)
                                        POST /scans, GET /scans, GET /scans/{id}, POST /scans/{id}/stop, DELETE /scans/{id}, GET /sites/{id}/history, GET/PUT /sites/{id}/options, GET /scans/{id}/report/{summary|issues|pages|diagnostics|sitemap}, POST /scans/{id}/export?format=, GET/POST /sitemaps, GET/PUT /account/settings, POST /account/password, POST /account/2fa/*, GET /billing, GET /audit, GET/POST/PATCH/DELETE /users, GET /release-notes. WebSocket or SSE for live scan progress.

                                        ---

                                        ## 13. System Architecture
                                        - Frontend: React/Next.js + TypeScript, component library per section 3, charting (D3/Recharts), WebGL/canvas for the 3D site map.
                                        - Backend: Node or Python API, job queue (Redis + workers), PostgreSQL, object storage (S3) for screenshots, exports and snapshots.
                                        - Scan workers: containerized headless Chromium, horizontal autoscaling, fixed egress IPs.
                                        - Observability: logs, metrics, tracing, error alerts.
                                        - Deployment: CI/CD, staging and production, infrastructure as code.

                                        ---

                                        ## 14. Non-Functional Requirements
                                        Performance (page load under 2 s, report open under 3 s); reliability (job recovery after worker crash); scalability (concurrent scans per plan); privacy (GDPR/CCPA data deletion); accessibility of our UI (WCAG 2.2 AA); browser support (latest Chrome, Edge, Firefox, Safari); localization-ready (date/time formats, spell-check languages).

                                        ---

                                        ## 15. Ecomback-Specific Differentiators
                                        - Shopify-first presets (theme and app script handling, Web Bot Auth, cart and checkout page coverage).
                                        - ADA/WCAG compliance score and an exportable accessibility-statement helper.
                                        - Agency / white-label mode: client workspaces and branded reports.
                                        - Prioritized fix list with estimated effort.
                                        - Before/after comparison between two scans.
                                        - Dashboard roll-up across all client sites.

                                        ---

                                        ## 16. Roadmap
                                        | Phase | Weeks | Deliverables |
                                        |---|---|---|
                                        | 0 | 1-2 | Brand assets, design system, legal review, architecture sign-off |
                                        | 1 | 3-8 | Auth, shell, Home, Scans list, New Scan, crawler MVP, live progress |
                                        | 2 | 9-14 | Rule engine (WCAG/ARIA, errors), Report Summary/Issues/Pages, History + trend chart |
                                        | 3 | 15-18 | Edit Scan (all six sections), scheduling, email reports, exports |
                                        | 4 | 19-22 | Site Map (3D), Sitemaps module, compatibility/search/standards/usability rules |
                                        | 5 | 23-26 | Billing, users/roles, audit history, 2FA, release notes |
                                        | 6 | 27-30 | Hardening, QA, load testing, beta with Ecomback clients, launch |

                                        ---

                                        ## 17. QA and Acceptance Checklist
                                        - [ ] Every screen and element in section 5 exists and works.
                                        - [ ] Ecomback logo and 'SortSite Tools by Ecomback' appear on all screens, exports and emails.
                                        - [ ] All six Edit Scan sections save and persist; options are reflected in 'What was Tested'.
                                        - [ ] Live scan progress, Stop Scan and quota accounting work.
                                        - [ ] All export formats generate correctly with branding.
                                        - [ ] Trend chart and benchmarks are accurate.
                                        - [ ] Our own UI passes WCAG 2.2 AA.
                                        - [ ] Security tests (auth, 2FA, role access, rate limits) pass.

                                        ---

                                        ## 18. Risks and Open Questions
                                        1. Trademark and IP: can we use the name 'SortSite', and how do we source the rule engine (build vs license)?
                                        2. Benchmark data ('worse than average') needs a large sample of sites; define a source.
                                        3. Ecomback brand tokens (logo files, hex codes, fonts) still need to be supplied.
                                        4. Unobserved areas to confirm: report download formats, Sitemap map output, issue-detail drill-downs, New Scan modal variants.
                                        5. Scale and cost of headless-browser scanning at 500 pages per scan.
                                        