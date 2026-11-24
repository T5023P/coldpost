import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, jsonParse, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { nextRef } from '../lib/numbering.js';
import { CAMPAIGN_TYPES, ORDER_STATUS_LABEL, canTransitionPackage } from '../lib/statuses.js';
import {
  generateWorkOrders,
  orderBundle,
  refreshOrderCounters,
  requireOrder,
  setOrderStatus,
  setPackageStatus,
} from '../lib/orders.js';
import { orderCostBreakdown, syncOrderCosts } from '../lib/costing.js';
import { getSetting } from '../lib/settings.js';
import { applyMovement, stockAt } from '../lib/inventory.js';
import { ApiError } from '../lib/http.js';

export const ordersRouter = Router();

const orderListSelect = `SELECT o.*, c.company_name, fl.name AS fulfilment_location_name, ci.name AS fulfilment_city,
  pc.name AS procurement_city_name,
  (SELECT COUNT(*) FROM recipients r WHERE r.order_id = o.id) AS package_count,
  (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.status NOT IN ('cancelled','test_only')) AS shipment_count,
  (SELECT COUNT(*) FROM work_orders w WHERE w.order_id = o.id AND w.status <> 'cancelled') AS work_order_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN locations fl ON fl.id = o.fulfilment_location_id
  LEFT JOIN cities ci ON ci.id = fl.city_id
  LEFT JOIN cities pc ON pc.id = o.procurement_city_id`;

ordersRouter.get(
  '/',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.status) {
      const statuses = q.status.split(',').filter(Boolean);
      if (statuses.length) {
        clauses.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }
    if (q.campaign_type) {
      clauses.push('o.campaign_type = ?');
      params.push(q.campaign_type);
    }
    if (q.customer_id) {
      clauses.push('o.customer_id = ?');
      params.push(Number(q.customer_id));
    }
    if (q.city_id) {
      clauses.push('(o.procurement_city_id = ? OR fl.city_id = ?)');
      params.push(Number(q.city_id), Number(q.city_id));
    }
    if (q.from) {
      clauses.push('o.order_date >= ?');
      params.push(q.from);
    }
    if (q.to) {
      clauses.push('o.order_date <= ?');
      params.push(q.to);
    }
    if (q.search) {
      clauses.push('(o.ref LIKE ? OR o.campaign_name LIKE ? OR c.company_name LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    const rows = all<any>(
      `${orderListSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY o.order_date DESC, o.id DESC LIMIT 500`,
      ...params,
    );
    res.json({ orders: rows, total: rows.length });
  }),
);

const orderCreateSchema = z.object({
  customer_id: z.coerce.number().int().positive(),
  order_date: z.string().min(8),
  campaign_name: z.string().min(2, 'Campaign name is required'),
  campaign_type: z.enum(CAMPAIGN_TYPES),
  template_id: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().optional().nullable(),
  expected_dispatch_date: z.string().optional().nullable(),
  target_delivery_date: z.string().optional().nullable(),
  procurement_city_id: z.coerce.number().int().positive().nullable().optional(),
  fulfilment_location_id: z.coerce.number().int().positive().nullable().optional(),
  quotation_number: z.string().optional().nullable(),
  quotation_amount_paise: z.coerce.number().int().min(0).default(0),
  advance_received_paise: z.coerce.number().int().min(0).default(0),
  total_value_paise: z.coerce.number().int().min(0).default(0),
  packing_requirements: z.string().optional().nullable(),
  special_instructions: z.string().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
});

ordersRouter.post(
  '/',
  asyncHandler((req, res) => {
    const body = parse(orderCreateSchema, req.body);
    requireRow(get('SELECT id FROM customers WHERE id = ?', body.customer_id), 'Customer');
    const ref = nextRef('order', new Date(`${body.order_date}T00:00:00`));
    const id = insert('orders', {
      ...body,
      ref,
      total_value_paise: body.total_value_paise || body.quotation_amount_paise,
      status: 'draft',
      created_by: req.user!.id,
    });
    insert('order_status_history', { order_id: id, from_status: null, to_status: 'draft', note: 'Order created', user_id: req.user!.id });
    logAudit({ userId: req.user!.id, action: 'order.create', entityType: 'order', entityId: id, entityLabel: ref, meta: { campaign: body.campaign_name } });
    res.status(201).json({ order: get<any>(`${orderListSelect} WHERE o.id = ?`, id) });
  }),
);

ordersRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    res.json(orderBundle(id));
  }),
);

const orderUpdateSchema = orderCreateSchema.partial().extend({
  status: z.string().optional(),
});

ordersRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const existing = requireOrder(id);
    const body = parse(orderUpdateSchema, req.body);
    const patch: Record<string, any> = { ...body, updated_at: new Date().toISOString() };
    if (body.status && body.status !== existing.status) {
      setOrderStatus(id, body.status, { userId: req.user!.id, note: 'Updated from order form' });
    }
    delete patch.status;
    if (Object.keys(patch).length > 1) update('orders', id, patch);
    refreshOrderCounters(id);
    logAudit({ userId: req.user!.id, action: 'order.update', entityType: 'order', entityId: id, entityLabel: existing.ref, meta: body });
    res.json({ order: get<any>(`${orderListSelect} WHERE o.id = ?`, id) });
  }),
);

ordersRouter.post(
  '/:id/transition',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const body = parse(
      z.object({ status: z.string().min(2), note: z.string().optional().nullable(), delay_reason: z.string().optional().nullable() }),
      req.body,
    );
    const existing = requireOrder(id);
    if (body.status === 'confirmed' && !existing.confirmed_at) {
      snapshotBom(id, req.user!.id);
    }
    setOrderStatus(id, body.status, { userId: req.user!.id, note: body.note, delayReason: body.delay_reason });
    refreshOrderCounters(id);
    res.json({ order: get<any>(`${orderListSelect} WHERE o.id = ?`, id), bundle: orderBundle(id) });
  }),
);

ordersRouter.post(
  '/:id/quotation',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const body = parse(
      z.object({
        quotation_amount_paise: z.coerce.number().int().min(0),
        total_value_paise: z.coerce.number().int().min(0).optional(),
        quotation_date: z.string().optional().nullable(),
        note: z.string().optional().nullable(),
        advance_status: z.enum(['quotation', 'awaiting_approval']).default('quotation'),
      }),
      req.body,
    );
    const quotationNumber = order.quotation_number || nextRef('quotation');
    run(
      `UPDATE orders SET quotation_number = ?, quotation_amount_paise = ?, total_value_paise = ?, quotation_date = ?, updated_at = ? WHERE id = ?`,
      quotationNumber,
      body.quotation_amount_paise,
      body.total_value_paise ?? body.quotation_amount_paise,
      body.quotation_date ?? new Date().toISOString().slice(0, 10),
      new Date().toISOString(),
      id,
    );
    if (['draft', 'quotation', 'awaiting_approval'].includes(order.status) && order.status !== body.advance_status) {
      if (order.status === 'awaiting_approval' && body.advance_status === 'quotation') {
        /* allow re-quoting */
        setOrderStatus(id, 'quotation', { userId: req.user!.id, note: body.note ?? 'Quotation revised' });
      } else {
        setOrderStatus(id, body.advance_status, { userId: req.user!.id, note: body.note ?? 'Quotation prepared' });
      }
    }
    syncOrderCosts(id);
    logAudit({
      userId: req.user!.id,
      action: 'order.quotation',
      entityType: 'order',
      entityId: id,
      entityLabel: order.ref,
      meta: { quotationNumber, amount: body.quotation_amount_paise },
    });
    res.json({ bundle: orderBundle(id) });
  }),
);

ordersRouter.post(
  '/:id/confirm',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    snapshotBom(id, req.user!.id);
    if (order.status !== 'confirmed') setOrderStatus(id, 'confirmed', { userId: req.user!.id, note: 'Order confirmed' });
    res.json({ bundle: orderBundle(id) });
  }),
);

function snapshotBom(orderId: number, userId?: number | null) {
  const items = all<any>(
    `SELECT b.*, s.name AS supplier_name FROM bom_items b LEFT JOIN suppliers s ON s.id = b.supplier_id
     WHERE b.order_id = ? AND b.is_snapshot = 0`,
    orderId,
  );
  if (!items.length) return null;
  const order = get<{ ref: string }>('SELECT ref FROM orders WHERE id = ?', orderId);
  const snapshot = { capturedAt: new Date().toISOString(), orderRef: order?.ref, items };
  run(
    "UPDATE orders SET bom_snapshot = ?, bom_snapshot_at = datetime('now') WHERE id = ?",
    JSON.stringify(snapshot),
    orderId,
  );
  run('UPDATE bom_items SET is_snapshot = 1 WHERE order_id = ?', orderId);
  logAudit({ userId, action: 'bom.snapshot', entityType: 'order', entityId: orderId, entityLabel: order?.ref, meta: { lines: items.length } });
  return snapshot;
}

ordersRouter.post(
  '/:id/bom/unlock',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const body = parse(z.object({ reason: z.string().min(5, 'Give a reason for editing a confirmed BOM') }), req.body);
    const order = requireOrder(id);
    run('UPDATE bom_items SET is_snapshot = 0 WHERE order_id = ?', id);
    logAudit({
      userId: req.user!.id,
      action: 'bom.unlock',
      entityType: 'order',
      entityId: id,
      entityLabel: order.ref,
      meta: { reason: body.reason, confirmedSnapshotKept: !!order.bom_snapshot },
      manualOverride: true,
    });
    res.json({ bundle: orderBundle(id) });
  }),
);

/* ----------------------------- Recipients ------------------------------ */

const recipientSchema = z.object({
  name: z.string().min(2, 'Recipient name is required'),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address_line1: z.string().optional().nullable(),
  address_line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  personalisation: z.string().optional().nullable(),
  packaging_notes: z.string().optional().nullable(),
  special_instructions: z.string().optional().nullable(),
  fulfilment_location_id: z.coerce.number().int().positive().nullable().optional(),
  status: z.string().optional(),
});

ordersRouter.post(
  '/:id/recipients',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const payload = req.body?.recipients ?? req.body;
    const list = parse(z.union([recipientSchema, z.array(recipientSchema).min(1)]), payload);
    const rows = Array.isArray(list) ? list : [list];
    const created: number[] = [];
    for (const row of rows) {
      const code = String(Math.floor(100 + Math.random() * 900));
      created.push(
        insert('recipients', {
          ...row,
          order_id: id,
          unboxing_code: code,
          status: row.status ?? 'pending',
          fulfilment_location_id: row.fulfilment_location_id ?? order.fulfilment_location_id ?? null,
        }),
      );
    }
    refreshOrderCounters(id);
    logAudit({ userId: req.user!.id, action: 'recipients.add', entityType: 'order', entityId: id, entityLabel: order.ref, meta: { added: created.length } });
    res.status(201).json({ created, bundle: orderBundle(id) });
  }),
);

ordersRouter.patch(
  '/recipients/:id',
  asyncHandler((req, res) => {
    const rid = idParam(req);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', rid), 'Recipient package');
    const body = parse(recipientSchema.partial().omit({ status: true }), req.body);
    update('recipients', rid, { ...body, updated_at: new Date().toISOString() });
    logAudit({ userId: req.user!.id, action: 'recipient.update', entityType: 'recipient', entityId: rid, entityLabel: recipient.name, meta: { orderId: recipient.order_id } });
    res.json({ bundle: orderBundle(recipient.order_id) });
  }),
);

ordersRouter.delete(
  '/recipients/:id',
  asyncHandler((req, res) => {
    const rid = idParam(req);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', rid), 'Recipient package');
    if (['dispatched', 'in_transit', 'delivered'].includes(recipient.status)) {
      throw new ApiError(409, 'A dispatched package cannot be deleted');
    }
    run('DELETE FROM recipients WHERE id = ?', rid);
    refreshOrderCounters(recipient.order_id);
    logAudit({ userId: req.user!.id, action: 'recipient.delete', entityType: 'recipient', entityId: rid, entityLabel: recipient.name, meta: { orderId: recipient.order_id }, manualOverride: true });
    res.json({ bundle: orderBundle(recipient.order_id) });
  }),
);

ordersRouter.post(
  '/recipients/:id/advance',
  asyncHandler((req, res) => {
    const rid = idParam(req);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', rid), 'Recipient package');
    const body = parse(z.object({ status: z.string(), note: z.string().optional().nullable() }), req.body);
    if (!canTransitionPackage(recipient.status, body.status)) {
      throw new ApiError(409, `Package cannot move from ${recipient.status} to ${body.status}`);
    }
    if (['shipment_booked', 'dispatched'].includes(body.status)) {
      throw new ApiError(409, 'Book a shipment record to move a package to that stage');
    }
    setPackageStatus(rid, body.status, req.user!.id, body.note ?? undefined);
    res.json({ bundle: orderBundle(recipient.order_id) });
  }),
);

/* --------------------------------- BOM --------------------------------- */

ordersRouter.post(
  '/:id/bom/generate',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const body = parse(
      z.object({
        template_id: z.coerce.number().int().positive().nullable().optional(),
        replace: z.boolean().default(false),
        items: z
          .array(
            z.object({
              product_id: z.coerce.number().int().positive().nullable().optional(),
              name: z.string().optional(),
              sku: z.string().optional().nullable(),
              qty_per_package: z.coerce.number().int().min(1).default(1),
              customisation: z.string().optional().nullable(),
              cost_category: z.string().default('product'),
            }),
          )
          .optional(),
      }),
      req.body,
    );

    const template = body.template_id
      ? get<any>('SELECT * FROM order_templates WHERE id = ?', body.template_id)
      : order.template_id
        ? get<any>('SELECT * FROM order_templates WHERE id = ?', order.template_id)
        : get<any>('SELECT * FROM order_templates WHERE campaign_type = ? ORDER BY id LIMIT 1', order.campaign_type);

    type Line = { product_id: number | null; name: string; sku?: string | null; qty_per_package: number; customisation?: string | null; cost_category: string };
    const lines: Line[] = [];
    if (body.items?.length) {
      for (const item of body.items) {
        const product = item.product_id ? get<any>('SELECT * FROM products WHERE id = ?', item.product_id) : null;
        lines.push({
          product_id: product?.id ?? null,
          name: product?.name ?? item.name ?? 'Unnamed component',
          sku: product?.sku ?? item.sku ?? null,
          qty_per_package: item.qty_per_package,
          customisation: item.customisation ?? product?.customisation_method ?? null,
          cost_category: item.cost_category || (product?.is_packaging ? 'packaging' : 'product'),
        });
      }
    } else if (template) {
      const components = jsonParse<any[]>(template.suggested_components, []);
      const packaging = jsonParse<any[]>(template.suggested_packaging, []);
      for (const component of [...components, ...packaging]) {
        if (!component?.name) continue;
        const product = component.sku
          ? get<any>('SELECT * FROM products WHERE sku = ?', component.sku)
          : get<any>('SELECT * FROM products WHERE lower(name) = lower(?) ORDER BY id LIMIT 1', component.name);
        lines.push({
          product_id: product?.id ?? null,
          name: product?.name ?? component.name,
          sku: product?.sku ?? component.sku ?? null,
          qty_per_package: Number(component.qty) || 1,
          customisation: component.customisation ?? product?.customisation_method ?? null,
          cost_category: component.category ?? (product?.is_packaging ? 'packaging' : 'product'),
        });
      }
    }

    if (!lines.length) throw new ApiError(400, 'No BOM lines to generate. Pick a template or add components manually.');

    if (body.replace) run('DELETE FROM bom_items WHERE order_id = ? AND is_snapshot = 0', id);
    const existing = all<{ sku_snapshot: string | null }>('SELECT sku_snapshot FROM bom_items WHERE order_id = ? AND is_snapshot = 0', id);
    const existingSkus = new Set(existing.map((e) => e.sku_snapshot));

    const recipientCount = Math.max(order.recipient_count, 1);
    let added = 0;
    for (const line of lines) {
      if (!body.replace && line.sku && existingSkus.has(line.sku)) continue;
      const product = line.product_id ? get<any>('SELECT * FROM products WHERE id = ?', line.product_id) : null;
      let unitCost = product?.purchase_price_paise ?? 0;
      let supplierId = product?.supplier_id ?? null;
      let locationId: number | null = null;
      if (product && order.procurement_city_id) {
        const offer = get<any>(
          `SELECT po.* FROM product_offers po JOIN locations l ON l.id = po.location_id
           WHERE po.product_id = ? AND l.city_id = ? AND po.active = 1 ORDER BY po.unit_price_paise ASC LIMIT 1`,
          product.id,
          order.procurement_city_id,
        );
        if (offer) {
          unitCost = offer.unit_price_paise;
          supplierId = offer.supplier_id ?? supplierId;
          locationId = offer.location_id;
        }
      }
      insert('bom_items', {
        order_id: id,
        product_id: line.product_id,
        sku_snapshot: line.sku ?? null,
        name_snapshot: line.name,
        qty_per_package: line.qty_per_package,
        total_qty: line.qty_per_package * recipientCount,
        unit_cost_paise: unitCost,
        supplier_id: supplierId,
        location_id: locationId,
        customisation: line.customisation ?? null,
        cost_category: line.cost_category,
        notes: line.product_id ? null : 'Not linked to a catalogue product — add a product to capture cost',
      });
      added += 1;
    }
    syncOrderCosts(id);
    logAudit({ userId: req.user!.id, action: 'bom.generate', entityType: 'order', entityId: id, entityLabel: order.ref, meta: { added, template: template?.name ?? null } });
    res.json({ added, bundle: orderBundle(id) });
  }),
);

const bomItemSchema = z.object({
  product_id: z.coerce.number().int().positive().nullable().optional(),
  name_snapshot: z.string().min(1),
  sku_snapshot: z.string().optional().nullable(),
  qty_per_package: z.coerce.number().int().min(1),
  unit_cost_paise: z.coerce.number().int().min(0),
  supplier_id: z.coerce.number().int().positive().nullable().optional(),
  location_id: z.coerce.number().int().positive().nullable().optional(),
  customisation: z.string().optional().nullable(),
  cost_category: z.string().default('product'),
  notes: z.string().optional().nullable(),
});

ordersRouter.post(
  '/:id/bom',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const body = parse(bomItemSchema, req.body);
    const itemId = insert('bom_items', {
      ...body,
      order_id: id,
      total_qty: body.qty_per_package * Math.max(order.recipient_count, 1),
    });
    syncOrderCosts(id);
    logAudit({ userId: req.user!.id, action: 'bom.item.add', entityType: 'order', entityId: id, entityLabel: order.ref, meta: { itemId } });
    res.status(201).json({ bundle: orderBundle(id) });
  }),
);

ordersRouter.patch(
  '/bom/:itemId',
  asyncHandler((req, res) => {
    const itemId = idParam(req);
    const item = requireRow(get<any>('SELECT * FROM bom_items WHERE id = ?', itemId), 'BOM line');
    const order = requireOrder(item.order_id);
    const body = parse(bomItemSchema.partial(), req.body);
    const qty = body.qty_per_package ?? item.qty_per_package;
    update('bom_items', itemId, {
      ...body,
      total_qty: qty * Math.max(order.recipient_count, 1),
    });
    syncOrderCosts(item.order_id);
    logAudit({ userId: req.user!.id, action: 'bom.item.update', entityType: 'order', entityId: item.order_id, entityLabel: order.ref, meta: body });
    res.json({ bundle: orderBundle(item.order_id) });
  }),
);

ordersRouter.delete(
  '/bom/:itemId',
  asyncHandler((req, res) => {
    const itemId = idParam(req);
    const item = requireRow(get<any>('SELECT * FROM bom_items WHERE id = ?', itemId), 'BOM line');
    run('DELETE FROM bom_items WHERE id = ?', itemId);
    syncOrderCosts(item.order_id);
    logAudit({ userId: req.user!.id, action: 'bom.item.delete', entityType: 'order', entityId: item.order_id, meta: { itemId } });
    res.json({ bundle: orderBundle(item.order_id) });
  }),
);

ordersRouter.post(
  '/:id/reserve-stock',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const locationId =
      order.fulfilment_location_id ??
      get<{ id: number }>('SELECT id FROM locations WHERE active = 1 ORDER BY is_fulfilment_hub DESC, id LIMIT 1')?.id;
    if (!locationId) throw new ApiError(400, 'Assign a fulfilment location first');
    const lines = all<any>(
      'SELECT * FROM bom_items WHERE order_id = ? AND product_id IS NOT NULL AND is_snapshot = 0',
      id,
    );
    const reserved: string[] = [];
    const skipped: string[] = [];
    for (const line of lines) {
      const stock = stockAt(line.product_id, locationId);
      if (stock.qty_available >= line.total_qty) {
        applyMovement({
          productId: line.product_id,
          locationId,
          type: 'reserve',
          qty: line.total_qty,
          refType: 'order',
          refId: id,
          reason: `Reserved for ${order.ref}`,
          userId: req.user!.id,
        });
        reserved.push(`${line.name_snapshot} ×${line.total_qty}`);
      } else {
        skipped.push(`${line.name_snapshot} (need ${line.total_qty}, have ${stock.qty_available})`);
      }
    }
    logAudit({ userId: req.user!.id, action: 'inventory.reserve', entityType: 'order', entityId: id, entityLabel: order.ref, meta: { reserved, skipped } });
    res.json({ reserved, skipped, bundle: orderBundle(id) });
  }),
);

/* ------------------------------ Cost items ----------------------------- */

const costItemSchema = z.object({
  category: z.enum(['product', 'packaging', 'printing', 'customisation', 'labour', 'shipping', 'payment_fee', 'tax', 'replacement', 'other']),
  description: z.string().optional().nullable(),
  estimated_paise: z.coerce.number().int().min(0).default(0),
  actual_paise: z.coerce.number().int().min(0).default(0),
});

ordersRouter.post(
  '/:id/costs',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const body = parse(costItemSchema, req.body);
    insert('order_cost_items', { ...body, order_id: id });
    syncOrderCosts(id);
    logAudit({ userId: req.user!.id, action: 'costing.add', entityType: 'order', entityId: id, entityLabel: order.ref, meta: body });
    res.status(201).json({ bundle: orderBundle(id) });
  }),
);

ordersRouter.patch(
  '/costs/:itemId',
  asyncHandler((req, res) => {
    const itemId = idParam(req);
    const item = requireRow(get<any>('SELECT * FROM order_cost_items WHERE id = ?', itemId), 'Cost line');
    const body = parse(costItemSchema.partial(), req.body);
    update('order_cost_items', itemId, { ...body, updated_at: new Date().toISOString() });
    syncOrderCosts(item.order_id);
    res.json({ bundle: orderBundle(item.order_id) });
  }),
);

ordersRouter.delete(
  '/costs/:itemId',
  asyncHandler((req, res) => {
    const itemId = idParam(req);
    const item = requireRow(get<any>('SELECT * FROM order_cost_items WHERE id = ?', itemId), 'Cost line');
    run('DELETE FROM order_cost_items WHERE id = ?', itemId);
    syncOrderCosts(item.order_id);
    res.json({ bundle: orderBundle(item.order_id) });
  }),
);

ordersRouter.post(
  '/:id/costs/apply-tax',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const tax = getSetting('tax');
    const breakdown = orderCostBreakdown(id);
    const ratePct = Number((req.body?.ratePct ?? tax.defaultRatePct) || 0);
    const taxable = breakdown.bomEstimatedPaise + breakdown.costItems.filter((c) => c.category !== 'tax').reduce((s, c) => s + c.estimatedPaise, 0);
    insert('order_cost_items', {
      order_id: id,
      category: 'tax',
      description: `${tax.label || 'Tax'} @ ${ratePct}%`,
      estimated_paise: Math.round((taxable * ratePct) / 100),
      actual_paise: Math.round((taxable * ratePct) / 100),
      auto_generated: 1,
    });
    syncOrderCosts(id);
    logAudit({ userId: req.user!.id, action: 'costing.tax', entityType: 'order', entityId: id, entityLabel: order.ref, meta: { ratePct } });
    res.json({ bundle: orderBundle(id) });
  }),
);

/* ---------------------------- Work orders ------------------------------ */

ordersRouter.post(
  '/:id/work-orders',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const created = generateWorkOrders(id, req.user!.id);
    res.json({ created, bundle: orderBundle(id) });
  }),
);

ordersRouter.get(
  '/:id/costing',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireOrder(id);
    res.json({ costing: orderCostBreakdown(id) });
  }),
);

ordersRouter.post(
  '/:id/close',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const order = requireOrder(id);
    const open = get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM recipients WHERE order_id = ? AND status NOT IN ('delivered')",
      id,
    )!.c;
    const body = parse(z.object({ force: z.boolean().default(false), note: z.string().optional().nullable() }), req.body ?? {});
    if (open > 0 && !body.force) {
      throw new ApiError(409, `${open} package(s) are not delivered yet. Use force close with a note to override.`);
    }
    if (open > 0) {
      logAudit({
        userId: req.user!.id,
        action: 'order.close.override',
        entityType: 'order',
        entityId: id,
        entityLabel: order.ref,
        meta: { undeliveredPackages: open, note: body.note ?? null },
        manualOverride: true,
      });
    }
    if (['delivered', 'closed'].includes(order.status)) setOrderStatus(id, 'closed', { userId: req.user!.id, note: body.note ?? 'Order closed' });
    else setOrderStatus(id, 'closed', { userId: req.user!.id, note: body.note ?? 'Order closed' });
    res.json({ bundle: orderBundle(id) });
  }),
);

ordersRouter.get(
  '/:id/history',
  asyncHandler((req, res) => {
    const id = idParam(req);
    res.json({
      history: all<any>(
        `SELECT h.*, u.name AS user_name FROM order_status_history h LEFT JOIN users u ON u.id = h.user_id
         WHERE h.order_id = ? ORDER BY h.id DESC`,
        id,
      ),
      labels: ORDER_STATUS_LABEL,
    });
  }),
);
