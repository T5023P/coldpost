import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';

export const suppliersRouter = Router();

const supplierSelect = `SELECT s.*, c.name AS city_name,
  (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id) AS po_count,
  (SELECT COALESCE(SUM(p.total_paise),0) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status <> 'cancelled') AS spend_paise,
  (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.actual_delivery IS NOT NULL
     AND p.expected_delivery IS NOT NULL AND p.actual_delivery <= p.expected_delivery) AS on_time_count,
  (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.id AND p.actual_delivery IS NOT NULL) AS delivered_count,
  (SELECT COUNT(*) FROM products pr WHERE pr.supplier_id = s.id) AS product_count,
  (SELECT COUNT(*) FROM locations l WHERE l.supplier_id = s.id) AS branch_count
  FROM suppliers s LEFT JOIN cities c ON c.id = s.city_id`;

suppliersRouter.get(
  '/',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.search) {
      clauses.push('(s.name LIKE ? OR s.category LIKE ? OR s.contact_person LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    if (q.city_id) {
      clauses.push('s.city_id = ?');
      params.push(Number(q.city_id));
    }
    const rows = all<any>(`${supplierSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY s.name`, ...params);
    res.json({ suppliers: rows });
  }),
);

suppliersRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const supplier = requireRow(get<any>(`${supplierSelect} WHERE s.id = ?`, id), 'Supplier');
    const products = all<any>('SELECT * FROM products WHERE supplier_id = ? ORDER BY name', id);
    const offers = all<any>(
      `SELECT o.*, p.name AS product_name, p.sku, l.name AS location_name, c.name AS city_name
       FROM product_offers o JOIN products p ON p.id = o.product_id
       LEFT JOIN locations l ON l.id = o.location_id LEFT JOIN cities c ON c.id = l.city_id
       WHERE o.supplier_id = ? ORDER BY p.name`,
      id,
    );
    const purchaseOrders = all<any>(
      `SELECT p.*, o.ref AS order_ref FROM purchase_orders p LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.supplier_id = ? ORDER BY p.id DESC`,
      id,
    );
    const branches = all<any>(
      `SELECT l.*, c.name AS city_name FROM locations l JOIN cities c ON c.id = l.city_id WHERE l.supplier_id = ?`,
      id,
    );
    const performance = get<any>(
      `SELECT COUNT(*) AS po_count,
              COALESCE(SUM(CASE WHEN actual_delivery IS NOT NULL AND expected_delivery IS NOT NULL AND actual_delivery <= expected_delivery THEN 1 ELSE 0 END),0) AS on_time,
              COALESCE(SUM(CASE WHEN actual_delivery IS NOT NULL THEN 1 ELSE 0 END),0) AS delivered,
              COALESCE(SUM(total_paise),0) AS spend_paise
       FROM purchase_orders WHERE supplier_id = ?`,
      id,
    );
    res.json({ supplier, products, offers, purchaseOrders, branches, performance });
  }),
);

const supplierSchema = z.object({
  name: z.string().min(2, 'Supplier name is required'),
  category: z.string().optional().nullable(),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  city_id: z.coerce.number().int().positive().nullable().optional(),
  address: z.string().optional().nullable(),
  products_supplied: z.string().optional().nullable(),
  moq: z.coerce.number().int().min(0).nullable().optional(),
  lead_time_days: z.coerce.number().int().min(0).nullable().optional(),
  payment_terms: z.string().optional().nullable(),
  quality_rating: z.coerce.number().min(0).max(5).nullable().optional(),
  reliability_notes: z.string().optional().nullable(),
  backup_supplier_id: z.coerce.number().int().positive().nullable().optional(),
  active: z.union([z.boolean(), z.number()]).default(true),
});

suppliersRouter.post(
  '/',
  asyncHandler((req, res) => {
    const body = parse(supplierSchema, req.body);
    const id = insert('suppliers', { ...body, active: body.active ? 1 : 0 });
    logAudit({ userId: req.user!.id, action: 'supplier.create', entityType: 'supplier', entityId: id, entityLabel: body.name });
    res.status(201).json({ supplier: get(`${supplierSelect} WHERE s.id = ?`, id) });
  }),
);

suppliersRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM suppliers WHERE id = ?', id), 'Supplier');
    const body = parse(supplierSchema.partial(), req.body);
    update('suppliers', id, {
      ...body,
      ...(body.active === undefined ? {} : { active: body.active ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    });
    logAudit({ userId: req.user!.id, action: 'supplier.update', entityType: 'supplier', entityId: id, meta: body });
    res.json({ supplier: get(`${supplierSelect} WHERE s.id = ?`, id) });
  }),
);

/** Side-by-side comparison for procurement decisions. */
suppliersRouter.get(
  '/compare/offers',
  asyncHandler((req, res) => {
    const productId = Number(req.query.product_id);
    if (!productId) {
      res.status(400).json({ error: 'product_id is required' });
      return;
    }
    const rows = all<any>(
      `SELECT o.*, s.name AS supplier_name, s.quality_rating, s.lead_time_days AS supplier_lead_time,
              s.payment_terms, l.name AS location_name, l.category AS store_category,
              c.name AS city_name, c.id AS city_id, COALESCE(i.qty_available,0) AS stock_available
       FROM product_offers o
       JOIN products p ON p.id = o.product_id
       LEFT JOIN suppliers s ON s.id = o.supplier_id
       LEFT JOIN locations l ON l.id = o.location_id
       LEFT JOIN cities c ON c.id = l.city_id
       LEFT JOIN inventory i ON i.product_id = o.product_id AND i.location_id = o.location_id
       WHERE o.product_id = ? AND o.active = 1 ORDER BY o.unit_price_paise`,
      productId,
    );
    res.json({ offers: rows });
  }),
);
