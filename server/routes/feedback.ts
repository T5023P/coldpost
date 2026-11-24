import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { ApiError } from '../lib/http.js';
import { setPackageStatus, tryOrderStatus } from '../lib/orders.js';

export const feedbackRouter = Router();

feedbackRouter.get(
  '/',
  asyncHandler((req, res) => {
    const orderId = req.query.order_id ? Number(req.query.order_id) : null;
    const rows = all<any>(
      `SELECT f.*, o.ref AS order_ref, c.company_name, r.name AS recipient_name
       FROM feedback f LEFT JOIN orders o ON o.id = f.order_id
       LEFT JOIN customers c ON c.id = f.customer_id LEFT JOIN recipients r ON r.id = f.recipient_id
       ${orderId ? 'WHERE f.order_id = ?' : ''} ORDER BY f.id DESC LIMIT 300`,
      ...(orderId ? [orderId] : []),
    );
    const issues = all<any>(
      `SELECT i.*, o.ref AS order_ref, r.name AS recipient_name FROM issues i
       LEFT JOIN orders o ON o.id = i.order_id LEFT JOIN recipients r ON r.id = i.recipient_id
       ${orderId ? 'WHERE i.order_id = ?' : ''} ORDER BY i.id DESC LIMIT 200`,
      ...(orderId ? [orderId] : []),
    );
    const summary = get<any>(
      `SELECT COUNT(*) AS responses, COALESCE(AVG(rating),0) AS avg_rating,
              COALESCE(SUM(CASE WHEN repeat_interest = 1 THEN 1 ELSE 0 END),0) AS repeat_interest_count,
              COALESCE(SUM(CASE WHEN delivery_confirmed = 1 THEN 1 ELSE 0 END),0) AS delivery_confirmed_count
       FROM feedback`,
    );
    res.json({ feedback: rows, issues, summary });
  }),
);

feedbackRouter.post(
  '/',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        order_id: z.coerce.number().int().positive(),
        recipient_id: z.coerce.number().int().positive().nullable().optional(),
        delivery_confirmed: z.union([z.boolean(), z.number()]).default(false),
        rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
        comments: z.string().optional().nullable(),
        missing_items: z.string().optional().nullable(),
        damaged_items: z.string().optional().nullable(),
        packaging_feedback: z.string().optional().nullable(),
        overall_experience: z.string().optional().nullable(),
        repeat_interest: z.union([z.boolean(), z.number()]).default(false),
      }),
      req.body,
    );
    const order = requireRow(get<any>('SELECT * FROM orders WHERE id = ?', body.order_id), 'Order');
    const id = insert('feedback', {
      ...body,
      customer_id: order.customer_id,
      delivery_confirmed: body.delivery_confirmed ? 1 : 0,
      repeat_interest: body.repeat_interest ? 1 : 0,
      created_by: req.user!.id,
    });
    if (body.missing_items || body.damaged_items) {
      insert('issues', {
        order_id: body.order_id,
        recipient_id: body.recipient_id ?? null,
        type: body.damaged_items && !body.missing_items ? 'damaged' : 'missing',
        description: [body.missing_items, body.damaged_items].filter(Boolean).join(' | '),
        status: 'open',
        created_by: req.user!.id,
      });
    }
    logAudit({ userId: req.user!.id, action: 'feedback.create', entityType: 'order', entityId: body.order_id, entityLabel: order.ref, meta: { rating: body.rating, delivery_confirmed: !!body.delivery_confirmed } });
    res.status(201).json({ feedback: get('SELECT * FROM feedback WHERE id = ?', id), issues: all('SELECT * FROM issues WHERE order_id = ? ORDER BY id DESC', body.order_id) });
  }),
);

feedbackRouter.get(
  '/issues',
  asyncHandler((req, res) => {
    res.json({
      issues: all<any>(
        `SELECT i.*, o.ref AS order_ref, c.company_name FROM issues i
         JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
         ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END, i.id DESC LIMIT 200`,
      ),
    });
  }),
);

feedbackRouter.patch(
  '/issues/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const issue = requireRow(get<any>('SELECT * FROM issues WHERE id = ?', id), 'Issue');
    const body = parse(
      z.object({
        status: z.enum(['open', 'investigating', 'resolved', 'rejected']).optional(),
        resolution: z.string().optional().nullable(),
        type: z.enum(['missing', 'damaged', 'delay', 'quality', 'other']).optional(),
        description: z.string().optional(),
      }),
      req.body,
    );
    update('issues', id, {
      ...body,
      resolved_at: body.status === 'resolved' ? new Date().toISOString() : issue.resolved_at,
      updated_at: new Date().toISOString(),
    });
    logAudit({ userId: req.user!.id, action: 'issue.update', entityType: 'issue', entityId: id, meta: body });
    res.json({ issue: get('SELECT * FROM issues WHERE id = ?', id) });
  }),
);

feedbackRouter.post(
  '/delivery-confirmation',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({ shipment_id: z.coerce.number().int().positive(), note: z.string().optional().nullable() }),
      req.body,
    );
    const shipment = requireRow(get<any>('SELECT * FROM shipments WHERE id = ?', body.shipment_id), 'Shipment');
    if (shipment.is_test) throw new ApiError(409, 'Test-mode shipments cannot be marked delivered');
    run("UPDATE shipments SET status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", body.shipment_id);
    insert('shipment_events', {
      shipment_id: body.shipment_id,
      status: 'delivered',
      description: body.note ?? 'Delivery confirmed by operator',
      source: 'manual',
    });
    setPackageStatus(shipment.recipient_id, 'delivered', req.user!.id, 'Delivery confirmed');
    tryOrderStatus(shipment.order_id, 'delivered', { userId: req.user!.id, note: 'Delivery confirmed' });
    logAudit({ userId: req.user!.id, action: 'shipment.delivered', entityType: 'shipment', entityId: body.shipment_id, entityLabel: shipment.awb });
    res.json({ shipment: get('SELECT * FROM shipments WHERE id = ?', body.shipment_id) });
  }),
);
