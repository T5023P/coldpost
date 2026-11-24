import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { PRODUCT_CATEGORIES, CUSTOMISATION_METHODS } from '../lib/statuses.js';

export const catalogRouter = Router();

catalogRouter.get(
  '/products',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.category) {
      clauses.push('p.category = ?');
      params.push(q.category);
    }
    if (q.active === 'true') clauses.push('p.active = 1');
    if (q.supplier_id) {
      clauses.push('p.supplier_id = ?');
      params.push(Number(q.supplier_id));
    }
    const rows = all<any>(
      `SELECT p.*, s.name AS supplier_name,
              COALESCE((SELECT SUM(i.qty_available) FROM inventory i WHERE i.product_id = p.id),0) AS stock_available,
              COALESCE((SELECT SUM(i.qty_reserved) FROM inventory i WHERE i.product_id = p.id),0) AS stock_reserved,
              COALESCE((SELECT SUM(i.qty_damaged) FROM inventory i WHERE i.product_id = p.id),0) AS stock_damaged,
              (SELECT COUNT(*) FROM product_offers o WHERE o.product_id = p.id AND o.active = 1) AS offer_count,
              (SELECT COUNT(DISTINCT l.city_id) FROM product_offers o JOIN locations l ON l.id = o.location_id WHERE o.product_id = p.id) AS city_count
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY p.name`,
      ...params,
    );
    res.json({ products: rows });
  }),
);

catalogRouter.get(
  '/products/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const product = requireRow(get<any>('SELECT * FROM products WHERE id = ?', id), 'Product');
    const offers = all<any>(
      `SELECT o.*, s.name AS supplier_name, s.quality_rating, s.lead_time_days AS supplier_lead_time,
              l.name AS location_name, l.category AS location_category, c.name AS city_name, c.id AS city_id,
              COALESCE(i.qty_available,0) AS stock_available
       FROM product_offers o
       LEFT JOIN suppliers s ON s.id = o.supplier_id
       LEFT JOIN locations l ON l.id = o.location_id
       LEFT JOIN cities c ON c.id = l.city_id
       LEFT JOIN inventory i ON i.product_id = o.product_id AND i.location_id = o.location_id
       WHERE o.product_id = ? ORDER BY o.unit_price_paise`,
      id,
    );
    const inventory = all<any>(
      `SELECT i.*, l.name AS location_name, l.category AS location_category, c.name AS city_name
       FROM inventory i JOIN locations l ON l.id = i.location_id JOIN cities c ON c.id = l.city_id
       WHERE i.product_id = ? ORDER BY c.name, l.name`,
      id,
    );
    const movements = all<any>(
      `SELECT m.*, l.name AS location_name, u.name AS user_name FROM inventory_movements m
       JOIN locations l ON l.id = m.location_id LEFT JOIN users u ON u.id = m.user_id
       WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 50`,
      id,
    );
    const inBoms = get<{ c: number }>('SELECT COUNT(*) AS c FROM bom_items WHERE product_id = ?', id)!.c;
    res.json({ product, offers, inventory, movements, usedInBoms: inBoms });
  }),
);

const productSchema = z.object({
  sku: z.string().min(2, 'SKU is required'),
  name: z.string().min(2, 'Product name is required'),
  category: z.enum(PRODUCT_CATEGORIES).default('stationery'),
  description: z.string().optional().nullable(),
  image_path: z.string().optional().nullable(),
  supplier_id: z.coerce.number().int().positive().nullable().optional(),
  purchase_price_paise: z.coerce.number().int().min(0).default(0),
  selling_price_paise: z.coerce.number().int().min(0).default(0),
  min_stock: z.coerce.number().int().min(0).default(0),
  uom: z.string().default('pcs'),
  customisation_method: z.enum(CUSTOMISATION_METHODS).optional().nullable(),
  personalisation_notes: z.string().optional().nullable(),
  dimensions: z.string().optional().nullable(),
  weight_g: z.coerce.number().int().min(0).nullable().optional(),
  is_packaging: z.union([z.boolean(), z.number()]).default(false),
  active: z.union([z.boolean(), z.number()]).default(true),
});

catalogRouter.post(
  '/products',
  asyncHandler((req, res) => {
    const body = parse(productSchema, req.body);
    if (get('SELECT id FROM products WHERE sku = ?', body.sku)) {
      res.status(409).json({ error: `SKU ${body.sku} already exists` });
      return;
    }
    const id = insert('products', { ...body, is_packaging: body.is_packaging ? 1 : 0, active: body.active ? 1 : 0 });
    logAudit({ userId: req.user!.id, action: 'product.create', entityType: 'product', entityId: id, entityLabel: body.name });
    res.status(201).json({ product: get('SELECT * FROM products WHERE id = ?', id) });
  }),
);

catalogRouter.patch(
  '/products/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const existing = requireRow(get<any>('SELECT * FROM products WHERE id = ?', id), 'Product');
    const body = parse(productSchema.partial(), req.body);
    update('products', id, {
      ...body,
      ...(body.is_packaging === undefined ? {} : { is_packaging: body.is_packaging ? 1 : 0 }),
      ...(body.active === undefined ? {} : { active: body.active ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    });
    logAudit({ userId: req.user!.id, action: 'product.update', entityType: 'product', entityId: id, entityLabel: existing.name, meta: body });
    res.json({ product: get('SELECT * FROM products WHERE id = ?', id) });
  }),
);

/* ------------------------------ Offers --------------------------------- */

const offerSchema = z.object({
  supplier_id: z.coerce.number().int().positive().nullable().optional(),
  location_id: z.coerce.number().int().positive().nullable().optional(),
  unit_price_paise: z.coerce.number().int().min(0),
  moq: z.coerce.number().int().min(1).default(1),
  lead_time_days: z.coerce.number().int().min(0).nullable().optional(),
  notes: z.string().optional().nullable(),
  active: z.union([z.boolean(), z.number()]).default(true),
});

catalogRouter.post(
  '/products/:id/offers',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const product = requireRow(get<any>('SELECT * FROM products WHERE id = ?', id), 'Product');
    const body = parse(offerSchema, req.body);
    const offerId = insert('product_offers', { ...body, product_id: id, active: body.active ? 1 : 0 });
    logAudit({ userId: req.user!.id, action: 'offer.create', entityType: 'product', entityId: id, entityLabel: product.name, meta: body });
    res.status(201).json({ offer: get('SELECT * FROM product_offers WHERE id = ?', offerId) });
  }),
);

catalogRouter.patch(
  '/offers/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM product_offers WHERE id = ?', id), 'Offer');
    const body = parse(offerSchema.partial(), req.body);
    update('product_offers', id, {
      ...body,
      ...(body.active === undefined ? {} : { active: body.active ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    });
    res.json({ offer: get('SELECT * FROM product_offers WHERE id = ?', id) });
  }),
);

catalogRouter.delete(
  '/offers/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM product_offers WHERE id = ?', id), 'Offer');
    run('DELETE FROM product_offers WHERE id = ?', id);
    res.json({ ok: true });
  }),
);

/** Compare every city/store/supplier option for one product. */
catalogRouter.get(
  '/products/:id/availability',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const cityId = req.query.city_id ? Number(req.query.city_id) : null;
    const rows = all<any>(
      `SELECT o.*, s.name AS supplier_name, s.quality_rating, s.lead_time_days AS supplier_lead_time,
              l.id AS location_id, l.name AS location_name, l.category AS store_category, l.rating AS store_rating,
              c.id AS city_id, c.name AS city_name, COALESCE(i.qty_available,0) AS stock_available,
              COALESCE(i.qty_reserved,0) AS stock_reserved
       FROM product_offers o
       LEFT JOIN suppliers s ON s.id = o.supplier_id
       LEFT JOIN locations l ON l.id = o.location_id
       LEFT JOIN cities c ON c.id = l.city_id
       LEFT JOIN inventory i ON i.product_id = o.product_id AND i.location_id = o.location_id
       WHERE o.product_id = ? AND o.active = 1 ${cityId ? 'AND l.city_id = ?' : ''}
       ORDER BY o.unit_price_paise ASC`,
      ...(cityId ? [id, cityId] : [id]),
    );
    res.json({ options: rows });
  }),
);

/* ----------------------------- Templates ------------------------------- */

catalogRouter.get(
  '/templates',
  asyncHandler((req, res) => {
    res.json({ templates: all<any>('SELECT * FROM order_templates ORDER BY id') });
  }),
);

const templateSchema = z.object({
  name: z.string().min(2),
  campaign_type: z.string().min(2),
  purpose: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  suggested_components: z.array(z.any()).default([]),
  suggested_packaging: z.array(z.any()).default([]),
  assembly_instructions: z.string().optional().nullable(),
  qc_checklist: z.array(z.string()).default([]),
  personalisation_fields: z.array(z.string()).default([]),
  estimated_cost_paise: z.coerce.number().int().min(0).default(0),
  active: z.union([z.boolean(), z.number()]).default(true),
});

function serializeTemplate(body: z.infer<typeof templateSchema>) {
  return {
    ...body,
    suggested_components: JSON.stringify(body.suggested_components),
    suggested_packaging: JSON.stringify(body.suggested_packaging),
    qc_checklist: JSON.stringify(body.qc_checklist),
    personalisation_fields: JSON.stringify(body.personalisation_fields),
    active: body.active ? 1 : 0,
  };
}

catalogRouter.post(
  '/templates',
  asyncHandler((req, res) => {
    const body = parse(templateSchema, req.body);
    const id = insert('order_templates', serializeTemplate(body));
    logAudit({ userId: req.user!.id, action: 'template.create', entityType: 'template', entityId: id, entityLabel: body.name });
    res.status(201).json({ template: get('SELECT * FROM order_templates WHERE id = ?', id) });
  }),
);

catalogRouter.patch(
  '/templates/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const existing = requireRow(get<any>('SELECT * FROM order_templates WHERE id = ?', id), 'Template');
    const body = parse(templateSchema.partial(), req.body);
    const patch: Record<string, any> = { ...body, updated_at: new Date().toISOString() };
    for (const key of ['suggested_components', 'suggested_packaging', 'qc_checklist', 'personalisation_fields'] as const) {
      if (body[key] !== undefined) patch[key] = JSON.stringify(body[key]);
    }
    if (body.active !== undefined) patch.active = body.active ? 1 : 0;
    update('order_templates', id, patch);
    logAudit({ userId: req.user!.id, action: 'template.update', entityType: 'template', entityId: id, entityLabel: existing.name });
    res.json({ template: get('SELECT * FROM order_templates WHERE id = ?', id) });
  }),
);
