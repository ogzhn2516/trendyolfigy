CREATE TABLE IF NOT EXISTS product_drafts (
  id UUID PRIMARY KEY,
  telegram_update_id TEXT NOT NULL UNIQUE,
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_file_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  sale_price NUMERIC(12, 2) NOT NULL,
  list_price NUMERIC(12, 2) NOT NULL,
  category_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  vat_rate INTEGER NOT NULL DEFAULT 20,
  dimensional_weight NUMERIC(10, 2) NOT NULL DEFAULT 1,
  attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_url TEXT,
  barcode TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  product_main_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  batch_request_id TEXT,
  last_error TEXT,
  trendyol_payload JSONB,
  trendyol_response JSONB,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_drafts_created_at_idx
ON product_drafts (created_at DESC);

CREATE INDEX IF NOT EXISTS product_drafts_status_idx
ON product_drafts (status);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
