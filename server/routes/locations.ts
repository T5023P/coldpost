import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { STORE_CATEGORIES } from '../lib/statuses.js';

export const locationsRouter = Router();

/* ------------------------------- Cities -------------------------------- */

locationsRouter.get(
  '/cities',
  asyncHandler((req, res) => {
    const rows = all<any>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM locations l WHERE l.city_id = c.id) AS location_count,
              (SELECT COUNT(*) FROM suppliers s WHERE s.city_id = c.id) AS supplier_count,
              (SELECT COUNT(*) FROM orders o WHERE o.procurement_city_id = c.id) AS sourcing_orders,
              (SELECT COUNT(*) FROM orders o WHERE o.fulfilment_location_id IN (SELECT id FROM locations WHERE city_id = c.id)) AS fulfilment_orders
       FROM cities c ORDER BY c.name`,
    );
    res.json({ cities: rows });
  }),
);

const citySchema = z.object({
  name: z.string().min(2, 'City name is required'),
  state: z.string().optional().nullable(),
  code: z.string().optional().nullable(),
  active: z.union([z.boolean(), z.number()]).default(true),
  notes: z.string().optional().nullable(),
});

locationsRouter.post(
  '/cities',
  asyncHandler((req, res) => {
    const body = parse(citySchema, req.body);
    const id = insert('cities', { ...body, active: body.active ? 1 : 0 });
    logAudit({ userId: req.user!.id, action: 'city.create', entityType: 'city', entityId: id, entityLabel: body.name });
    res.status(201).json({ city: get('SELECT * FROM cities WHERE id = ?', id) });
  }),
);

locationsRouter.patch(
  '/cities/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM cities WHERE id = ?', id), 'City');
    const body = parse(citySchema.partial(), req.body);
    update('cities', id, {
      ...body,
      ...(body.active === undefined ? {} : { active: body.active ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    });
    logAudit({ userId: req.user!.id, action: 'city.update', entityType: 'city', entityId: id, meta: body });
    res.json({ city: get('SELECT * FROM cities WHERE id = ?', id) });
  }),
);

/* ------------------------------- Stores -------------------------------- */

const locationSelect = `SELECT l.*, c.name AS city_name, c.state AS city_state, s.name AS supplier_name,
  (SELECT COUNT(*) FROM product_offers po WHERE po.location_id = l.id AND po.active = 1) AS offer_count,
  (SELECT COALESCE(SUM(i.qty_available),0) FROM inventory i WHERE i.location_id = l.id) AS stock_units
  FROM locations l
  JOIN cities c ON c.id = l.city_id
  LEFT JOIN suppliers s ON s.id = l.supplier_id`;

locationsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const cityId = req.query.city_id ? Number(req.query.city_id) : null;
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const activeOnly = req.query.active === 'true';
    const clauses: string[] = [];
    const params: any[] = [];
    if (cityId) {
      clauses.push('l.city_id = ?');
      params.push(cityId);
    }
    if (category) {
      clauses.push('l.category = ?');
      params.push(category);
    }
    if (activeOnly) clauses.push('l.active = 1');
    const rows = all<any>(`${locationSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY c.name, l.name`, ...params);
    res.json({ locations: rows });
  }),
);

locationsRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const location = requireRow(get<any>(`${locationSelect} WHERE l.id = ?`, id), 'Store');
    const inventory = all<any>(
      `SELECT i.*, p.name AS product_name, p.sku, p.min_stock, p.uom
       FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.location_id = ? ORDER BY p.name`,
      id,
    );
    const offers = all<any>(
      `SELECT o.*, p.name AS product_name, p.sku, s.name AS supplier_name
       FROM product_offers o JOIN products p ON p.id = o.product_id
       LEFT JOIN suppliers s ON s.id = o.supplier_id
       WHERE o.location_id = ? ORDER BY p.name`,
      id,
    );
    const recentMovements = all<any>(
      `SELECT m.*, p.name AS product_name, u.name AS user_name FROM inventory_movements m
       JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
       WHERE m.location_id = ? ORDER BY m.id DESC LIMIT 40`,
      id,
    );
    const photos = all<any>("SELECT * FROM attachments WHERE entity_type = 'location' AND entity_id = ? ORDER BY id DESC", id);
    res.json({ location, inventory, offers, recentMovements, photos });
  }),
);

const locationSchema = z.object({
  city_id: z.coerce.number().int().positive(),
  name: z.string().min(2, 'Store name is required'),
  category: z.enum(STORE_CATEGORIES).default('retail_shop'),
  address: z.string().optional().nullable(),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  opening_hours: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  rating: z.coerce.number().min(0).max(5).optional().nullable(),
  supplier_id: z.coerce.number().int().positive().nullable().optional(),
  is_fulfilment_hub: z.union([z.boolean(), z.number()]).default(false),
  active: z.union([z.boolean(), z.number()]).default(true),
});

locationsRouter.post(
  '/',
  asyncHandler((req, res) => {
    const body = parse(locationSchema, req.body);
    requireRow(get('SELECT id FROM cities WHERE id = ?', body.city_id), 'City');
    const id = insert('locations', {
      ...body,
      is_fulfilment_hub: body.is_fulfilment_hub ? 1 : 0,
      active: body.active ? 1 : 0,
    });
    logAudit({ userId: req.user!.id, action: 'location.create', entityType: 'location', entityId: id, entityLabel: body.name, meta: { city_id: body.city_id } });
    res.status(201).json({ location: get(`${locationSelect} WHERE l.id = ?`, id) });
  }),
);

locationsRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM locations WHERE id = ?', id), 'Store');
    const body = parse(locationSchema.partial(), req.body);
    update('locations', id, {
      ...body,
      ...(body.is_fulfilment_hub === undefined ? {} : { is_fulfilment_hub: body.is_fulfilment_hub ? 1 : 0 }),
      ...(body.active === undefined ? {} : { active: body.active ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    });
    logAudit({ userId: req.user!.id, action: 'location.update', entityType: 'location', entityId: id, meta: body });
    res.json({ location: get(`${locationSelect} WHERE l.id = ?`, id) });
  }),
);

/** Everything operational inside one city: stores, suppliers, campaigns. */
locationsRouter.get(
  '/cities/:id/overview',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const city = requireRow(get<any>('SELECT * FROM cities WHERE id = ?', id), 'City');
    const locations = all<any>(`${locationSelect} WHERE l.city_id = ? ORDER BY l.name`, id);
    const suppliers = all<any>('SELECT * FROM suppliers WHERE city_id = ? ORDER BY name', id);
    const orders = all<any>(
      `SELECT o.id, o.ref, o.campaign_name, o.status, o.total_value_paise, o.procurement_city_id, o.fulfilment_location_id
       FROM orders o
       WHERE o.procurement_city_id = ? OR o.fulfilment_location_id IN (SELECT id FROM locations WHERE city_id = ?)
       ORDER BY o.id DESC LIMIT 20`,
      id,
      id,
    );
    const stock = all<any>(
      `SELECT p.id, p.name, p.sku, COALESCE(SUM(i.qty_available),0) AS available, COALESCE(SUM(i.qty_reserved),0) AS reserved
       FROM products p JOIN inventory i ON i.product_id = p.id
       JOIN locations l ON l.id = i.location_id WHERE l.city_id = ?
       GROUP BY p.id ORDER BY available DESC LIMIT 30`,
      id,
    );
    res.json({ city, locations, suppliers, orders, stock });
  }),
);
