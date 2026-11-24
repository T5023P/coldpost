import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, tx, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { nextRef } from '../lib/numbering.js';
import { applyMovement } from '../lib/inventory.js';
import { getSetting } from '../lib/settings.js';
import { syncOrderCosts } from '../lib/costing.js';
import { tryOrderStatus } from '../lib/orders.js';
import { ApiError } from '../lib/http.js';

export const procurementRouter = Router();

const poSelect = `SELECT p.*, s.name AS supplier_name, o.ref AS order_ref, o.campaign_name,
  l.name AS location_name, c.name AS city_name,
  (SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = p.id) AS line_count
  FROM purchase_orders p
  JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN orders o ON o.id = p.order_id
  LEFT JOIN locations l ON l.id = p.location_id
  LEFT JOIN cities c ON c.id = l.city_id`;

procurementRouter.get(
  '/purchase-orders',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.status) {
      clauses.push('p.status = ?');
      params.push(q.status);
    }
    if (q.supplier_id) {
      clauses.push('p.supplier_id = ?');
      params.push(Number(q.supplier_id));
    }
    if (q.order_id) {
      clauses.push('p.order_id = ?');
      params.push(Number(q.order_id));
    }
    if (q.city_id) {
      clauses.push('l.city_id = ?');
      params.push(Number(q.city_id));
    }
    if (q.search) {
      clauses.push('(p.ref LIKE ? OR s.name LIKE ? OR o.ref LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    const rows = all<any>(`${poSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY p.id DESC LIMIT 300`, ...params);
    res.json({ purchaseOrders: rows });
  }),
);

const poItemSchema = z.object({
  product_id: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().optional().nullable(),
  qty_requested: z.coerce.number().int().min(1),
  unit_price_paise: z.coerce.number().int().min(0),
  notes: z.string().optional().nullable(),
});

const poCreateSchema = z.object({
  supplier_id: z.coerce.number().int().positive(),
  order_id: z.coerce.number().int().positive().nullable().optional(),
  location_id: z.coerce.number().int().positive().nullable().optional(),
  expected_delivery: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(poItemSchema).min(1, 'Add at least one line'),
  advance_override_reason: z.string().optional().nullable(),
  status: z.enum(['draft', 'sent']).default('draft'),
});

procurementRouter.post(
  '/purchase-orders',
  asyncHandler((req, res) => {
    const body = parse(poCreateSchema, req.body);
    const supplier = requireRow(get<any>('SELECT * FROM suppliers WHERE id = ?', body.supplier_id), 'Supplier');
    let overrideReason: string | null = null;
    let warning: string | null = null;

    if (body.order_id) {
      const order = requireRow(
        get<any>('SELECT * FROM orders WHERE id = ?', body.order_id),
        'Order',
      );
      const procurement = getSetting('procurement');
      const requirement = Math.round((order.total_value_paise * (procurement.advanceRequirementPct || 0)) / 100);
      if (order.advance_received_paise < requirement) {
        if (!body.advance_override_reason || body.advance_override_reason.trim().length < 5) {
          throw new ApiError(
            409,
            `Advance not received: ₹${(requirement / 100).toLocaleString('en-IN')} required (${procurement.advanceRequirementPct}% of ₹${(order.total_value_paise / 100).toLocaleString('en-IN')}), only ₹${(order.advance_received_paise / 100).toLocaleString('en-IN')} received. Add an override reason to proceed.`,
          );
        }
        overrideReason = body.advance_override_reason;
        warning = 'Purchase created before the required advance was received — override recorded';
      }
    }

    const total = body.items.reduce((sum, item) => sum + item.qty_requested * item.unit_price_paise, 0);
    const created = tx(() => {
      const ref = nextRef('purchase');
      const poId = insert('purchase_orders', {
        ref,
        supplier_id: body.supplier_id,
        order_id: body.order_id ?? null,
        location_id: body.location_id ?? null,
        status: body.status,
        expected_delivery: body.expected_delivery ?? null,
        notes: body.notes ?? null,
        total_paise: total,
        advance_warning_override_reason: overrideReason,
        created_by: req.user!.id,
      });
      for (const item of body.items) {
        insert('purchase_order_items', {
          purchase_order_id: poId,
          product_id: item.product_id ?? null,
          description: item.description ?? null,
          qty_requested: item.qty_requested,
          unit_price_paise: item.unit_price_paise,
          notes: item.notes ?? null,
        });
      }
      if (body.order_id && body.status === 'sent') {
        tryOrderStatus(body.order_id, 'procurement', { userId: req.user!.id, note: `PO ${ref} sent to ${supplier.name}` });
      }
      logAudit({
        userId: req.user!.id,
        action: 'purchase-order.create',
        entityType: 'purchase_order',
        entityId: poId,
        entityLabel: ref,
        meta: { supplier: supplier.name, total, overrideReason, orderId: body.order_id ?? null },
        manualOverride: !!overrideReason,
      });
      return poId;
    });

    res.status(201).json({
      purchaseOrder: get(`${poSelect} WHERE p.id = ?`, created),
      items: all('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', created),
      warning,
    });
  }),
);

procurementRouter.get(
  '/purchase-orders/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const po = requireRow(get<any>(`${poSelect} WHERE p.id = ?`, id), 'Purchase order');
    const items = all<any>(
      `SELECT i.*, p.name AS product_name, p.sku, p.uom FROM purchase_order_items i
       LEFT JOIN products p ON p.id = i.product_id WHERE i.purchase_order_id = ? ORDER BY i.id`,
      id,
    );
    const movements = all<any>(
      `SELECT m.*, p.name AS product_name, l.name AS location_name, u.name AS user_name
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
       JOIN locations l ON l.id = m.location_id LEFT JOIN users u ON u.id = m.user_id
       WHERE m.ref_type = 'purchase_order' AND m.ref_id = ? ORDER BY m.id DESC`,
      id,
    );
    const attachments = all<any>(
      "SELECT * FROM attachments WHERE entity_type = 'purchase_order' AND entity_id = ? ORDER BY id DESC",
      id,
    );
    res.json({ purchaseOrder: po, items, movements, attachments });
  }),
);

procurementRouter.patch(
  '/purchase-orders/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const po = requireRow(get<any>('SELECT * FROM purchase_orders WHERE id = ?', id), 'Purchase order');
    const body = parse(
      z.object({
        expected_delivery: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        status: z.enum(['draft', 'sent', 'partial', 'received', 'cancelled']).optional(),
        payment_status: z.enum(['unpaid', 'partial', 'paid']).optional(),
        location_id: z.coerce.number().int().positive().nullable().optional(),
        invoice_path: z.string().optional().nullable(),
      }),
      req.body,
    );
    update('purchase_orders', id, { ...body, updated_at: new Date().toISOString() });
    logAudit({ userId: req.user!.id, action: 'purchase-order.update', entityType: 'purchase_order', entityId: id, entityLabel: po.ref, meta: body });
    res.json({ purchaseOrder: get(`${poSelect} WHERE p.id = ?`, id) });
  }),
);

procurementRouter.post(
  '/purchase-orders/:id/payment',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const po = requireRow(get<any>('SELECT * FROM purchase_orders WHERE id = ?', id), 'Purchase order');
    const body = parse(
      z.object({ paid_paise: z.coerce.number().int().min(0), note: z.string().optional().nullable() }),
      req.body,
    );
    const status = body.paid_paise >= po.total_paise ? 'paid' : body.paid_paise > 0 ? 'partial' : 'unpaid';
    update('purchase_orders', id, { paid_paise: body.paid_paise, payment_status: status, updated_at: new Date().toISOString() });
    logAudit({ userId: req.user!.id, action: 'purchase-order.payment', entityType: 'purchase_order', entityId: id, entityLabel: po.ref, meta: { paid: body.paid_paise, status, note: body.note } });
    res.json({ purchaseOrder: get(`${poSelect} WHERE p.id = ?`, id) });
  }),
);

procurementRouter.post(
  '/purchase-orders/:id/items',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const po = requireRow(get<any>('SELECT * FROM purchase_orders WHERE id = ?', id), 'Purchase order');
    const body = parse(poItemSchema, req.body);
    insert('purchase_order_items', { ...body, purchase_order_id: id });
    const total = get<{ t: number }>(
      'SELECT COALESCE(SUM(qty_requested * unit_price_paise),0) AS t FROM purchase_order_items WHERE purchase_order_id = ?',
      id,
    )!.t;
    run('UPDATE purchase_orders SET total_paise = ? WHERE id = ?', total, id);
    logAudit({ userId: req.user!.id, action: 'purchase-order.item.add', entityType: 'purchase_order', entityId: id, entityLabel: po.ref });
    res.status(201).json({ purchaseOrder: get(`${poSelect} WHERE p.id = ?`, id) });
  }),
);

procurementRouter.delete(
  '/purchase-order-items/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const item = requireRow(get<any>('SELECT * FROM purchase_order_items WHERE id = ?', id), 'PO line');
    const po = requireRow(get<any>('SELECT * FROM purchase_orders WHERE id = ?', item.purchase_order_id), 'Purchase order');
    if (item.qty_received > 0) throw new ApiError(409, 'Cannot delete a line that has already been received against');
    run('DELETE FROM purchase_order_items WHERE id = ?', id);
    const total = get<{ t: number }>(
      'SELECT COALESCE(SUM(qty_requested * unit_price_paise),0) AS t FROM purchase_order_items WHERE purchase_order_id = ?',
      po.id,
    )!.t;
    run('UPDATE purchase_orders SET total_paise = ? WHERE id = ?', total, po.id);
    res.json({ ok: true });
  }),
);

/** Partial receiving: each line can arrive in multiple deliveries. */
procurementRouter.post(
  '/purchase-orders/:id/receive',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const po = requireRow(get<any>('SELECT * FROM purchase_orders WHERE id = ?', id), 'Purchase order');
    if (po.status === 'cancelled') throw new ApiError(409, 'This purchase order is cancelled');
    const body = parse(
      z.object({
        location_id: z.coerce.number().int().positive().nullable().optional(),
        date: z.string().optional().nullable(),
        note: z.string().optional().nullable(),
        lines: z
          .array(
            z.object({
              item_id: z.coerce.number().int().positive(),
              received: z.coerce.number().int().min(0).default(0),
              rejected: z.coerce.number().int().min(0).default(0),
              unit_price_paise: z.coerce.number().int().min(0).optional(),
            }),
          )
          .min(1),
      }),
      req.body,
    );
    const locationId = body.location_id ?? po.location_id;
    if (!locationId) throw new ApiError(400, 'Choose the store or warehouse receiving this delivery');

    const result = tx(() => {
      let receivedTotal = 0;
      const summary: string[] = [];
      for (const line of body.lines) {
        if (line.received === 0 && line.rejected === 0) continue;
        const item = requireRow(
          get<any>('SELECT * FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?', line.item_id, id),
          'PO line',
        );
        const outstanding = item.qty_requested - item.qty_received - item.qty_rejected;
        if (line.received + line.rejected > outstanding) {
          throw new ApiError(409, `Receiving more than outstanding for ${item.description ?? `line ${item.id}`} (outstanding ${outstanding})`);
        }
        run(
          'UPDATE purchase_order_items SET qty_received = qty_received + ?, qty_rejected = qty_rejected + ?, unit_price_paise = ? WHERE id = ?',
          line.received,
          line.rejected,
          line.unit_price_paise ?? item.unit_price_paise,
          item.id,
        );
        if (item.product_id && line.received > 0) {
          applyMovement({
            productId: item.product_id,
            locationId,
            type: 'receive',
            qty: line.received,
            refType: 'purchase_order',
            refId: id,
            reason: `Received against ${po.ref}`,
            userId: req.user!.id,
          });
        }
        if (item.product_id && line.rejected > 0) {
          applyMovement({
            productId: item.product_id,
            locationId,
            type: 'reject',
            qty: line.rejected,
            refType: 'purchase_order',
            refId: id,
            reason: `Rejected on receipt against ${po.ref}`,
            userId: req.user!.id,
          });
        }
        receivedTotal += line.received;
        summary.push(`${item.description ?? item.product_id}: +${line.received}${line.rejected ? `, rejected ${line.rejected}` : ''}`);
      }

      const lines = all<any>('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', id);
      const fullyReceived = lines.every((l) => l.qty_received + l.qty_rejected >= l.qty_requested);
      const anyReceived = lines.some((l) => l.qty_received > 0);
      const status = fullyReceived ? 'received' : anyReceived ? 'partial' : po.status;
      run(
        "UPDATE purchase_orders SET status = ?, actual_delivery = COALESCE(?, actual_delivery), updated_at = datetime('now') WHERE id = ?",
        status,
        fullyReceived ? body.date ?? new Date().toISOString().slice(0, 10) : null,
        id,
      );

      if (po.order_id) {
        const openPos = get<{ c: number }>(
          "SELECT COUNT(*) AS c FROM purchase_orders WHERE order_id = ? AND status IN ('draft','sent','partial')",
          po.order_id,
        )!.c;
        if (openPos === 0) tryOrderStatus(po.order_id, 'items_received', { userId: req.user!.id, note: 'All purchase orders received' });
        syncOrderCosts(po.order_id);
      }
      logAudit({
        userId: req.user!.id,
        action: 'purchase-order.receive',
        entityType: 'purchase_order',
        entityId: id,
        entityLabel: po.ref,
        meta: { receivedTotal, summary, locationId, note: body.note ?? null, status },
      });
      return { status, fullyReceived, receivedTotal };
    });

    res.json({
      ...result,
      purchaseOrder: get(`${poSelect} WHERE p.id = ?`, id),
      items: all('SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id', id),
    });
  }),
);
