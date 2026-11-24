import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, tx } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { assertDispatchable, latestQc, setPackageStatus, setOrderStatus, tryOrderStatus } from '../lib/orders.js';
import { operatingMode } from '../lib/settings.js';
import { ApiError } from '../lib/http.js';
import { SHIPMENT_STATUSES } from '../lib/statuses.js';
import { callProvider, getDefaultProvider, getProviderRow, publicProvider, bookShipment } from '../providers/service.js';
import { fetchTracking, mapCarrierStatus } from '../providers/restTracking.js';
import { loadRuntime } from '../providers/service.js';
import type { ProviderResult, ShipmentBookingResult } from '../providers/types.js';

export const shipmentsRouter = Router();

const shipmentSelect = `SELECT s.*, r.name AS recipient_name, r.city AS recipient_city, r.phone AS recipient_phone,
  r.status AS recipient_status, o.ref AS order_ref, o.campaign_name, p.name AS provider_name, p.environment AS provider_environment
  FROM shipments s
  JOIN recipients r ON r.id = s.recipient_id
  JOIN orders o ON o.id = s.order_id
  LEFT JOIN api_providers p ON p.id = s.provider_id`;

shipmentsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.status) {
      const statuses = q.status.split(',').filter(Boolean);
      clauses.push(`s.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
    if (q.order_id) {
      clauses.push('s.order_id = ?');
      params.push(Number(q.order_id));
    }
    if (q.search) {
      clauses.push('(s.awb LIKE ? OR s.courier_name LIKE ? OR r.name LIKE ? OR o.ref LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    if (q.mode) {
      clauses.push('s.mode = ?');
      params.push(q.mode);
    }
    const rows = all<any>(`${shipmentSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY s.id DESC LIMIT 400`, ...params);
    const providers = all<any>("SELECT * FROM api_providers WHERE kind IN ('shipping','tracking')");
    res.json({
      shipments: rows,
      providers: providers.map(publicProvider),
      operatingMode: operatingMode(),
      statuses: SHIPMENT_STATUSES,
    });
  }),
);

shipmentsRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const shipment = requireRow(get<any>(`${shipmentSelect} WHERE s.id = ?`, id), 'Shipment');
    const events = all<any>('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY id DESC', id);
    const order = get<any>('SELECT * FROM orders WHERE id = ?', shipment.order_id);
    const apiLogs = all<any>('SELECT * FROM api_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 20', 'shipment', id);
    const attachments = all<any>("SELECT * FROM attachments WHERE entity_type = 'shipment' AND entity_id = ?", id);
    res.json({ shipment, events, order, apiLogs, attachments, qc: latestQc(shipment.recipient_id) });
  }),
);

const shipmentSchema = z.object({
  order_id: z.coerce.number().int().positive(),
  recipient_id: z.coerce.number().int().positive(),
  courier_name: z.string().min(1, 'Courier name is required'),
  service: z.string().optional().nullable(),
  awb: z.string().min(2, 'AWB / tracking number is required'),
  shipment_date: z.string().optional().nullable(),
  weight_g: z.coerce.number().int().min(0).optional().nullable(),
  dimensions: z.string().optional().nullable(),
  cost_paise: z.coerce.number().int().min(0).default(0),
  tracking_url: z.string().optional().nullable(),
  pickup_details: z.string().optional().nullable(),
  status: z.enum(['booked', 'dispatched']).default('booked'),
});

shipmentsRouter.post(
  '/',
  asyncHandler((req, res) => {
    const body = parse(shipmentSchema, req.body);
    const { recipient } = assertDispatchable(body.recipient_id);
    if (recipient.order_id !== body.order_id) throw new ApiError(400, 'Recipient does not belong to that order');
    const duplicate = get<any>(
      "SELECT * FROM shipments WHERE recipient_id = ? AND status NOT IN ('cancelled','test_only')",
      body.recipient_id,
    );
    if (duplicate) throw new ApiError(409, `This package already has a shipment (${duplicate.awb ?? 'no AWB'}, ${duplicate.courier_name}). Update it instead of booking another.`);

    const shipmentId = tx(() => {
      const key = `shipment:recipient:${body.recipient_id}`;
      const id = insert('shipments', {
        ...body,
        mode: 'manual',
        shipment_date: body.shipment_date ?? new Date().toISOString().slice(0, 10),
        idempotency_key: key,
        created_by: req.user!.id,
      });
      insert('shipment_events', {
        shipment_id: id,
        status: body.status,
        description: `Shipment recorded manually in Cold Post (${body.courier_name}${body.awb ? `, AWB ${body.awb}` : ''})`,
        source: 'manual',
        event_at: new Date().toISOString(),
      });
      setPackageStatus(body.recipient_id, body.status === 'dispatched' ? 'dispatched' : 'shipment_booked', req.user!.id, 'Manual shipment recorded');
      tryOrderStatus(body.order_id, body.status === 'dispatched' ? 'dispatched' : 'shipment_booked', {
        userId: req.user!.id,
        note: `Manual shipment ${body.awb}`,
      });
      logAudit({
        userId: req.user!.id,
        action: 'shipment.create.manual',
        entityType: 'shipment',
        entityId: id,
        entityLabel: body.awb,
        meta: { courier: body.courier_name, recipient: recipient.name, orderId: body.order_id },
        manualOverride: true,
      });
      return id;
    });

    res.status(201).json({ shipment: get(`${shipmentSelect} WHERE s.id = ?`, shipmentId) });
  }),
);

shipmentsRouter.post(
  '/:id/status',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const shipment = requireRow(get<any>('SELECT * FROM shipments WHERE id = ?', id), 'Shipment');
    const body = parse(
      z.object({
        status: z.enum(SHIPMENT_STATUSES),
        description: z.string().optional().nullable(),
        location: z.string().optional().nullable(),
        event_at: z.string().optional().nullable(),
      }),
      req.body,
    );
    if (shipment.is_test && body.status === 'delivered') throw new ApiError(409, 'A test-mode booking cannot be marked delivered');
    tx(() => {
      run(
        'UPDATE shipments SET status = ?, delivered_at = ?, updated_at = datetime(\'now\') WHERE id = ?',
        body.status,
        body.status === 'delivered' ? new Date().toISOString() : shipment.delivered_at,
        id,
      );
      insert('shipment_events', {
        shipment_id: id,
        status: body.status,
        description: body.description ?? `Status updated to ${body.status}`,
        location: body.location ?? null,
        event_at: body.event_at ?? new Date().toISOString(),
        source: 'manual',
      });
      applyShipmentCascade(shipment.recipient_id, shipment.order_id, body.status, req.user!.id);
      logAudit({
        userId: req.user!.id,
        action: 'shipment.status',
        entityType: 'shipment',
        entityId: id,
        entityLabel: shipment.awb,
        meta: { status: body.status, description: body.description ?? null },
      });
    });
    res.json({ shipment: get(`${shipmentSelect} WHERE s.id = ?`, id), events: all('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY id DESC', id) });
  }),
);

shipmentsRouter.post(
  '/:id/events',
  asyncHandler((req, res) => {
    const id = idParam(req);
    requireRow(get('SELECT id FROM shipments WHERE id = ?', id), 'Shipment');
    const body = parse(
      z.object({ status: z.string().min(2), description: z.string().optional().nullable(), location: z.string().optional().nullable(), event_at: z.string().optional().nullable() }),
      req.body,
    );
    insert('shipment_events', {
      shipment_id: id,
      status: body.status,
      description: body.description ?? null,
      location: body.location ?? null,
      event_at: body.event_at ?? new Date().toISOString(),
      source: 'manual',
    });
    res.status(201).json({ events: all('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY id DESC', id) });
  }),
);

function applyShipmentCascade(recipientId: number, orderId: number, status: string, userId: number) {
  const map: Record<string, string> = {
    booked: 'shipment_booked',
    dispatched: 'dispatched',
    in_transit: 'in_transit',
    out_for_delivery: 'in_transit',
    delivered: 'delivered',
    exception: 'exception',
    returned: 'returned',
  };
  const packageStatus = map[status];
  if (packageStatus) setPackageStatus(recipientId, packageStatus, userId, `Shipment ${status}`);
  if (status === 'delivered') {
    tryOrderStatus(orderId, 'delivered', { userId, note: 'Shipment delivered' });
    const remaining = get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM recipients WHERE order_id = ? AND status <> 'delivered'",
      orderId,
    )!.c;
    if (remaining === 0) tryOrderStatus(orderId, 'delivered', { userId, note: 'All packages delivered' });
  } else if (status === 'exception') {
    tryOrderStatus(orderId, 'shipment_exception', { userId, note: 'Carrier exception' });
  } else if (status === 'returned') {
    tryOrderStatus(orderId, 'returned', { userId, note: 'Shipment returned' });
  } else if (status === 'in_transit' || status === 'out_for_delivery') {
    tryOrderStatus(orderId, 'in_transit', { userId, note: 'Shipment in transit' });
  } else if (status === 'dispatched') {
    tryOrderStatus(orderId, 'dispatched', { userId, note: 'Shipment dispatched' });
  }
}

/** API-mode booking. Never runs implicitly — requires an explicit confirm flag. */
shipmentsRouter.post(
  '/:id/book',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = parse(
      z.object({ provider_id: z.coerce.number().int().positive().optional(), confirm: z.boolean().default(false) }),
      req.body ?? {},
    );
    if (operatingMode() !== 'api') {
      throw new ApiError(409, 'The app is in Manual Mode. Switch to API Mode in Settings to book through a provider, or record the shipment manually.');
    }
    const shipment = requireRow(get<any>(`${shipmentSelect} WHERE s.id = ?`, id), 'Shipment');
    if (shipment.awb && !shipment.is_test) throw new ApiError(409, 'This shipment already has an AWB — duplicate booking blocked');
    if (shipment.status === 'test_only') {
      throw new ApiError(409, 'This is a test-mode booking. Create a fresh booking once the provider is in Live mode.');
    }
    const providerRow = body.provider_id ? getProviderRow(body.provider_id) : getDefaultProvider('shipping');
    if (!providerRow) throw new ApiError(400, 'No shipping provider is configured');
    const provider = publicProvider(providerRow);
    if (!provider.configured) {
      throw new ApiError(409, `Shipping provider "${provider.name}" is NOT CONNECTED. Missing: ${provider.missing.join(', ')}`);
    }
    if (provider.environment === 'live' && !body.confirm) {
      throw new ApiError(409, 'Live booking requires explicit confirmation');
    }
    const runtime = loadRuntime(providerRow);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', shipment.recipient_id), 'Recipient');
    const order = requireRow(get<any>('SELECT * FROM orders WHERE id = ?', shipment.order_id), 'Order');

    const { result, logId } = await callProvider<ShipmentBookingResult>({
      provider: providerRow,
      action: 'shipment.book',
      userId: req.user!.id,
      idempotencyKey: shipment.idempotency_key ?? `shipment:recipient:${shipment.recipient_id}`,
      entityType: 'shipment',
      entityId: shipment.id,
      requestMeta: { recipient: recipient.name, awbExisting: shipment.awb },
      execute: (rt) =>
        bookShipment(rt, {
          reference: `${order.ref}-${recipient.id}`,
          orderRef: order.ref,
          recipient: {
            name: recipient.name,
            company: recipient.company,
            phone: recipient.phone,
            email: recipient.email,
            addressLine1: recipient.address_line1,
            addressLine2: recipient.address_line2,
            city: recipient.city,
            state: recipient.state,
            pincode: recipient.pincode,
            country: recipient.country,
          },
          packageCount: 1,
          weightG: shipment.weight_g,
          dimensions: shipment.dimensions,
          service: shipment.service,
          declaredValuePaise: order.total_value_paise,
        }),
    });

    if (!result.ok) {
      run("UPDATE shipments SET api_log_id = ?, updated_at = datetime('now') WHERE id = ?", logId, shipment.id);
      throw new ApiError(502, result.message ?? 'Provider booking failed', { apiLogId: logId, provider: provider.name });
    }
    if (result.test) {
      run("UPDATE shipments SET api_log_id = ? WHERE id = ?", logId, shipment.id);
      logAudit({ userId: req.user!.id, action: 'shipment.book.test', entityType: 'shipment', entityId: shipment.id, entityLabel: shipment.awb, meta: { provider: provider.name } });
      res.json({
        test: true,
        message: result.message ?? 'Test mode — no real booking was created',
        apiLogId: logId,
        shipment: get(`${shipmentSelect} WHERE s.id = ?`, shipment.id),
      });
      return;
    }

    const data = result.data!;
    tx(() => {
      run(
        `UPDATE shipments SET status = 'booked', awb = ?, tracking_url = ?, courier_name = COALESCE(?, courier_name),
           provider_id = ?, mode = 'api', api_log_id = ?, shipment_date = ?, is_test = 0, updated_at = datetime('now') WHERE id = ?`,
        data.awb,
        data.trackingUrl ?? shipment.tracking_url,
        data.courierName ?? null,
        providerRow.id,
        logId,
        new Date().toISOString().slice(0, 10),
        shipment.id,
      );
      insert('shipment_events', {
        shipment_id: shipment.id,
        status: 'booked',
        description: `Booked via ${provider.name} (live)`,
        source: 'api',
        event_at: new Date().toISOString(),
      });
      setPackageStatus(shipment.recipient_id, 'shipment_booked', req.user!.id, `Booked via ${provider.name}`);
      tryOrderStatus(shipment.order_id, 'shipment_booked', { userId: req.user!.id, note: `Booked via ${provider.name}` });
      logAudit({
        userId: req.user!.id,
        action: 'shipment.book.api',
        entityType: 'shipment',
        entityId: shipment.id,
        entityLabel: data.awb,
        meta: { provider: provider.name, environment: runtime.environment, apiLogId: logId },
      });
    });
    res.json({ shipment: get(`${shipmentSelect} WHERE s.id = ?`, shipment.id), apiLogId: logId });
  }),
);

shipmentsRouter.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const shipment = requireRow(get<any>('SELECT * FROM shipments WHERE id = ?', id), 'Shipment');
    if (operatingMode() !== 'api') throw new ApiError(409, 'Retry is only available in API Mode');
    const failed = get<any>(
      "SELECT * FROM api_logs WHERE entity_type = 'shipment' AND entity_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1",
      id,
    );
    if (!failed) throw new ApiError(409, 'There is no failed API booking to retry for this shipment');
    const providerRow = failed.provider_id ? getProviderRow(failed.provider_id) : getDefaultProvider('shipping');
    if (!providerRow) throw new ApiError(400, 'Shipping provider is missing');
    const provider = publicProvider(providerRow);
    if (!provider.configured) throw new ApiError(409, `Provider "${provider.name}" is NOT CONNECTED`);
    const recipient = requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', shipment.recipient_id), 'Recipient');
    const order = requireRow(get<any>('SELECT * FROM orders WHERE id = ?', shipment.order_id), 'Order');
    const runtime = loadRuntime(providerRow);

    const { result, logId } = await callProvider<ShipmentBookingResult>({
      provider: providerRow,
      action: 'shipment.book.retry',
      userId: req.user!.id,
      idempotencyKey: shipment.idempotency_key ?? `shipment:recipient:${shipment.recipient_id}`,
      retryOf: failed.id,
      entityType: 'shipment',
      entityId: shipment.id,
      requestMeta: { retryOf: failed.id },
      execute: (rt) =>
        bookShipment(rt, {
          reference: `${order.ref}-${recipient.id}`,
          orderRef: order.ref,
          recipient: {
            name: recipient.name,
            company: recipient.company,
            phone: recipient.phone,
            email: recipient.email,
            addressLine1: recipient.address_line1,
            addressLine2: recipient.address_line2,
            city: recipient.city,
            state: recipient.state,
            pincode: recipient.pincode,
            country: recipient.country,
          },
          packageCount: 1,
          weightG: shipment.weight_g,
          dimensions: shipment.dimensions,
          service: shipment.service,
          declaredValuePaise: order.total_value_paise,
        }),
    });
    if (!result.ok) throw new ApiError(502, result.message ?? 'Retry failed', { apiLogId: logId });
    if (result.test) {
      run('UPDATE shipments SET api_log_id = ? WHERE id = ?', logId, shipment.id);
      res.json({ test: true, message: result.message, apiLogId: logId });
      return;
    }
    const data = result.data!;
    run(
      `UPDATE shipments SET status = 'booked', awb = ?, tracking_url = ?, provider_id = ?, mode = 'api', api_log_id = ?, is_test = 0,
        shipment_date = ?, updated_at = datetime('now') WHERE id = ?`,
      data.awb,
      data.trackingUrl ?? shipment.tracking_url,
      providerRow.id,
      logId,
      new Date().toISOString().slice(0, 10),
      shipment.id,
    );
    insert('shipment_events', { shipment_id: shipment.id, status: 'booked', description: `Retry succeeded via ${provider.name}`, source: 'api' });
    setPackageStatus(shipment.recipient_id, 'shipment_booked', req.user!.id, 'Booked after retry');
    tryOrderStatus(shipment.order_id, 'shipment_booked', { userId: req.user!.id, note: 'Booked after retry' });
    logAudit({ userId: req.user!.id, action: 'shipment.book.retry', entityType: 'shipment', entityId: shipment.id, entityLabel: data.awb, meta: { apiLogId: logId, retryOf: failed.id } });
    res.json({ shipment: get(`${shipmentSelect} WHERE s.id = ?`, shipment.id), apiLogId: logId });
  }),
);

shipmentsRouter.post(
  '/:id/track',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    if (operatingMode() !== 'api') throw new ApiError(409, 'Tracking refresh needs API Mode with a tracking provider. Record tracking events manually instead.');
    const shipment = requireRow(get<any>('SELECT * FROM shipments WHERE id = ?', id), 'Shipment');
    if (!shipment.awb) throw new ApiError(409, 'Add an AWB before refreshing tracking');
    const providerRow = getDefaultProvider('tracking');
    if (!providerRow) throw new ApiError(400, 'No tracking provider configured');
    const provider = publicProvider(providerRow);
    if (!provider.configured) throw new ApiError(409, `Tracking provider "${provider.name}" is NOT CONNECTED. Missing: ${provider.missing.join(', ')}`);

    const { result, logId } = await callProvider({
      provider: providerRow,
      action: 'tracking.fetch',
      userId: req.user!.id,
      entityType: 'shipment',
      entityId: shipment.id,
      requestMeta: { awb: shipment.awb },
      execute: (rt) => fetchTracking(rt, shipment.awb),
    });
    if (!result.ok) throw new ApiError(502, result.message ?? 'Tracking failed', { apiLogId: logId });

    const data = (result as ProviderResult<any>).data;
    const events = (data?.events ?? []) as { status: string; description?: string; location?: string; eventAt?: string }[];
    let inserted = 0;
    let latestStatus: string | null = null;
    tx(() => {
      for (const event of events) {
        const exists = get(
          'SELECT id FROM shipment_events WHERE shipment_id = ? AND description = ? AND status = ?',
          id,
          event.description ?? null,
          event.status,
        );
        if (exists) continue;
        insert('shipment_events', {
          shipment_id: id,
          status: event.status,
          description: event.description ?? null,
          location: event.location ?? null,
          event_at: event.eventAt ?? new Date().toISOString(),
          source: 'api',
        });
        inserted += 1;
        latestStatus = mapCarrierStatus(event.status) ?? latestStatus;
      }
      const mapped = mapCarrierStatus(data?.status) ?? latestStatus;
      if (mapped) {
        run("UPDATE shipments SET status = ?, delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END, api_log_id = ?, updated_at = datetime('now') WHERE id = ?", mapped, mapped, logId, id);
        applyShipmentCascade(shipment.recipient_id, shipment.order_id, mapped, req.user!.id);
      } else {
        run('UPDATE shipments SET api_log_id = ? WHERE id = ?', logId, id);
      }
    });
    logAudit({ userId: req.user!.id, action: 'tracking.refresh', entityType: 'shipment', entityId: id, entityLabel: shipment.awb, meta: { inserted, apiLogId: logId } });
    res.json({ inserted, apiLogId: logId, events: all('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY id DESC', id) });
  }),
);
