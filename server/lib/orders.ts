import { all, get, insert, jsonParse, run, tx } from '../db.js';
import { ApiError } from './http.js';
import { canTransitionOrder, ORDER_STATUS_LABEL, PACKAGE_STATUS_LABEL } from './statuses.js';
import { orderCostBreakdown, syncOrderCosts } from './costing.js';
import { logAudit } from './audit.js';
import { getSetting } from './settings.js';

export function getOrderRow(id: number) {
  return get<any>(
    `SELECT o.*, c.company_name, c.contact_person AS customer_contact, c.email AS customer_email, c.phone AS customer_phone,
            fl.name AS fulfilment_location_name, fl.city_id AS fulfilment_city_id, pc.name AS procurement_city_name
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN locations fl ON fl.id = o.fulfilment_location_id
     LEFT JOIN cities pc ON pc.id = o.procurement_city_id
     WHERE o.id = ?`,
    id,
  );
}

export function requireOrder(id: number) {
  const row = getOrderRow(id);
  if (!row) throw new ApiError(404, 'Order not found');
  return row;
}

export interface StatusOptions {
  userId?: number | null;
  note?: string | null;
  system?: boolean;
  delayReason?: string | null;
  skipHistory?: boolean;
}

export function setOrderStatus(orderId: number, to: string, opts: StatusOptions = {}) {
  const order = get<{ id: number; ref: string; status: string; status_before_delay: string | null }>(
    'SELECT id, ref, status, status_before_delay FROM orders WHERE id = ?',
    orderId,
  );
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.status === to) return order.status;

  if (!canTransitionOrder(order.status, to)) {
    throw new ApiError(409, `Cannot move order from ${ORDER_STATUS_LABEL[order.status] ?? order.status} to ${ORDER_STATUS_LABEL[to] ?? to}`);
  }

  const patch: Record<string, any> = { status: to, updated_at: new Date().toISOString() };
  if (to === 'confirmed' && !get<{ confirmed_at: string | null }>('SELECT confirmed_at FROM orders WHERE id = ?', orderId)?.confirmed_at) {
    patch.confirmed_at = new Date().toISOString();
  }
  if (to === 'closed') patch.closed_at = new Date().toISOString();
  if (to === 'delayed') {
    patch.status_before_delay = order.status;
    patch.delay_reason = opts.delayReason ?? opts.note ?? null;
  }
  if (order.status === 'delayed' && to !== 'delayed') {
    patch.delay_reason = null;
  }
  const keys = Object.keys(patch);
  run(`UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), orderId);

  if (!opts.skipHistory) {
    insert('order_status_history', {
      order_id: orderId,
      from_status: order.status,
      to_status: to,
      note: opts.note ?? (opts.system ? 'Automatic status update' : null),
      user_id: opts.userId ?? null,
    });
  }
  logAudit({
    userId: opts.userId,
    action: opts.system ? 'order.status.auto' : 'order.status',
    entityType: 'order',
    entityId: orderId,
    entityLabel: order.ref,
    meta: { from: order.status, to, note: opts.note ?? null },
  });
  return to;
}

export function tryOrderStatus(orderId: number, to: string, opts: StatusOptions = {}) {
  try {
    return setOrderStatus(orderId, to, { ...opts, system: true });
  } catch {
    return null;
  }
}

export function refreshOrderCounters(orderId: number) {
  const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM recipients WHERE order_id = ?', orderId)!.c;
  run('UPDATE orders SET recipient_count = ?, updated_at = ? WHERE id = ?', count, new Date().toISOString(), orderId);
  run(
    `UPDATE bom_items SET total_qty = qty_per_package * ? WHERE order_id = ? AND is_snapshot = 0`,
    Math.max(count, 1),
    orderId,
  );
  syncOrderCosts(orderId);
  return count;
}

export function setPackageStatus(recipientId: number, status: string, userId?: number | null, note?: string) {
  const recipient = get<{ id: number; order_id: number; name: string; status: string }>(
    'SELECT id, order_id, name, status FROM recipients WHERE id = ?',
    recipientId,
  );
  if (!recipient) throw new ApiError(404, 'Recipient package not found');
  const patch: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (status === 'delivered') patch.delivered_at = new Date().toISOString();
  const keys = Object.keys(patch);
  run(`UPDATE recipients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), recipientId);
  logAudit({
    userId,
    action: 'package.status',
    entityType: 'recipient',
    entityId: recipientId,
    entityLabel: recipient.name,
    meta: { from: recipient.status, to: status, orderId: recipient.order_id, note: note ?? null },
  });
  return status;
}

export function latestQc(recipientId: number) {
  return get<any>(
    `SELECT q.*, u.name AS inspector_name FROM qc_inspections q
     LEFT JOIN users u ON u.id = q.inspector_id
     WHERE q.recipient_id = ? ORDER BY q.id DESC LIMIT 1`,
    recipientId,
  );
}

/**
 * Packages may only be booked/dispatched after a passed QC inspection. A failed
 * or missing inspection is a hard block, not a warning.
 */
export function assertDispatchable(recipientId: number) {
  const recipient = get<any>(
    `SELECT r.*, o.ref AS order_ref FROM recipients r JOIN orders o ON o.id = r.order_id WHERE r.id = ?`,
    recipientId,
  );
  if (!recipient) throw new ApiError(404, 'Recipient package not found');
  const qc = latestQc(recipientId);
  if (!qc) {
    throw new ApiError(409, `Package for ${recipient.name} has no QC inspection. QC must pass before dispatch.`);
  }
  if (qc.status !== 'passed') {
    throw new ApiError(409, `Package for ${recipient.name} last QC result was "${qc.status}". A package can only be dispatched after QC passes.`);
  }
  if (['qc_failed', 'rework', 'assembling', 'qc_pending', 'pending', 'ready_for_assembly'].includes(recipient.status)) {
    throw new ApiError(409, `Package for ${recipient.name} is at stage "${PACKAGE_STATUS_LABEL[recipient.status] ?? recipient.status}" and is not ready for dispatch.`);
  }
  return { recipient, qc };
}

export function generateWorkOrders(orderId: number, userId?: number | null) {
  const order = requireOrder(orderId);
  const template = order.template_id
    ? get<any>('SELECT * FROM order_templates WHERE id = ?', order.template_id)
    : get<any>('SELECT * FROM order_templates WHERE campaign_type = ? ORDER BY id LIMIT 1', order.campaign_type);
  const recipients = all<any>('SELECT * FROM recipients WHERE order_id = ? ORDER BY id', orderId);
  if (!recipients.length) throw new ApiError(400, 'Add recipient packages before creating work orders');

  const instructionsParts: string[] = [];
  if (template?.assembly_instructions) instructionsParts.push(template.assembly_instructions);
  if (order.packing_requirements) instructionsParts.push(`Packaging requirements: ${order.packing_requirements}`);
  if (order.special_instructions) instructionsParts.push(`Special instructions: ${order.special_instructions}`);

  const checklist = jsonParse<string[]>(template?.qc_checklist, []).map((label) => ({ label, done: false }));
  const settingsChecklist = getSetting('qcChecklist');

  let created = 0;
  return tx(() => {
    for (const recipient of recipients) {
      const existing = get<{ id: number; status: string }>(
        "SELECT id, status FROM work_orders WHERE recipient_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1",
        recipient.id,
      );
      if (existing) continue;
      const lines = all<any>(
        `SELECT b.name_snapshot, b.sku_snapshot, b.qty_per_package, b.customisation
         FROM bom_items b WHERE b.order_id = ? AND b.is_snapshot = 0`,
        orderId,
      );
      const required = lines.map((l) => `${l.qty_per_package} × ${l.name_snapshot}${l.customisation ? ` (${l.customisation})` : ''}`);
      const recipientInstructions = [
        ...instructionsParts,
        recipient.personalisation ? `Personalisation: ${recipient.personalisation}` : '',
        recipient.packaging_notes ? `Packaging notes: ${recipient.packaging_notes}` : '',
        recipient.special_instructions ? `Recipient instructions: ${recipient.special_instructions}` : '',
        required.length ? `Required items per package:\n${required.map((r) => `• ${r}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      insert('work_orders', {
        ref: `${order.ref}-P${String(recipient.id).padStart(3, '0')}`,
        order_id: orderId,
        recipient_id: recipient.id,
        package_type: order.campaign_name,
        status: 'queued',
        instructions: recipientInstructions,
        checklist: JSON.stringify(
          (checklist.length ? checklist : settingsChecklist.map((label) => ({ label, done: false }))).map((item: any) => ({
            ...item,
            done: false,
          })),
        ),
      });
      created += 1;
      if (['pending', 'procurement', 'ready_for_assembly'].includes(recipient.status)) {
        setPackageStatus(recipient.id, 'ready_for_assembly', userId);
      }
    }
    logAudit({
      userId,
      action: 'production.work-orders.generate',
      entityType: 'order',
      entityId: orderId,
      entityLabel: order.ref,
      meta: { created },
    });
    if (['confirmed', 'items_received', 'procurement'].includes(order.status)) {
      setOrderStatus(orderId, 'assembly_queued', { userId, system: true, note: `${created} work orders created` });
    }
    return created;
  });
}

export function orderBundle(orderId: number) {
  const order = requireOrder(orderId);
  const recipients = all<any>(
    `SELECT r.*, l.name AS fulfilment_location_name, c.name AS fulfilment_city,
            s.id AS shipment_id, s.status AS shipment_status, s.awb, s.courier_name, s.mode AS shipment_mode,
            s.is_test AS shipment_is_test, s.tracking_url
     FROM recipients r
     LEFT JOIN locations l ON l.id = r.fulfilment_location_id
     LEFT JOIN cities c ON c.id = l.city_id
     LEFT JOIN shipments s ON s.recipient_id = r.id AND s.status <> 'cancelled'
     WHERE r.order_id = ? ORDER BY r.id`,
    orderId,
  );
  const withQc = recipients.map((r) => {
    const qc = latestQc(r.id);
    return { ...r, qc_status: qc?.status ?? null, qc_at: qc?.inspected_at ?? null };
  });

  const bom = all<any>(
    `SELECT b.*, s.name AS supplier_name, l.name AS location_name
     FROM bom_items b
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     LEFT JOIN locations l ON l.id = b.location_id
     WHERE b.order_id = ? ORDER BY b.id`,
    orderId,
  );
  const costItems = all<any>('SELECT * FROM order_cost_items WHERE order_id = ? ORDER BY category, id', orderId);
  const workOrders = all<any>(
    `SELECT w.*, r.name AS recipient_name, r.city AS recipient_city
     FROM work_orders w LEFT JOIN recipients r ON r.id = w.recipient_id
     WHERE w.order_id = ? ORDER BY w.id`,
    orderId,
  );
  const purchaseOrders = all<any>(
    `SELECT p.*, s.name AS supplier_name, l.name AS location_name, c.name AS city_name
     FROM purchase_orders p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN locations l ON l.id = p.location_id
     LEFT JOIN cities c ON c.id = l.city_id
     WHERE p.order_id = ? ORDER BY p.id`,
    orderId,
  );
  const purchaseItems = all<any>(
    `SELECT i.* FROM purchase_order_items i
     JOIN purchase_orders p ON p.id = i.purchase_order_id WHERE p.order_id = ? ORDER BY i.id`,
    orderId,
  );
  const shipments = all<any>(
    `SELECT s.*, r.name AS recipient_name, r.city AS recipient_city, p.name AS provider_name
     FROM shipments s JOIN recipients r ON r.id = s.recipient_id
     LEFT JOIN api_providers p ON p.id = s.provider_id
     WHERE s.order_id = ? ORDER BY s.id DESC`,
    orderId,
  );
  const shipmentEvents = all<any>(
    `SELECT e.* FROM shipment_events e JOIN shipments s ON s.id = e.shipment_id
     WHERE s.order_id = ? ORDER BY e.id DESC LIMIT 100`,
    orderId,
  );
  const messages = all<any>(
    `SELECT m.*, r.name AS recipient_name FROM messages m LEFT JOIN recipients r ON r.id = m.recipient_id
     WHERE m.order_id = ? ORDER BY m.id DESC`,
    orderId,
  );
  const qcInspections = all<any>(
    `SELECT q.*, r.name AS recipient_name, u.name AS inspector_name
     FROM qc_inspections q JOIN recipients r ON r.id = q.recipient_id
     LEFT JOIN users u ON u.id = q.inspector_id
     WHERE q.order_id = ? ORDER BY q.id DESC`,
    orderId,
  );
  const feedback = all<any>('SELECT * FROM feedback WHERE order_id = ? ORDER BY id DESC', orderId);
  const issues = all<any>('SELECT * FROM issues WHERE order_id = ? ORDER BY id DESC', orderId);
  const history = all<any>(
    `SELECT h.*, u.name AS user_name FROM order_status_history h
     LEFT JOIN users u ON u.id = h.user_id WHERE h.order_id = ? ORDER BY h.id DESC`,
    orderId,
  );
  const activity = all<any>(
    `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE (a.entity_type = 'order' AND a.entity_id = ?)
        OR (a.entity_type = 'recipient' AND a.entity_id IN (SELECT id FROM recipients WHERE order_id = ?))
        OR (a.entity_type = 'purchase_order' AND a.entity_id IN (SELECT id FROM purchase_orders WHERE order_id = ?))
        OR (a.entity_type = 'shipment' AND a.entity_id IN (SELECT id FROM shipments WHERE order_id = ?))
        OR (a.entity_type = 'message' AND a.entity_id IN (SELECT id FROM messages WHERE order_id = ?))
     ORDER BY a.id DESC LIMIT 120`,
    orderId,
    orderId,
    orderId,
    orderId,
    orderId,
  );
  const attachments = all<any>(
    `SELECT * FROM attachments WHERE
       (entity_type = 'order' AND entity_id = ?) OR
       (entity_type = 'recipient' AND entity_id IN (SELECT id FROM recipients WHERE order_id = ?)) OR
       (entity_type = 'purchase_order' AND entity_id IN (SELECT id FROM purchase_orders WHERE order_id = ?)) OR
       (entity_type = 'work_order' AND entity_id IN (SELECT id FROM work_orders WHERE order_id = ?)) OR
       (entity_type = 'shipment' AND entity_id IN (SELECT id FROM shipments WHERE order_id = ?))
     ORDER BY id DESC`,
    orderId,
    orderId,
    orderId,
    orderId,
    orderId,
  );

  return {
    order,
    recipients: withQc,
    bom,
    costItems,
    costing: orderCostBreakdown(orderId),
    workOrders,
    purchaseOrders,
    purchaseItems,
    shipments,
    shipmentEvents,
    messages,
    qcInspections,
    feedback,
    issues,
    history,
    activity,
    attachments,
    bomSnapshot: jsonParse<any>(order.bom_snapshot, null),
    template: order.template_id ? get<any>('SELECT * FROM order_templates WHERE id = ?', order.template_id) : null,
  };
}
