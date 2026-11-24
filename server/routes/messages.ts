import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { operatingMode } from '../lib/settings.js';
import { ApiError } from '../lib/http.js';
import { callProvider, getDefaultProvider, getProviderRow, publicProvider } from '../providers/service.js';
import { loadRuntime } from '../providers/service.js';
import { sendWhatsApp } from '../providers/whatsapp.js';
import type { MessageResult, ProviderResult } from '../providers/types.js';

export const messagesRouter = Router();

const messageSelect = `SELECT m.*, r.name AS recipient_name, o.ref AS order_ref, o.campaign_name, c.company_name,
  p.name AS provider_name, u.name AS sent_by_name
  FROM messages m
  LEFT JOIN recipients r ON r.id = m.recipient_id
  LEFT JOIN orders o ON o.id = m.order_id
  LEFT JOIN customers c ON c.id = m.customer_id
  LEFT JOIN api_providers p ON p.id = m.provider_id
  LEFT JOIN users u ON u.id = m.sent_confirmed_by`;

function buildVariables(orderId: number, recipientId: number | null) {
  const order = get<any>(
    `SELECT o.*, c.company_name, c.contact_person, c.phone AS customer_phone, c.email AS customer_email
     FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    orderId,
  );
  if (!order) throw new ApiError(404, 'Order not found');
  const recipient = recipientId
    ? get<any>('SELECT * FROM recipients WHERE id = ? AND order_id = ?', recipientId, orderId)
    : null;
  const shipment = recipient
    ? get<any>(
        "SELECT * FROM shipments WHERE recipient_id = ? AND status NOT IN ('cancelled','test_only') ORDER BY id DESC LIMIT 1",
        recipient.id,
      )
    : null;
  return {
    '{{customer_name}}': order.company_name,
    '{{contact_person}}': order.contact_person ?? order.company_name,
    '{{recipient_name}}': recipient?.name ?? order.contact_person ?? order.company_name,
    '{{order_ref}}': order.ref,
    '{{campaign_name}}': order.campaign_name,
    '{{order_status}}': order.status,
    '{{unit_count}}': recipient ? '1 package' : String(order.recipient_count ?? order.recipient_count ?? 0),
    '{{courier}}': shipment?.courier_name ?? 'our courier partner',
    '{{awb}}': shipment?.awb ?? '',
    '{{tracking_url}}': shipment?.tracking_url ?? '',
    '{{dispatch_date}}': shipment?.shipment_date ?? order.expected_dispatch_date ?? '',
    '{{delivery_address}}': recipient
      ? [recipient.address_line1, recipient.address_line2, recipient.city, recipient.state, recipient.pincode].filter(Boolean).join(', ')
      : '',
    '{{advance_due}}': ((order.total_value_paise - order.advance_received_paise) / 100).toLocaleString('en-IN'),
    '{{order_value}}': (order.total_value_paise / 100).toLocaleString('en-IN'),
  } as Record<string, string>;
}

function renderTemplate(body: string, vars: Record<string, string>) {
  let output = body;
  for (const [key, value] of Object.entries(vars)) output = output.split(key).join(value ?? '');
  return output;
}

function whatsappLink(phone: string | null, body: string) {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  const number = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
}

messagesRouter.get(
  '/templates',
  asyncHandler((req, res) => {
    res.json({ templates: all<any>('SELECT * FROM message_templates ORDER BY id') });
  }),
);

messagesRouter.patch(
  '/templates/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const template = requireRow(get<any>('SELECT * FROM message_templates WHERE id = ?', id), 'Template');
    const body = parse(z.object({ name: z.string().min(2).optional(), body: z.string().min(5).optional(), active: z.union([z.boolean(), z.number()]).optional() }), req.body);
    run(
      'UPDATE message_templates SET name = ?, body = ?, active = ?, updated_at = datetime(\'now\') WHERE id = ?',
      body.name ?? template.name,
      body.body ?? template.body,
      body.active === undefined ? template.active : body.active ? 1 : 0,
      id,
    );
    logAudit({ userId: req.user!.id, action: 'message-template.update', entityType: 'message_template', entityId: id, entityLabel: template.key });
    res.json({ template: get('SELECT * FROM message_templates WHERE id = ?', id) });
  }),
);

messagesRouter.get(
  '/',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.order_id) {
      clauses.push('m.order_id = ?');
      params.push(Number(q.order_id));
    }
    if (q.status) {
      clauses.push('m.status = ?');
      params.push(q.status);
    }
    const rows = all<any>(
      `${messageSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT 300`,
      ...params,
    );
    res.json({ messages: rows, templates: all<any>('SELECT * FROM message_templates WHERE active = 1 ORDER BY id'), operatingMode: operatingMode(), providers: all<any>("SELECT * FROM api_providers WHERE kind = 'notification'").map(publicProvider) });
  }),
);

messagesRouter.post(
  '/preview',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({ order_id: z.coerce.number().int().positive(), recipient_id: z.coerce.number().int().positive().nullable().optional(), template_key: z.string(), body: z.string().optional() }),
      req.body,
    );
    const vars = buildVariables(body.order_id, body.recipient_id ?? null);
    const template = requireRow(get<any>('SELECT * FROM message_templates WHERE key = ?', body.template_key), 'Message template');
    const text = renderTemplate(body.body ?? template.body, vars);
    res.json({ body: text, whatsappLink: whatsappLink(vars['{{whatsapp_phone}}'] ?? null, text) });
  }),
);

messagesRouter.post(
  '/prepare',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        order_id: z.coerce.number().int().positive(),
        recipient_id: z.coerce.number().int().positive().nullable().optional(),
        template_key: z.string().min(2),
        body: z.string().optional(),
      }),
      req.body,
    );
    const order = requireRow(get<any>('SELECT * FROM orders WHERE id = ?', body.order_id), 'Order');
    const template = requireRow(get<any>('SELECT * FROM message_templates WHERE key = ?', body.template_key), 'Message template');
    const recipient = body.recipient_id ? requireRow(get<any>('SELECT * FROM recipients WHERE id = ?', body.recipient_id), 'Recipient') : null;
    const customer = get<any>('SELECT * FROM customers WHERE id = ?', order.customer_id)!;
    const vars = buildVariables(body.order_id, body.recipient_id ?? null);
    const text = renderTemplate(body.body ?? template.body, vars);

    const phone = (recipient?.phone || customer.phone || '').trim();
    const existing = get<any>(
      "SELECT * FROM messages WHERE order_id = ? AND IFNULL(recipient_id,0) = IFNULL(?,0) AND template_key = ? AND status = 'prepared' ORDER BY id DESC LIMIT 1",
      body.order_id,
      body.recipient_id ?? null,
      body.template_key,
    );
    if (existing) {
      res.json({ message: get(`${messageSelect} WHERE m.id = ?`, existing.id), whatsappLink: whatsappLink(phone, existing.body), existing: true });
      return;
    }
    const id = insert('messages', {
      order_id: body.order_id,
      recipient_id: body.recipient_id ?? null,
      customer_id: order.customer_id,
      template_key: body.template_key,
      channel: 'whatsapp',
      to_phone: phone || null,
      body: text,
      status: 'prepared',
      created_by: req.user!.id,
    });
    logAudit({ userId: req.user!.id, action: 'message.prepare', entityType: 'message', entityId: id, entityLabel: `${template.name} — ${order.ref}`, meta: { orderId: body.order_id, recipientId: body.recipient_id ?? null } });
    res.status(201).json({ message: get(`${messageSelect} WHERE m.id = ?`, id), whatsappLink: whatsappLink(phone, text) });
  }),
);

messagesRouter.post(
  '/:id/copied',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const message = requireRow(get<any>('SELECT * FROM messages WHERE id = ?', id), 'Message');
    if (message.status === 'sent' || message.status === 'sent_manual') {
      res.json({ message: get(`${messageSelect} WHERE m.id = ?`, id), note: 'Already marked as sent' });
      return;
    }
    run("UPDATE messages SET status = 'copied', updated_at = datetime('now') WHERE id = ?", id);
    logAudit({ userId: req.user!.id, action: 'message.copied', entityType: 'message', entityId: id, entityLabel: message.template_key, meta: { orderId: message.order_id } });
    res.json({ message: get(`${messageSelect} WHERE m.id = ?`, id) });
  }),
);

/** Manual mode: the operator confirms they actually sent it in WhatsApp. */
messagesRouter.post(
  '/:id/mark-sent',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const message = requireRow(get<any>('SELECT * FROM messages WHERE id = ?', id), 'Message');
    if (['sent', 'sent_manual'].includes(message.status)) {
      throw new ApiError(409, 'This message is already recorded as sent');
    }
    const body = parse(z.object({ note: z.string().optional().nullable(), edited_body: z.string().optional() }), req.body ?? {});
    run(
      "UPDATE messages SET status = 'sent_manual', body = ?, sent_at = datetime('now'), sent_confirmed_by = ?, updated_at = datetime('now') WHERE id = ?",
      body.edited_body ?? message.body,
      req.user!.id,
      id,
    );
    insert('audit_logs', {
      user_id: req.user!.id,
      action: 'message.sent.manual',
      entity_type: 'message',
      entity_id: id,
      entity_label: message.template_key,
      meta: JSON.stringify({ orderId: message.order_id, recipientId: message.recipient_id, note: body.note ?? null, claimedByOperator: true }),
      manual_override: 1,
    });
    res.json({ message: get(`${messageSelect} WHERE m.id = ?`, id) });
  }),
);

/** API mode: send through the configured notification provider. */
messagesRouter.post(
  '/:id/send',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = parse(
      z.object({ confirm: z.boolean().default(false), provider_id: z.coerce.number().int().positive().optional(), edited_body: z.string().optional() }),
      req.body ?? {},
    );
    if (operatingMode() !== 'api') {
      throw new ApiError(409, 'The app is in Manual Mode. Prepare and copy the message instead, then record that you sent it.');
    }
    const message = requireRow(get<any>(`${messageSelect} WHERE m.id = ?`, id), 'Message');
    if (['sent', 'sent_manual'].includes(message.status)) throw new ApiError(409, 'This message is already recorded as sent — duplicate send blocked');
    if (!message.to_phone) throw new ApiError(400, 'No phone number on this message or recipient');
    const providerRow = body.provider_id ? getProviderRow(body.provider_id) : getDefaultProvider('notification');
    if (!providerRow) throw new ApiError(400, 'No notification provider configured');
    const provider = publicProvider(providerRow);
    if (!provider.configured) throw new ApiError(409, `WhatsApp provider "${provider.name}" is NOT CONNECTED. Missing: ${provider.missing.join(', ')}`);
    if (provider.environment === 'live' && !body.confirm) throw new ApiError(409, 'Live send requires explicit confirmation');

    const idempotencyKey = message.idempotency_key ?? `message:${message.id}`;
    const text = body.edited_body ?? message.body;
    const { result, logId } = await callProvider<MessageResult>({
      provider: providerRow,
      action: 'message.send',
      userId: req.user!.id,
      idempotencyKey,
      entityType: 'message',
      entityId: id,
      requestMeta: { to: message.to_phone, template: message.template_key },
      execute: (rt) => sendWhatsApp(rt, { to: message.to_phone!, body: text, reference: String(message.order_id) }),
    });

    if (!result.ok) {
      run(
        "UPDATE messages SET status = 'failed', error = ?, api_log_id = ?, provider_id = ?, updated_at = datetime('now') WHERE id = ?",
        result.message ?? 'Send failed',
        logId,
        providerRow.id,
        id,
      );
      throw new ApiError(502, result.message ?? 'WhatsApp send failed', { apiLogId: logId, provider: provider.name });
    }
    if (result.test) {
      run(
        "UPDATE messages SET status = 'test_only', provider_id = ?, api_log_id = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
        providerRow.id,
        logId,
        result.message ?? 'Test mode — message not sent',
        id,
      );
      logAudit({ userId: req.user!.id, action: 'message.send.test', entityType: 'message', entityId: id, entityLabel: message.template_key, meta: { provider: provider.name, apiLogId: logId } });
      res.json({ test: true, message: get(`${messageSelect} WHERE m.id = ?`, id), apiLogId: logId, providerMessage: result.message });
      return;
    }
    run(
      "UPDATE messages SET status = 'sent', provider_ref = ?, provider_id = ?, api_log_id = ?, body = ?, sent_at = datetime('now'), idempotency_key = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
      result.data?.providerRef ?? null,
      providerRow.id,
      logId,
      text,
      idempotencyKey,
      id,
    );
    logAudit({
      userId: req.user!.id,
      action: 'message.send.api',
      entityType: 'message',
      entityId: id,
      entityLabel: message.template_key,
      meta: { provider: provider.name, providerRef: result.data?.providerRef ?? null, apiLogId: logId },
    });
    res.json({ message: get(`${messageSelect} WHERE m.id = ?`, id), apiLogId: logId });
  }),
);

messagesRouter.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const message = requireRow(get<any>('SELECT * FROM messages WHERE id = ?', id), 'Message');
    if (operatingMode() !== 'api') throw new ApiError(409, 'Retry is only available in API Mode');
    if (message.status !== 'failed') throw new ApiError(409, 'Only failed messages can be retried');
    const failedLog = get<any>(
      "SELECT * FROM api_logs WHERE entity_type = 'message' AND entity_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1",
      id,
    );
    const providerRow = failedLog?.provider_id ? getProviderRow(failedLog.provider_id) : getDefaultProvider('notification');
    if (!providerRow) throw new ApiError(400, 'Provider missing');
    const provider = publicProvider(providerRow);
    if (!provider.configured) throw new ApiError(409, `Provider "${provider.name}" is NOT CONNECTED`);
    const { result, logId } = await callProvider<MessageResult>({
      provider: providerRow,
      action: 'message.send.retry',
      userId: req.user!.id,
      retryOf: failedLog?.id ?? null,
      entityType: 'message',
      entityId: id,
      idempotencyKey: `message:${id}`,
      requestMeta: { to: message.to_phone, retryOf: failedLog?.id ?? null },
      execute: (rt) => sendWhatsApp(rt, { to: message.to_phone!, body: message.body, reference: String(message.order_id) }),
    });
    if (!result.ok) {
      run("UPDATE messages SET status = 'failed', error = ?, api_log_id = ? WHERE id = ?", result.message ?? 'Retry failed', logId, id);
      throw new ApiError(502, result.message ?? 'Retry failed', { apiLogId: logId });
    }
    if (result.test) {
      run("UPDATE messages SET status = 'test_only', api_log_id = ?, error = ? WHERE id = ?", logId, result.message ?? null, id);
      res.json({ test: true, message: get(`${messageSelect} WHERE m.id = ?`, id), apiLogId: logId });
      return;
    }
    run(
      "UPDATE messages SET status = 'sent', sent_at = datetime('now'), provider_ref = ?, provider_id = ?, api_log_id = ?, error = NULL WHERE id = ?",
      result.data?.providerRef ?? null,
      providerRow.id,
      logId,
      id,
    );
    logAudit({ userId: req.user!.id, action: 'message.send.retry', entityType: 'message', entityId: id, meta: { apiLogId: logId } });
    res.json({ message: get(`${messageSelect} WHERE m.id = ?`, id), apiLogId: logId });
  }),
);
