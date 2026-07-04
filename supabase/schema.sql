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
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id BIGSERIAL PRIMARY KEY,
  store_id TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  error TEXT,
  client_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_discounts_store ON discounts(store_id);
CREATE INDEX IF NOT EXISTS idx_discounts_fetched ON discounts(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_log_store ON fetch_log(store_id);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fetch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read stores" ON stores FOR SELECT TO anon USING (true);
CREATE POLICY "Public can read discounts" ON discounts FOR SELECT TO anon USING (true);
