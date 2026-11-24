-- Cold Post core schema. Money is stored in paise (integer) everywhere.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ops' CHECK (role IN ('admin','ops','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE number_sequences (
  key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  state TEXT,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
  address TEXT,
  products_supplied TEXT,
  moq INTEGER,
  lead_time_days INTEGER,
  payment_terms TEXT,
  quality_rating REAL,
  reliability_notes TEXT,
  backup_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stores, warehouses, printing shops, supplier branches and fulfilment hubs.
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'retail_shop',
  address TEXT,
  contact_person TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  opening_hours TEXT,
  notes TEXT,
  rating REAL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  is_fulfilment_hub INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'stationery',
  description TEXT,
  image_path TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price_paise INTEGER NOT NULL DEFAULT 0,
  selling_price_paise INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'pcs',
  customisation_method TEXT,
  personalisation_notes TEXT,
  dimensions TEXT,
  weight_g INTEGER,
  is_packaging INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Price / MOQ / lead time for one product from one supplier in one city.
CREATE TABLE product_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  moq INTEGER NOT NULL DEFAULT 1,
  lead_time_days INTEGER,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  qty_available INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  qty_damaged INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, location_id)
);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  qty INTEGER NOT NULL,
  balance_available INTEGER,
  ref_type TEXT,
  ref_id INTEGER,
  reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  transfer_group TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  billing_address TEXT,
  gstin TEXT,
  customer_type TEXT NOT NULL DEFAULT 'corporate',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL,
  purpose TEXT,
  description TEXT,
  suggested_components TEXT NOT NULL DEFAULT '[]',
  suggested_packaging TEXT NOT NULL DEFAULT '[]',
  assembly_instructions TEXT,
  qc_checklist TEXT NOT NULL DEFAULT '[]',
  personalisation_fields TEXT NOT NULL DEFAULT '[]',
  estimated_cost_paise INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_date TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  campaign_type TEXT NOT NULL,
  template_id INTEGER REFERENCES order_templates(id) ON DELETE SET NULL,
  description TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  expected_dispatch_date TEXT,
  target_delivery_date TEXT,
  procurement_city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
  fulfilment_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  quotation_number TEXT,
  quotation_date TEXT,
  quotation_amount_paise INTEGER NOT NULL DEFAULT 0,
  advance_received_paise INTEGER NOT NULL DEFAULT 0,
  total_value_paise INTEGER NOT NULL DEFAULT 0,
  estimated_cost_paise INTEGER NOT NULL DEFAULT 0,
  actual_cost_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  status_before_delay TEXT,
  delay_reason TEXT,
  internal_notes TEXT,
  packing_requirements TEXT,
  special_instructions TEXT,
  bom_snapshot TEXT,
  bom_snapshot_at TEXT,
  confirmed_at TEXT,
  closed_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  country TEXT NOT NULL DEFAULT 'India',
  personalisation TEXT,
  packaging_notes TEXT,
  special_instructions TEXT,
  unboxing_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  fulfilment_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot TEXT,
  name_snapshot TEXT NOT NULL,
  qty_per_package INTEGER NOT NULL DEFAULT 1,
  total_qty INTEGER NOT NULL DEFAULT 1,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  customisation TEXT,
  cost_category TEXT NOT NULL DEFAULT 'product',
  notes TEXT,
  is_snapshot INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  estimated_paise INTEGER NOT NULL DEFAULT 0,
  actual_paise INTEGER NOT NULL DEFAULT 0,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  expected_delivery TEXT,
  actual_delivery TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  invoice_path TEXT,
  notes TEXT,
  advance_warning_override_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT,
  qty_requested INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  qty_rejected INTEGER NOT NULL DEFAULT 0,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE CASCADE,
  package_type TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','assembling','completed','cancelled')),
  assigned_to TEXT,
  instructions TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  start_date TEXT,
  completion_date TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE qc_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  checklist TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  inspector_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inspected_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'manual',
  provider_id INTEGER REFERENCES api_providers(id) ON DELETE SET NULL,
  courier_name TEXT,
  service TEXT,
  awb TEXT,
  shipment_date TEXT,
  weight_g INTEGER,
  dimensions TEXT,
  cost_paise INTEGER NOT NULL DEFAULT 0,
  tracking_url TEXT,
  label_path TEXT,
  pickup_details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  is_test INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  pod_path TEXT,
  exception_details TEXT,
  idempotency_key TEXT UNIQUE,
  api_log_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shipment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'manual',
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'order',
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  template_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  to_phone TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared',
  provider_id INTEGER REFERENCES api_providers(id) ON DELETE SET NULL,
  provider_ref TEXT,
  error TEXT,
  idempotency_key TEXT UNIQUE,
  api_log_id INTEGER,
  sent_at TEXT,
  sent_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  delivery_confirmed INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  comments TEXT,
  missing_items TEXT,
  damaged_items TEXT,
  packaging_feedback TEXT,
  overall_experience TEXT,
  repeat_interest INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'missing',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'document',
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  caption TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('shipping','tracking','notification')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  status TEXT NOT NULL DEFAULT 'not_connected',
  last_check_at TEXT,
  last_check_message TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, slug)
);

CREATE TABLE api_secrets (
  provider_id INTEGER NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, key)
);

CREATE TABLE api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER REFERENCES api_providers(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  environment TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  request_meta TEXT,
  response_meta TEXT,
  error TEXT,
  idempotency_key TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  retry_of INTEGER REFERENCES api_logs(id) ON DELETE SET NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  entity_label TEXT,
  meta TEXT,
  manual_override INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_recipients_order ON recipients(order_id);
CREATE INDEX idx_recipients_status ON recipients(status);
CREATE INDEX idx_bom_order ON bom_items(order_id);
CREATE INDEX idx_po_order ON purchase_orders(order_id);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_wo_order ON work_orders(order_id);
CREATE INDEX idx_wo_status ON work_orders(status);
CREATE INDEX idx_qc_recipient ON qc_inspections(recipient_id);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_recipient ON shipments(recipient_id);
CREATE INDEX idx_ship_events ON shipment_events(shipment_id);
CREATE INDEX idx_messages_order ON messages(order_id);
CREATE INDEX idx_inventory_product ON inventory(product_id);
CREATE INDEX idx_inv_moves_product ON inventory_movements(product_id, location_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_api_logs_provider ON api_logs(provider_id);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);
