-- JustPO D1 schema — 0001_init
-- Per PRD §6.6 data model + §4.1 billing + §10 seed users + §6.3 thresholds.

-- ---------------------------------------------------------------------------
-- shops: one row per installed shop. Billing state lives here (PRD §4.1).
-- ---------------------------------------------------------------------------
CREATE TABLE shops (
  id TEXT PRIMARY KEY,              -- shop domain, e.g. "my-store.myshopify.com"
  plan TEXT NOT NULL DEFAULT 'starter', -- 'starter' | 'pro'
  billing_period_start TEXT,        -- ISO date of current 30-day cycle start (from subscription)
  trial_ends_at TEXT,               -- ISO date, 14-day billed trial end
  installed_at TEXT NOT NULL,
  uninstalled_at TEXT,              -- set on app/uninstalled; row deleted after GDPR purge
  timezone TEXT,                    -- IANA tz for the 08:00 low-stock check (PRD §6.3)
  locale TEXT NOT NULL DEFAULT 'en' -- 'en' | 'zh'
);

-- ---------------------------------------------------------------------------
-- sessions: Shopify OAuth sessions (custom D1 SessionStorage backend).
-- Payload stores Session.toPropertyArray() as JSON.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- session id (offline: "offline_<shop>")
  shop TEXT NOT NULL,
  is_online INTEGER NOT NULL DEFAULT 0,
  expires TEXT,                     -- ISO date or NULL
  payload TEXT NOT NULL             -- JSON: Session.toPropertyArray()
);
CREATE INDEX idx_sessions_shop ON sessions(shop);

-- ---------------------------------------------------------------------------
-- suppliers (PRD §6.6): currency recorded, never converted in P0.
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'USD', -- recorded only; P0 = shop home currency (PRD §6.5)
  payment_terms TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_suppliers_shop ON suppliers(shop_id);

-- ---------------------------------------------------------------------------
-- purchase_orders (PRD §6.6): po_number auto-increments per shop (PO-0001…).
-- status: draft → sent → partial → received (single direction) + cancelled.
-- quota_counted: set once when first sent; never unset (PRD §4.1 anti-gaming).
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,          -- e.g. "PO-0001", unique per shop
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  quota_counted INTEGER NOT NULL DEFAULT 0, -- 1 once sent (Starter 30/mo counting)
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, po_number)
);
CREATE INDEX idx_po_shop ON purchase_orders(shop_id);
CREATE INDEX idx_po_shop_status ON purchase_orders(shop_id, status);

-- Per-shop PO number counter (atomic increments inside a D1 batch).
CREATE TABLE po_counters (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- po_line_items: cost recorded in shop home currency (PRD §6.6).
-- writeback_status drives the per-line transparency UI (PRD §6.2).
-- ---------------------------------------------------------------------------
CREATE TABLE po_line_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id TEXT,                  -- Shopify variant GID (optional)
  sku TEXT NOT NULL,
  title TEXT,
  qty INTEGER NOT NULL,             -- ordered qty
  qty_received INTEGER NOT NULL DEFAULT 0,
  qty_written_back INTEGER NOT NULL DEFAULT 0, -- received qty already written to Shopify inventory
  cost REAL,                        -- unit cost, shop home currency
  writeback_status TEXT NOT NULL DEFAULT 'pending' -- pending|success|failed|retrying
);
CREATE INDEX idx_line_po ON po_line_items(po_id);

-- ---------------------------------------------------------------------------
-- seed_users (PRD §10.5): non-public $9-locked early users. billing reads this.
-- ---------------------------------------------------------------------------
CREATE TABLE seed_users (
  shop TEXT PRIMARY KEY,
  locked_price REAL NOT NULL,       -- e.g. 9
  granted_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- low_stock_thresholds (PRD §6.3)
-- ---------------------------------------------------------------------------
CREATE TABLE low_stock_thresholds (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  sku TEXT,
  threshold INTEGER NOT NULL,
  UNIQUE (shop_id, variant_id)
);
CREATE INDEX idx_thresholds_shop ON low_stock_thresholds(shop_id);
