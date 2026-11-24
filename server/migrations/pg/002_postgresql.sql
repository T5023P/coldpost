-- Cold Post PostgreSQL schema — adapted from SQLite 001_init.sql
-- Money stored in paise (integer) everywhere.

-- ============================================
-- Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Enum types
-- ============================================
CREATE TYPE role_enum AS ENUM ('admin', 'ops', 'viewer');
CREATE TYPE campaign_type_enum AS ENUM ('cold_outreach', 'client_appreciation', 'launch_pr', 'event_invitation', 'city_signature');
CREATE TYPE shipment_status_enum AS ENUM ('pending', 'booked', 'in_transit', 'delivered', 'cancelled');
CREATE TYPE qc_status_enum AS ENUM ('pending', 'passed', 'failed', 'rework');
CREATE TYPE po_status_enum AS ENUM ('draft', 'sent', 'partial', 'received', 'cancelled');
CREATE TYPE movement_type_enum AS ENUM ('receive', 'reserve', 'consume', 'transfer', 'damage', 'reject', 'adjust');

-- ============================================
-- Core tables
-- ============================================

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role role_enum NOT NULL DEFAULT 'ops',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE number_sequences (
  key TEXT PRIMARY KEY,
  next_value BIGINT NOT NULL DEFAULT 1
);

-- ============================================
-- Business entities
-- ============================================

CREATE TABLE cities (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT,
  code TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
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
  quality_rating DOUBLE PRECISION,
  reliability_notes TEXT,
  backup_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores, warehouses, printing shops, supplier branches and fulfilment hubs.
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
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
  rating DOUBLE PRECISION,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  is_fulfilment_hub BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'stationery',
  description TEXT,
  image_path TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price_paise BIGINT NOT NULL DEFAULT 0,
  selling_price_paise BIGINT NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'pcs',
  customisation_method TEXT,
  personalisation_notes TEXT,
  dimensions TEXT,
  weight_g INTEGER,
  is_packaging BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Price / MOQ / lead time for one product from one supplier in one city.
CREATE TABLE product_offers (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  unit_price_paise BIGINT NOT NULL DEFAULT 0,
  moq INTEGER NOT NULL DEFAULT 1,
  lead_time_days INTEGER,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  qty_available INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  qty_damaged INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, location_id)
);

CREATE TABLE inventory_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  type movement_type_enum NOT NULL,
  qty INTEGER NOT NULL,
  balance_available INTEGER,
  ref_type TEXT,
  ref_id INTEGER,
  reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  transfer_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  billing_address TEXT,
  gstin TEXT,
  customer_type TEXT NOT NULL DEFAULT 'corporate',
  status TEXT NOT NULL DEFAULT 'active',
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  campaign_type campaign_type_enum NOT NULL,
  purpose TEXT,
  description TEXT,
  suggested_components TEXT NOT NULL DEFAULT '[]',
  suggested_packaging TEXT NOT NULL DEFAULT '[]',
  assembly_instructions TEXT,
  qc_checklist TEXT NOT NULL DEFAULT '[]',
  personalisation_fields TEXT NOT NULL DEFAULT '[]',
  estimated_cost_paise BIGINT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_date TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  campaign_type campaign_type_enum NOT NULL,
  template_id INTEGER REFERENCES order_templates(id) ON DELETE SET NULL,
  description TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  expected_dispatch_date TEXT,
  target_delivery_date TEXT,
  procurement_city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
  fulfilment_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  quotation_number TEXT,
  quotation_date TEXT,
  quotation_amount_paise BIGINT NOT NULL DEFAULT 0,
  advance_received_paise BIGINT NOT NULL DEFAULT 0,
  total_value_paise BIGINT NOT NULL DEFAULT 0,
  estimated_cost_paise BIGINT NOT NULL DEFAULT 0,
  actual_cost_paise BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  status_before_delay TEXT,
  delay_reason TEXT,
  internal_notes TEXT,
  packing_requirements TEXT,
  special_instructions TEXT,
  bom_snapshot TEXT,
  bom_snapshot_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_status_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recipients (
  id SERIAL PRIMARY KEY,
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
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bom_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot TEXT,
  name_snapshot TEXT NOT NULL,
  qty_per_package INTEGER NOT NULL DEFAULT 1,
  total_qty INTEGER NOT NULL DEFAULT 1,
  unit_cost_paise BIGINT NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  customisation TEXT,
  cost_category TEXT NOT NULL DEFAULT 'product',
  notes TEXT,
  is_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_cost_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  estimated_paise BIGINT NOT NULL DEFAULT 0,
  actual_paise BIGINT NOT NULL DEFAULT 0,
  auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  status po_status_enum NOT NULL DEFAULT 'draft',
  expected_delivery TEXT,
  actual_delivery TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_paise BIGINT NOT NULL DEFAULT 0,
  total_paise BIGINT NOT NULL DEFAULT 0,
  invoice_path TEXT,
  notes TEXT,
  advance_warning_override_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT,
  qty_requested INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  qty_rejected INTEGER NOT NULL DEFAULT 0,
  unit_price_paise BIGINT NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE work_orders (
  id SERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE qc_inspections (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  status qc_status_enum NOT NULL,
  checklist TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  inspector_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shipments (
  id SERIAL PRIMARY KEY,
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
  cost_paise BIGINT NOT NULL DEFAULT 0,
  tracking_url TEXT,
  label_path TEXT,
  pickup_details TEXT,
  status shipment_status_enum NOT NULL DEFAULT 'pending',
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at TIMESTAMPTZ,
  pod_path TEXT,
  exception_details TEXT,
  idempotency_key TEXT UNIQUE,
  api_log_id INTEGER REFERENCES api_logs(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shipment_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'manual',
  raw TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE message_templates (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'order',
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
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
  api_log_id INTEGER REFERENCES api_logs(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  sent_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE feedback (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  delivery_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  rating INTEGER,
  comments TEXT,
  missing_items TEXT,
  damaged_items TEXT,
  packaging_feedback TEXT,
  overall_experience TEXT,
  repeat_interest BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE issues (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES recipients(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'missing',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attachments (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'document',
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  caption TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_providers (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('shipping','tracking','notification')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  environment TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  status TEXT NOT NULL DEFAULT 'not_connected',
  last_check_at TIMESTAMPTZ,
  last_check_message TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, slug)
);

CREATE TABLE api_secrets (
  provider_id INTEGER NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, key)
);

CREATE TABLE api_logs (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER REFERENCES api_providers(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  environment TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  request_meta JSONB,
  response_meta JSONB,
  error TEXT,
  idempotency_key TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  retry_of INTEGER REFERENCES api_logs(id) ON DELETE SET NULL,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  entity_label TEXT,
  meta JSONB,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
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
-- GIN index for JSONB columns (helpful for meta/search)
CREATE INDEX idx_api_logs_request_meta ON api_logs USING GIN (request_meta);
CREATE INDEX idx_api_logs_response_meta ON api_logs USING GIN (response_meta);
CREATE INDEX idx_audit_meta ON audit_logs USING GIN (meta);