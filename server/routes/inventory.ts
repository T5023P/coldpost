import { Router } from 'express';
import { z } from 'zod';
import { all, get } from '../db.js';
import { asyncHandler, parse } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { applyMovement, lowStockProducts, transferStock } from '../lib/inventory.js';
import { requireRow } from '../lib/http.js';

export const inventoryRouter = Router();

inventoryRouter.get(
  '/',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = ['l.active = 1'];
    const params: any[] = [];
    if (q.location_id) {
      clauses.push('i.location_id = ?');
      params.push(Number(q.location_id));
    }
    if (q.city_id) {
      clauses.push('l.city_id = ?');
      params.push(Number(q.city_id));
    }
    if (q.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`);
    }
    const rows = all<any>(
      `SELECT i.*, p.name AS product_name, p.sku, p.uom, p.min_stock, p.category,
              l.name AS location_name, l.category AS location_category, c.name AS city_name, c.id AS city_id
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       JOIN locations l ON l.id = i.location_id
       JOIN cities c ON c.id = l.city_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.name, l.name, p.name`,
      ...params,
    );
    const totals = all<any>(
      `SELECT p.id, p.name, p.sku, p.min_stock,
              COALESCE(SUM(i.qty_available),0) AS available,
              COALESCE(SUM(i.qty_reserved),0) AS reserved,
              COALESCE(SUM(i.qty_damaged),0) AS damaged,
              COUNT(DISTINCT i.location_id) AS location_count
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
       GROUP BY p.id ORDER BY p.name`,
    );
    const low = lowStockProducts();
    const incoming = all<any>(
      `SELECT i.product_id, COALESCE(SUM(i.qty_requested - i.qty_received - i.qty_rejected),0) AS incoming
       FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.purchase_order_id
       WHERE p.status IN ('draft','sent','partial') GROUP BY i.product_id`,
    );
    res.json({ rows, totals, lowStock: low, incoming });
  }),
);

inventoryRouter.get(
  '/movements',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.product_id) {
      clauses.push('m.product_id = ?');
      params.push(Number(q.product_id));
    }
    if (q.location_id) {
      clauses.push('m.location_id = ?');
      params.push(Number(q.location_id));
    }
    if (q.type) {
      clauses.push('m.type = ?');
      params.push(q.type);
    }
    const limit = Math.min(Number(q.limit) || 200, 500);
    const rows = all<any>(
      `SELECT m.*, p.name AS product_name, p.sku, l.name AS location_name, c.name AS city_name, u.name AS user_name
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
       JOIN locations l ON l.id = m.location_id JOIN cities c ON c.id = l.city_id
       LEFT JOIN users u ON u.id = m.user_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY m.id DESC LIMIT ?`,
      ...params,
      limit,
    );
    res.json({ movements: rows });
  }),
);

inventoryRouter.post(
  '/adjust',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        product_id: z.coerce.number().int().positive(),
        location_id: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().refine((v) => v !== 0, 'Quantity must not be zero'),
        reason: z.string().min(3, 'A reason is required for stock corrections'),
      }),
      req.body,
    );
    const product = requireRow(get<any>('SELECT * FROM products WHERE id = ?', body.product_id), 'Product');
    requireRow(get('SELECT id FROM locations WHERE id = ?', body.location_id), 'Store');
    const movementId = applyMovement({
      productId: body.product_id,
      locationId: body.location_id,
      type: 'adjust',
      qty: body.qty,
      reason: body.reason,
      userId: req.user!.id,
      refType: 'manual_adjustment',
    });
    logAudit({
      userId: req.user!.id,
      action: 'inventory.adjust',
      entityType: 'product',
      entityId: body.product_id,
      entityLabel: product.name,
      meta: { qty: body.qty, locationId: body.location_id, reason: body.reason, movementId },
      manualOverride: true,
    });
    res.json({ movementId });
  }),
);

inventoryRouter.post(
  '/receive',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        product_id: z.coerce.number().int().positive(),
        location_id: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().positive(),
        reason: z.string().optional().nullable(),
      }),
      req.body,
    );
    const movementId = applyMovement({
      productId: body.product_id,
      locationId: body.location_id,
      type: 'receive',
      qty: body.qty,
      reason: body.reason ?? 'Manual stock receipt',
      userId: req.user!.id,
      refType: 'manual_receipt',
    });
    logAudit({ userId: req.user!.id, action: 'inventory.receive', entityType: 'product', entityId: body.product_id, meta: body });
    res.json({ movementId });
  }),
);

inventoryRouter.post(
  '/transfer',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        product_id: z.coerce.number().int().positive(),
        from_location_id: z.coerce.number().int().positive(),
        to_location_id: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().positive(),
        note: z.string().optional().nullable(),
      }),
      req.body,
    );
    const result = transferStock({
      productId: body.product_id,
      fromLocationId: body.from_location_id,
      toLocationId: body.to_location_id,
      qty: body.qty,
      note: body.note ?? undefined,
      userId: req.user!.id,
    });
    logAudit({
      userId: req.user!.id,
      action: 'inventory.transfer',
      entityType: 'product',
      entityId: body.product_id,
      meta: { ...body, group: result.group },
    });
    res.json(result);
  }),
);
