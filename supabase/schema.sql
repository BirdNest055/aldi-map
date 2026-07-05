-- Supabase schema for discount mapper
-- Run this in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT
);

CREATE TABLE IF NOT EXISTS discounts (
  id BIGSERIAL PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_title TEXT,
  brand TEXT,
  price NUMERIC,
  regular_price NUMERIC,
  currency TEXT DEFAULT 'EUR',
  category TEXT,
  valid_from TEXT,
  valid_until TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  -- Generated column for efficient "on sale" filtering
  -- (PostgREST doesn't support column-to-column comparison)
  is_on_sale BOOLEAN GENERATED ALWAYS AS (
    price IS NOT NULL AND regular_price IS NOT NULL AND price < regular_price
  ) STORED
);

-- Backfill column for existing installs (idempotent)
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS is_on_sale BOOLEAN GENERATED ALWAYS AS (
  price IS NOT NULL AND regular_price IS NOT NULL AND price < regular_price
) STORED;

CREATE TABLE IF NOT EXISTS fetch_log (
  id BIGSERIAL PRIMARY KEY,
  store_id TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  error TEXT,
  client_ip TEXT,
  duration_ms INTEGER,
  count INTEGER
);

-- Backfill columns for existing installs (idempotent)
ALTER TABLE fetch_log ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE fetch_log ADD COLUMN IF NOT EXISTS count INTEGER;

CREATE INDEX IF NOT EXISTS idx_discounts_store ON discounts(store_id);
CREATE INDEX IF NOT EXISTS idx_discounts_fetched ON discounts(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_log_store ON fetch_log(store_id);
CREATE INDEX IF NOT EXISTS idx_fetch_log_fetched ON fetch_log(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_log_success ON fetch_log(success);

-- ──────────────────────────────────────────────────────────────────────────
-- Auto-fetch settings (per-store, regional stores only)
-- ALDI stores are exempt (national, handled by discount-fetcher-cli)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auto_fetch_settings (
  store_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- intervalHours must be one of: 0 (off), 24, 72, 168
  interval_hours INTEGER NOT NULL DEFAULT 24
    CHECK (interval_hours IN (0, 24, 72, 168)),
  last_auto_fetched_at TIMESTAMPTZ,
  last_auto_fetch_status TEXT
    CHECK (last_auto_fetch_status IS NULL OR last_auto_fetch_status IN ('success', 'failed', 'skipped-rate-limit')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the scheduler's "find due stores" query:
-- WHERE enabled = TRUE AND (last_auto_fetched_at IS NULL OR last_auto_fetched_at + interval_hours * INTERVAL '1 hour' <= NOW())
CREATE INDEX IF NOT EXISTS idx_auto_fetch_due
  ON auto_fetch_settings(enabled, last_auto_fetched_at)
  WHERE enabled = TRUE;

ALTER TABLE auto_fetch_settings ENABLE ROW LEVEL SECURITY;

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION update_auto_fetch_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_fetch_settings_updated ON auto_fetch_settings;
CREATE TRIGGER trg_auto_fetch_settings_updated
  BEFORE UPDATE ON auto_fetch_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_fetch_settings_updated_at();

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fetch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read stores" ON stores FOR SELECT TO anon USING (true);
CREATE POLICY "Public can read discounts" ON discounts FOR SELECT TO anon USING (true);
