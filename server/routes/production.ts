import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, jsonParse, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { latestQc, requireOrder, setOrderStatus, setPackageStatus, tryOrderStatus } from '../lib/orders.js';
import { ApiError } from '../lib/http.js';
import { generateWorkOrders } from '../lib/orders.js';

export const productionRouter = Router();

const workOrderSelect = `SELECT w.*, o.ref AS order_ref, o.campaign_name, o.campaign_type, o.status AS order_status,
  r.name AS recipient_name, r.city AS recipient_city, r.personalisation, r.status AS recipient_status,
  (SELECT COUNT(*) FROM attachments a WHERE a.entity_type = 'work_order' AND a.entity_id = w.id) AS photo_count
  FROM work_orders w
  JOIN orders o ON o.id = w.order_id
  LEFT JOIN recipients r ON r.id = w.recipient_id`;

productionRouter.get(
  '/production/board',
  asyncHandler((req, res) => {
    const workOrders = all<any>(`${workOrderSelect} WHERE w.status <> 'cancelled' ORDER BY w.id DESC`);
    const byStatus = (status: string) => workOrders.filter((w) => w.status === status);
    const qcQueue = all<any>(
      `SELECT r.*, o.ref AS order_ref, o.campaign_name,
              (SELECT COUNT(*) FROM attachments a WHERE a.entity_type = 'recipient' AND a.entity_id = r.id) AS photo_count
       FROM recipients r JOIN orders o ON o.id = r.order_id
       WHERE r.status IN ('qc_pending','qc_failed','rework','ready_for_assembly','assembling')
       ORDER BY CASE r.status WHEN 'qc_pending' THEN 0 WHEN 'qc_failed' THEN 1 WHEN 'rework' THEN 2 ELSE 3 END, r.id DESC
       LIMIT 60`,
    );
    const readyToPack = all<any>(
      `SELECT r.*, o.ref AS order_ref FROM recipients r JOIN orders o ON o.id = r.order_id
       WHERE r.status IN ('qc_passed','packed') ORDER BY r.id DESC LIMIT 40`,
    );
    res.json({
      columns: {
        queued: byStatus('queued'),
        assembling: byStatus('assembling'),
        completed: byStatus('completed'),
      },
      qcQueue,
      readyToPack,
      totals: {
        queued: byStatus('queued').length,
        assembling: byStatus('assembling').length,
        completed: byStatus('completed').length,
        qcPending: qcQueue.filter((r) => r.status === 'qc_pending').length,
        rework: qcQueue.filter((r) => ['qc_failed', 'rework'].includes(r.status)).length,
      },
    });
  }),
);

productionRouter.get(
  '/work-orders/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const workOrder = requireRow(get<any>(`${workOrderSelect} WHERE w.id = ?`, id), 'Work order');
    const photos = all<any>("SELECT * FROM attachments WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY id DESC", id);
    const recipientPhotos = all<any>(
      "SELECT * FROM attachments WHERE entity_type = 'recipient' AND entity_id = ? ORDER BY id DESC",
      workOrder.recipient_id,
    );
    const qc = workOrder.recipient_id ? all<any>(
      'SELECT q.*, u.name AS inspector_name FROM qc_inspections q LEFT JOIN users u ON u.id = q.inspector_id WHERE q.recipient_id = ? ORDER BY q.id DESC',
      workOrder.recipient_id,
    ) : [];
    const bom = all<any>(
      `SELECT b.*, p.name AS product_name FROM bom_items b LEFT JOIN products p ON p.id = b.product_id
       WHERE b.order_id = ? AND b.is_snapshot = 0 ORDER BY b.id`,
      workOrder.order_id,
    );
    res.json({ workOrder, photos, recipientPhotos, qc, bom });
  }),
);

productionRouter.patch(
  '/work-orders/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const workOrder = requireRow(get<any>('SELECT * FROM work_orders WHERE id = ?', id), 'Work order');
    const body = parse(
      z.object({
        status: z.enum(['queued', 'assembling', 'completed', 'cancelled']).optional(),
        assigned_to: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        instructions: z.string().optional().nullable(),
        start_date: z.string().optional().nullable(),
        completion_date: z.string().optional().nullable(),
        checklist: z.array(z.object({ label: z.string(), done: z.boolean() })).optional(),
      }),
      req.body,
    );
    const patch: Record<string, any> = { ...body, updated_at: new Date().toISOString() };
    if (body.checklist) patch.checklist = JSON.stringify(body.checklist);
    update('work_orders', id, patch);
    if (body.status === 'assembling' && workOrder.recipient_id) {
      setPackageStatus(workOrder.recipient_id, 'assembling', req.user!.id, 'Assembly started');
      setOrderStatus(workOrder.order_id, 'assembling', { userId: req.user!.id, system: true, note: `Work order ${workOrder.ref} started` });
    }
    logAudit({ userId: req.user!.id, action: 'work-order.update', entityType: 'work_order', entityId: id, entityLabel: workOrder.ref, meta: { status: body.status ?? null } });
    const order = requireOrder(workOrder.order_id);
    res.json({ workOrder: get(`${workOrderSelect} WHERE w.id = ?`, id), orderStatus: order.status });
  }),
);

productionRouter.post(
  '/work-orders/:id/complete',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const workOrder = requireRow(get<any>('SELECT * FROM work_orders WHERE id = ?', id), 'Work order');
    const body = parse(
      z.object({
        notes: z.string().optional().nullable(),
        checklist: z.array(z.object({ label: z.string(), done: z.boolean() })).optional(),
      }),
      req.body ?? {},
    );
    const checklist = body.checklist ?? jsonParse<any[]>(workOrder.checklist, []);
    const incomplete = checklist.filter((item) => !item.done);
    if (incomplete.length) {
      throw new ApiError(409, `Complete the assembly checklist first — ${incomplete.length} item(s) unchecked`);
    }
    const photos = get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'recipient' AND entity_id = ? AND kind IN ('assembly','final')",
      workOrder.recipient_id,
    )!.c;
    if (photos === 0) {
      throw new ApiError(409, 'Upload at least one assembly photograph before completing this package');
    }
    update('work_orders', id, {
      status: 'completed',
      completion_date: new Date().toISOString(),
      notes: body.notes ?? workOrder.notes,
      checklist: JSON.stringify(checklist),
      updated_at: new Date().toISOString(),
    });
    if (workOrder.recipient_id) {
      setPackageStatus(workOrder.recipient_id, 'qc_pending', req.user!.id, 'Assembly complete, awaiting QC');
      tryOrderStatus(workOrder.order_id, 'qc_pending', { userId: req.user!.id, note: 'Assembly complete' });
    }
    logAudit({ userId: req.user!.id, action: 'work-order.complete', entityType: 'work_order', entityId: id, entityLabel: workOrder.ref });
    res.json({ workOrder: get(`${workOrderSelect} WHERE w.id = ?`, id) });
  }),
);

productionRouter.post(
  '/orders/:id/work-orders',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const created = generateWorkOrders(id, req.user!.id);
    res.json({ created });
  }),
);

/* --------------------------------- QC ---------------------------------- */

productionRouter.get(
  '/qc/templates',
  asyncHandler((req, res) => {
    res.json({ checklist: getSetting('qcChecklist') });
  }),
);

productionRouter.get(
  '/qc/inspections',
  asyncHandler((req, res) => {
    const rows = all<any>(
      `SELECT q.*, r.name AS recipient_name, o.ref AS order_ref, u.name AS inspector_name
       FROM qc_inspections q JOIN recipients r ON r.id = q.recipient_id JOIN orders o ON o.id = q.order_id
       LEFT JOIN users u ON u.id = q.inspector_id ORDER BY q.id DESC LIMIT 200`,
    );
    const failures = rows.filter((r) => r.status !== 'passed').length;
    res.json({ inspections: rows, failureRate: rows.length ? Math.round((failures / rows.length) * 1000) / 10 : 0 });
  }),
);

productionRouter.post(
  '/recipients/:id/qc',
  asyncHandler((req, res) => {
    const rid = idParam(req);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', rid), 'Recipient package');
    const body = parse(
      z.object({
        status: z.enum(['passed', 'failed', 'rework']),
        checklist: z.array(z.object({ label: z.string(), done: z.boolean(), notes: z.string().optional().nullable() })).min(1),
        notes: z.string().optional().nullable(),
      }),
      req.body,
    );
    const photos = get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'recipient' AND entity_id = ? AND kind IN ('qc','final')",
      rid,
    )!.c;
    if (body.status === 'passed') {
      if (photos === 0) {
        throw new ApiError(409, 'Upload the final package photograph before passing QC');
      }
      const unchecked = body.checklist.filter((item) => !item.done);
      if (unchecked.length) {
        throw new ApiError(409, `All QC checks must be ticked to pass — ${unchecked.length} remaining: ${unchecked.map((c) => c.label).join(', ')}`);
      }
    }
    const workOrder = get<any>(
      "SELECT * FROM work_orders WHERE recipient_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1",
      rid,
    );
    const inspectionId = insert('qc_inspections', {
      recipient_id: rid,
      order_id: recipient.order_id,
      work_order_id: workOrder?.id ?? null,
      status: body.status === 'rework' ? 'failed' : body.status,
      checklist: JSON.stringify(body.checklist),
      notes: body.notes ?? null,
      inspector_id: req.user!.id,
    });

    if (body.status === 'passed') {
      setPackageStatus(rid, 'qc_passed', req.user!.id, 'QC passed');
      const pending = get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM recipients WHERE order_id = ? AND status NOT IN ('qc_passed','packed','ready_to_dispatch','shipment_booked','dispatched','in_transit','delivered')",
        recipient.order_id,
      )!.c;
      if (pending === 0) tryOrderStatus(recipient.order_id, 'qc_passed', { userId: req.user!.id, note: 'All packages passed QC' });
    } else {
      setPackageStatus(rid, 'rework', req.user!.id, body.notes ?? 'QC failed — rework required');
      if (workOrder && workOrder.status === 'completed') {
        update('work_orders', workOrder.id, { status: 'assembling', completion_date: null, updated_at: new Date().toISOString() });
      }
      tryOrderStatus(recipient.order_id, 'qc_failed', { userId: req.user!.id, note: body.notes ?? 'QC failed' });
    }

    logAudit({
      userId: req.user!.id,
      action: `qc.${body.status}`,
      entityType: 'recipient',
      entityId: rid,
      entityLabel: recipient.name,
      meta: { inspectionId, notes: body.notes ?? null, orderId: recipient.order_id },
    });
    res.status(201).json({ inspectionId, qc: latestQc(rid) });
  }),
);

productionRouter.get(
  '/recipients/:id/qc',
  asyncHandler((req, res) => {
    const rid = idParam(req);
    const inspections = all<any>(
      `SELECT q.*, u.name AS inspector_name FROM qc_inspections q LEFT JOIN users u ON u.id = q.inspector_id
       WHERE q.recipient_id = ? ORDER BY q.id DESC`,
      rid,
    );
    res.json({ inspections, latest: inspections[0] ?? null });
  }),
);

/** Pack / ready-to-dispatch moves from the QC area. */
productionRouter.post(
  '/recipients/:id/pack',
  asyncHandler((req, res) => {
    const rid = idParam(req);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', rid), 'Recipient package');
    const qc = latestQc(rid);
    if (!qc || qc.status !== 'passed') throw new ApiError(409, 'QC must pass before packing');
    const body = parse(z.object({ stage: z.enum(['packed', 'ready_for_assembly', 'ready_to_dispatch']).default('packed') }), req.body ?? {});
    setPackageStatus(rid, body.stage, req.user!.id, 'Packing stage updated');
    if (body.stage === 'ready_to_dispatch') {
      tryOrderStatus(recipient.order_id, 'ready_to_dispatch', { userId: req.user!.id, note: 'Package ready to dispatch' });
    } else {
      tryOrderStatus(recipient.order_id, 'packed', { userId: req.user!.id, note: 'Package packed' });
    }
    res.json({ recipient: get('SELECT * FROM recipients WHERE id = ?', rid) });
  }),
);

productionRouter.patch(
  '/qc/checklist',
  asyncHandler((req, res) => {
    // Admin-editable default QC checklist lives in settings; this mirrors it for convenience.
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can change the default QC checklist');
    const body = parse(z.object({ checklist: z.array(z.string().min(2)).min(1) }), req.body);
    setSetting('qcChecklist', body.checklist, req.user!.id);
    res.json({ checklist: getSetting('qcChecklist') });
  }),
);
