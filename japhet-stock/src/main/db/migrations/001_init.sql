CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id), password_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE units (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, symbol TEXT NOT NULL,
  allows_decimals INTEGER NOT NULL DEFAULT 0 CHECK (allows_decimals IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id), is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (parent_id, name));
CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'GENERAL',
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, phone TEXT, email TEXT, notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1);
-- Quantities are integers scaled x1000 (3 decimals). Money is integer minor units (TZS x100). NULL cost = unknown.
CREATE TABLE products (
  id INTEGER PRIMARY KEY, barcode TEXT UNIQUE, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category_id INTEGER REFERENCES categories(id), subcategory_id INTEGER REFERENCES categories(id),
  brand TEXT, description TEXT,
  base_unit_id INTEGER NOT NULL REFERENCES units(id), purchase_unit_id INTEGER REFERENCES units(id),
  has_price INTEGER NOT NULL DEFAULT 0 CHECK (has_price IN (0,1)),
  purchase_cost_minor INTEGER CHECK (purchase_cost_minor IS NULL OR purchase_cost_minor >= 0),
  selling_price_minor INTEGER CHECK (selling_price_minor IS NULL OR selling_price_minor >= 0),
  supplier_id INTEGER REFERENCES suppliers(id), preferred_location_id INTEGER REFERENCES locations(id),
  min_stock_milli INTEGER, critical_stock_milli INTEGER, max_stock_milli INTEGER, reorder_qty_milli INTEGER,
  tracks_expiry INTEGER NOT NULL DEFAULT 0, tracks_batch INTEGER NOT NULL DEFAULT 0, expiry_warning_days INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (has_price = 1 OR (purchase_cost_minor IS NULL AND selling_price_minor IS NULL)));
CREATE TABLE product_unit_conversions (
  product_id INTEGER NOT NULL REFERENCES products(id), unit_id INTEGER NOT NULL REFERENCES units(id),
  factor_milli INTEGER NOT NULL CHECK (factor_milli > 0), -- 1 of this unit = factor x base units
  PRIMARY KEY (product_id, unit_id));
CREATE TABLE product_location_settings (
  product_id INTEGER NOT NULL REFERENCES products(id), location_id INTEGER NOT NULL REFERENCES locations(id),
  min_stock_milli INTEGER, critical_stock_milli INTEGER, reorder_target_milli INTEGER, max_stock_milli INTEGER,
  PRIMARY KEY (product_id, location_id));

-- Inventory ledger: header + lines. A line moves qty FROM a location and/or TO a location.
-- Receipt: to only. Consumption/damage: from only. Transfer: both (net zero for the business).
CREATE TABLE inventory_transactions (
  id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, movement_type TEXT NOT NULL,
  txn_date TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), notes TEXT,
  supplier_id INTEGER REFERENCES suppliers(id), invoice_ref TEXT, delivery_ref TEXT,
  source_doc_type TEXT, source_doc_id INTEGER,
  reverses_id INTEGER REFERENCES inventory_transactions(id),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status = 'POSTED'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE UNIQUE INDEX ux_txn_reverses ON inventory_transactions(reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX ix_txn_date ON inventory_transactions(txn_date);
CREATE INDEX ix_txn_type ON inventory_transactions(movement_type);
CREATE TABLE inventory_transaction_lines (
  id INTEGER PRIMARY KEY, transaction_id INTEGER NOT NULL REFERENCES inventory_transactions(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0), -- always in the product's BASE unit
  entered_quantity_milli INTEGER NOT NULL, entered_unit_id INTEGER NOT NULL REFERENCES units(id),
  from_location_id INTEGER REFERENCES locations(id), to_location_id INTEGER REFERENCES locations(id),
  unit_cost_minor INTEGER, -- cost per BASE unit; NULL = unknown (never 0 by default)
  unit_price_minor INTEGER CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0), -- selling price per BASE unit (SALE lines only)
  batch_no TEXT, expiry_date TEXT, reason TEXT,
  CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
  CHECK (from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id));
CREATE INDEX ix_line_txn ON inventory_transaction_lines(transaction_id);
CREATE INDEX ix_line_prod_from ON inventory_transaction_lines(product_id, from_location_id);
CREATE INDEX ix_line_prod_to ON inventory_transaction_lines(product_id, to_location_id);

-- Posted ledger rows are immutable; corrections are made with reversal transactions.
CREATE TRIGGER trg_txn_no_update BEFORE UPDATE ON inventory_transactions BEGIN SELECT RAISE(ABORT,'Posted transactions are immutable; post a reversal instead'); END;
CREATE TRIGGER trg_txn_no_delete BEFORE DELETE ON inventory_transactions BEGIN SELECT RAISE(ABORT,'Posted transactions cannot be deleted; post a reversal instead'); END;
CREATE TRIGGER trg_line_no_update BEFORE UPDATE ON inventory_transaction_lines BEGIN SELECT RAISE(ABORT,'Posted transaction lines are immutable'); END;
CREATE TRIGGER trg_line_no_delete BEFORE DELETE ON inventory_transaction_lines BEGIN SELECT RAISE(ABORT,'Posted transaction lines cannot be deleted'); END;

CREATE TABLE sequences (name TEXT PRIMARY KEY, last_value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  previous_value TEXT, new_value TEXT, reason TEXT, transaction_id INTEGER);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit log is append-only'); END;
