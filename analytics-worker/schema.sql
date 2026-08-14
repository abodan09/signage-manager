-- signage-analytics D1 schema
-- Applied with: npx wrangler d1 execute signage-analytics --remote --file schema.sql

-- One row per download served by the /d/:platform gateway.
-- No raw IPs are stored: ip_hash/fp_hash are salted SHA-256 prefixes.
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,              -- ISO timestamp (UTC)
  day TEXT NOT NULL,             -- YYYY-MM-DD (UTC), for grouping
  platform TEXT NOT NULL,        -- windows | android | webos | tizen
  file TEXT,                     -- release asset name actually served
  version TEXT,                  -- release version (no leading v)
  country TEXT,                  -- ISO2 from Cloudflare
  city TEXT,
  region TEXT,
  continent TEXT,
  lat REAL,                      -- rounded to 1 decimal (~11 km)
  lon REAL,
  ua TEXT,
  os TEXT,                       -- parsed UA OS family
  browser TEXT,                  -- parsed UA browser family
  ref TEXT,                      -- Referer header
  source TEXT,                   -- landing | direct | updater | <?src=>
  device_id TEXT,                -- first-party cookie uuid (repeat detection)
  ip_hash TEXT,                  -- H(ip + salt): same network
  fp_hash TEXT,                  -- H(ip + ua + salt): device fallback when no cookie
  new_device INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_downloads_day    ON downloads(day);
CREATE INDEX IF NOT EXISTS idx_downloads_device ON downloads(device_id);
CREATE INDEX IF NOT EXISTS idx_downloads_fp     ON downloads(fp_hash);

-- One row per app installation (anonymous, self-generated install id).
CREATE TABLE IF NOT EXISTS installs (
  install_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  app_version TEXT,
  os TEXT,
  arch TEXT,
  locale TEXT,
  country TEXT,
  city TEXT,
  sessions INTEGER NOT NULL DEFAULT 0,  -- count of app_start events
  events INTEGER NOT NULL DEFAULT 0     -- total events ever ingested
);
CREATE INDEX IF NOT EXISTS idx_installs_last_seen ON installs(last_seen);

-- Individual telemetry events (app_start, heartbeat, feature usage, page views).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  install_id TEXT NOT NULL,
  session_id TEXT,               -- uuid per app run (session duration via heartbeats)
  name TEXT NOT NULL,
  props TEXT,                    -- JSON, <= 2 KB
  app_version TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_day     ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_name    ON events(name);
CREATE INDEX IF NOT EXISTS idx_events_install ON events(install_id);
