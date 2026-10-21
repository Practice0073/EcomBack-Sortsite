-- SortSite Tools by Ecomback — core schema (Plan.md §11)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  daily_scans INTEGER NOT NULL,
  weekly_scans INTEGER NOT NULL,
  monthly_scans INTEGER NOT NULL,
  users_allowed INTEGER NOT NULL,
  disk_quota_bytes INTEGER NOT NULL,
  max_pages_per_scan INTEGER NOT NULL,
  concurrent_scans INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  plan_started_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  provider_ref TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  issued_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  provider_ref TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_email TEXT,
  logo_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','analyst','viewer')),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  date_format TEXT NOT NULL DEFAULT 'dd-mmm-yyyy',
  sidebar_theme TEXT NOT NULL DEFAULT 'dark',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'full' CHECK (stage IN ('2fa','full')),
  remember INTEGER NOT NULL DEFAULT 0,
  csrf TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- OAuth 2.0 "Connected apps": other Ecomback tools (e.g. the Remediation Platform) that act on a user's behalf.
CREATE TABLE IF NOT EXISTS oauth_apps (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'site',
  options_json TEXT NOT NULL,
  schedule_frequency TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  thumbnail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (account_id, url, scope)
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','stopped','failed')),
  trigger TEXT NOT NULL DEFAULT 'manual',
  url TEXT NOT NULL,
  scope TEXT NOT NULL,
  options_json TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  pages_found INTEGER NOT NULL DEFAULT 0,
  pages_done INTEGER NOT NULL DEFAULT 0,
  current_url TEXT,
  links_total INTEGER NOT NULL DEFAULT 0,
  links_done INTEGER NOT NULL DEFAULT 0,
  links_started_at TEXT,
  pages_checked INTEGER NOT NULL DEFAULT 0,
  files_checked INTEGER NOT NULL DEFAULT 0,
  rules_checked INTEGER NOT NULL DEFAULT 0,
  issue_pct REAL NOT NULL DEFAULT 0,
  priority_pct REAL NOT NULL DEFAULT 0,
  other_pct REAL NOT NULL DEFAULT 0,
  compliance_score REAL,
  stats_json TEXT,
  disk_bytes INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,
  shopify INTEGER NOT NULL DEFAULT 0,
  crawl_state TEXT,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS scans_site ON scans(site_id, queued_at);
CREATE INDEX IF NOT EXISTS scans_status ON scans(status);

CREATE TABLE IF NOT EXISTS scan_pages (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  final_url TEXT,
  title TEXT,
  status INTEGER,
  content_type TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  parent_url TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  load_ms INTEGER,
  word_count INTEGER,
  reading_grade REAL,
  priority_count INTEGER NOT NULL DEFAULT 0,
  other_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scan_id, url)
);
CREATE INDEX IF NOT EXISTS scan_pages_scan ON scan_pages(scan_id);

CREATE TABLE IF NOT EXISTS scan_resources (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  subtype TEXT NOT NULL,
  status INTEGER,
  bytes INTEGER,
  internal INTEGER NOT NULL DEFAULT 1,
  cache_control TEXT,
  server TEXT,
  error TEXT,
  UNIQUE (scan_id, url)
);
CREATE INDEX IF NOT EXISTS scan_resources_scan ON scan_resources(scan_id, kind);

-- Every outbound reference found on a page (links and embedded resources), with source location.
CREATE TABLE IF NOT EXISTS page_refs (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  page_id INTEGER NOT NULL REFERENCES scan_pages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link','resource')),
  line INTEGER,
  snippet TEXT
);
CREATE INDEX IF NOT EXISTS page_refs_scan_url ON page_refs(scan_id, url);
-- Foreign-key lookups when pages are deleted; without it each page delete scans the whole table.
CREATE INDEX IF NOT EXISTS page_refs_page ON page_refs(page_id);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  fix TEXT NOT NULL,
  guidelines_json TEXT NOT NULL,
  effort_minutes INTEGER NOT NULL,
  help_url TEXT,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guidelines (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  page_id INTEGER NOT NULL REFERENCES scan_pages(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  line INTEGER,
  snippet TEXT,
  selector TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS issues_scan_rule ON issues(scan_id, rule_id);
CREATE INDEX IF NOT EXISTS issues_page ON issues(page_id);

CREATE TABLE IF NOT EXISTS diagnostics (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  url TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS diagnostics_scan ON diagnostics(scan_id, code);

CREATE TABLE IF NOT EXISTS sitemaps (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  options_json TEXT NOT NULL,
  schedule_frequency TEXT NOT NULL DEFAULT 'none',
  next_run_at TEXT,
  thumbnail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (account_id, url)
);

CREATE TABLE IF NOT EXISTS sitemap_runs (
  id INTEGER PRIMARY KEY,
  sitemap_id INTEGER NOT NULL REFERENCES sitemaps(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  pages_found INTEGER NOT NULL DEFAULT 0,
  pages_done INTEGER NOT NULL DEFAULT 0,
  current_url TEXT,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  disk_bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS sitemap_nodes (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sitemap_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  parent_url TEXT,
  title TEXT,
  status INTEGER,
  depth INTEGER NOT NULL,
  content_type TEXT,
  last_modified TEXT,
  UNIQUE (run_id, url)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_label TEXT NOT NULL,
  type TEXT NOT NULL,
  details TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_account ON audit_events(account_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_settings (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  on_complete INTEGER NOT NULL DEFAULT 1,
  on_failed INTEGER NOT NULL DEFAULT 1,
  rise_points INTEGER NOT NULL DEFAULT 5,
  quota_pct INTEGER NOT NULL DEFAULT 90,
  email_alerts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_exports (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  format TEXT NOT NULL,
  report_type TEXT NOT NULL,
  status TEXT NOT NULL,
  file_path TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_notes (
  id INTEGER PRIMARY KEY,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  released_at TEXT NOT NULL,
  new_features TEXT NOT NULL,
  rule_changes TEXT NOT NULL,
  fixes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_path TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
