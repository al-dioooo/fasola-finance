-- Test-only mirror of the bot-owned tables the dashboard reads/updates.
-- Source of truth: fasola-order-bot/src/db/migrations/index.ts — update this
-- file whenever the bot schema changes. Timestamps are ISO-8601 UTC text
-- ("YYYY-MM-DDTHH:MM:SSZ" or "+07:00" offset), castable with ::timestamptz.

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  customer_wa TEXT NOT NULL,
  customer_name TEXT,
  products_text TEXT NOT NULL,
  products_json TEXT NOT NULL,
  total_quantity INTEGER NOT NULL,
  estimated_subtotal DOUBLE PRECISION,
  address TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  order_status TEXT NOT NULL,
  notes TEXT,
  requested_time TEXT,
  raw_message TEXT,
  ai_model TEXT,
  ai_confidence DOUBLE PRECISION,
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  admin_notified_at TEXT,
  source TEXT NOT NULL DEFAULT 'whatsapp'
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_created_at
  ON orders (customer_wa, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON orders (order_status, created_at);

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  price DOUBLE PRECISION,
  stock_status TEXT NOT NULL,
  is_available INTEGER NOT NULL,
  variants_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  description TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  customer_wa TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message_text TEXT,
  raw_payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  detected_intent TEXT,
  processing_status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

CREATE INDEX IF NOT EXISTS idx_messages_customer_wa_received_at
  ON messages (customer_wa, received_at);

CREATE TABLE IF NOT EXISTS ai_logs (
  log_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  message_id TEXT,
  customer_wa TEXT,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  intent TEXT,
  confidence DOUBLE PRECISION,
  validation_status TEXT NOT NULL,
  error_type TEXT,
  handoff_triggered INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER
);

CREATE TABLE IF NOT EXISTS pending_menu_changes (
  change_id TEXT PRIMARY KEY,
  admin_wa TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  raw_message TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_menu_changes_one_pending_per_admin
  ON pending_menu_changes (admin_wa)
  WHERE status = 'pending';

-- Bot migration 004: restaurant facts the bot answers from. Empty
-- profile_value means "not provided" and the bot deflects to admin.
CREATE TABLE IF NOT EXISTS business_profile (
  profile_key TEXT PRIMARY KEY,
  profile_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);

INSERT INTO business_profile (profile_key, profile_value) VALUES
  ('opening_hours', ''),
  ('store_address', ''),
  ('delivery_area', ''),
  ('delivery_eta', ''),
  ('contact_info', ''),
  ('promos', ''),
  ('about', '')
  ON CONFLICT (profile_key) DO NOTHING;
