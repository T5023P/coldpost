import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';

export const customersRouter = Router();

customersRouter.get(
  '/',
  asyncHandler((req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const clauses: string[] = [];
    const params: any[] = [];
    if (search) {
      clauses.push('(c.company_name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      clauses.push('c.status = ?');
      params.push(status);
    }
    const rows = all<any>(
      `SELECT c.*, COUNT(o.id) AS order_count,
              COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total_value_paise ELSE 0 END),0) AS total_spend_paise,
              MAX(o.order_date) AS last_order_date
       FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       GROUP BY c.id ORDER BY c.company_name`,
      ...params,
    );
    res.json({ customers: rows });
  }),
);

customersRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const customer = requireRow(get<any>('SELECT * FROM customers WHERE id = ?', id), 'Customer');
    const orders = all<any>(
      `SELECT o.*, (SELECT COUNT(*) FROM recipients r WHERE r.order_id = o.id) AS package_count
       FROM orders o WHERE o.customer_id = ? ORDER BY o.order_date DESC`,
      id,
    );
    const stats = get<any>(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_value_paise ELSE 0 END),0) AS total_spend_paise,
              COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN actual_cost_paise ELSE 0 END),0) AS total_cost_paise
       FROM orders WHERE customer_id = ?`,
      id,
    );
    const feedback = all<any>('SELECT * FROM feedback WHERE customer_id = ? ORDER BY id DESC', id);
    res.json({ customer, orders, stats, feedback });
  }),
);

const customerSchema = z.object({
  company_name: z.string().min(2, 'Company name is required'),
  contact_person: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  billing_address: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  customer_type: z.enum(['corporate', 'startup', 'agency', 'individual', 'other']).default('corporate'),
  notes: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive', 'prospect']).default('active'),
});

customersRouter.post(
  '/',
  asyncHandler((req, res) => {
    const body = parse(customerSchema, req.body);
    const id = insert('customers', body);
    logAudit({ userId: req.user!.id, action: 'customer.create', entityType: 'customer', entityId: id, entityLabel: body.company_name });
    res.status(201).json({ customer: get('SELECT * FROM customers WHERE id = ?', id) });
  }),
);

customersRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM customers WHERE id = ?', id), 'Customer');
    const body = parse(customerSchema.partial(), req.body);
    update('customers', id, { ...body, updated_at: new Date().toISOString() });
    logAudit({ userId: req.user!.id, action: 'customer.update', entityType: 'customer', entityId: id, meta: body });
    res.json({ customer: get('SELECT * FROM customers WHERE id = ?', id) });
  }),
);

customersRouter.get(
  '/:id/activity',
  asyncHandler((req, res) => {
    const id = idParam(req);
    res.json({
      activity: all<any>(
        `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE (a.entity_type = 'customer' AND a.entity_id = ?) OR (a.entity_type = 'order' AND a.entity_id IN (SELECT id FROM orders WHERE customer_id = ?))
         ORDER BY a.id DESC LIMIT 80`,
        id,
        id,
      ),
    });
  }),
);
