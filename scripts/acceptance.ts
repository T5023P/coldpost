/**
 * Cold Post — end-to-end acceptance tests.
 *
 * Runs against a live server (default http://localhost:4100) using the seeded
 * admin account. Creates its own customer, order and purchase order; does not
 * delete demo data. Run with: npm test
 */

const TEST_PORT = Number(process.env.PORT) || 4100;
const BASE = process.env.TEST_BASE ?? `http://localhost:${TEST_PORT}`;
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? 'admin@coldpost.in';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'Coldpost@2026';

type ApiResponse = { status: number; data: any; text: string; contentType: string };

let passed = 0;
const failures: string[] = [];
let adminCookie = '';
let viewerCookie = '';
const tag = Date.now().toString().slice(-6);

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const message = (error as Error).message;
    failures.push(`${name}: ${message}`);
    console.log(`  ✗ ${name}\n      ${message}`);
    throw error;
  }
}

async function api(
  method: string,
  path: string,
  body?: any,
  options: { cookie?: string; form?: FormData; raw?: boolean; origin?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  const cookie = options.cookie ?? adminCookie;
  if (cookie) headers.cookie = cookie;
  if (options.origin) headers.origin = options.origin;
  let payload: any;
  if (options.form) {
    payload = options.form;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}/api${path}`, { method, headers, body: payload, redirect: 'manual' });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text, contentType: response.headers.get('content-type') ?? '' };
}

async function login(email: string, password: string) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  check(response.status === 200, `Login failed (${response.status}): ${text}`);
  check(cookie.startsWith('cp_session='), 'Login did not set a session cookie');
  return cookie;
}

function pngBytes() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function upload(cookie: string, entityType: string, entityId: number, kind: string) {
  const form = new FormData();
  form.append('file', new Blob([pngBytes()], { type: 'image/png' }), `${kind}.png`);
  form.append('entity_type', entityType);
  form.append('entity_id', String(entityId));
  form.append('kind', kind);
  form.append('caption', 'Acceptance test evidence');
  const response = await api('POST', '/uploads', undefined, { cookie, form });
  check(response.status === 201, `Upload ${kind} failed (${response.status}): ${JSON.stringify(response.data)}`);
  return response.data.attachment;
}

async function main() {
  console.log(`\nCold Post acceptance tests → ${BASE}\n`);

  /* 1. Security: auth gate, login, foreign-origin rejection */
  const anonymous = await api('GET', '/orders', undefined, { cookie: 'none' });
  await test('1a. Anonymous requests are rejected with 401', async () => {
    check(anonymous.status === 401, `Expected 401, got ${anonymous.status}`);
  });

  adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  await test('1b. Admin can sign in and read their profile', async () => {
    const me = await api('GET', '/auth/me');
    check(me.status === 200 && me.data.user?.role === 'admin', 'Session is not an admin session');
  });

  await test('1c. Mutations from a foreign origin are refused', async () => {
    const response = await api('POST', '/customers', { company_name: 'Evil Origin Ltd' }, { origin: 'https://evil.example' });
    check(response.status === 403, `Expected 403, got ${response.status}: ${JSON.stringify(response.data)}`);
  });

  /* 2. Customers + order numbering */
  const customer = await api('POST', '/customers', {
    company_name: `Acceptance Co ${tag}`,
    contact_person: 'Test Contact',
    email: `acceptance-${tag}@example.com`,
    phone: '+91 98100 00000',
    billing_address: '12 Test Road, Bengaluru 560001',
    customer_type: 'corporate',
    status: 'active',
  });
  check(customer.status === 201, `Customer create failed: ${JSON.stringify(customer.data)}`);
  const customerId = customer.data.customer.id;

  const locations = await api('GET', '/locations?active=true');
  const cities = await api('GET', '/locations/cities');
  const cityId = cities.data.cities[0]?.id;
  const fulfilment = (locations.data.locations ?? []).find((l: any) => l.city_id === cityId) ?? locations.data.locations?.[0];
  check(!!fulfilment, 'No store/warehouse location found — seed data missing');

  const orderResponse = await api('POST', '/orders', {
    customer_id: customerId,
    order_date: new Date().toISOString().slice(0, 10),
    campaign_name: `Acceptance Campaign ${tag}`,
    campaign_type: 'client_appreciation',
    procurement_city_id: cityId,
    fulfilment_location_id: fulfilment.id,
    quotation_amount_paise: 25000000,
    total_value_paise: 25000000,
    advance_received_paise: 0,
    expected_dispatch_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    target_delivery_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  });
  await test('2. Order is created with a CP-YYYY-NNNN reference', async () => {
    check(orderResponse.status === 201, `Order create failed: ${JSON.stringify(orderResponse.data)}`);
    check(/^CP-\d{4}-\d{4}$/.test(orderResponse.data.order.ref), `Bad reference: ${orderResponse.data.order.ref}`);
  });
  const orderId = orderResponse.data.order.id;
  const orderRef = orderResponse.data.order.ref;

  /* 3. Recipients (5 packages) */
  await test('3. Five recipient packages are added in one call', async () => {
    const recipients = Array.from({ length: 5 }, (_, i) => ({
      name: `Recipient ${i + 1}`,
      company: `Team ${i + 1}`,
      phone: `+9198100${String(10000 + i)}`,
      address_line1: `${i + 1} Test Street`,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      personalisation: `Hi Recipient ${i + 1} — welcome aboard`,
    }));
    const response = await api('POST', `/orders/${orderId}/recipients`, { recipients });
    check(response.status === 201, `Recipient add failed: ${JSON.stringify(response.data)}`);
    check(response.data.bundle.recipients.length === 5, 'Expected 5 recipients');
  });

  const bundle = (await api('GET', `/orders/${orderId}`)).data;
  const recipients = bundle.recipients;
  const recipient1 = recipients[0];
  const recipient2 = recipients[1];

  /* 4. BOM from template + snapshot on confirm */
  const templates = await api('GET', '/templates');
  await test('4. A template BOM is generated and locked into a snapshot on confirm', async () => {
    const template = templates.data.templates[0];
    const generated = await api('POST', `/orders/${orderId}/bom/generate`, { template_id: template.id, replace: true });
    check(generated.status === 200, `BOM generate failed: ${JSON.stringify(generated.data)}`);
    check(generated.data.added > 0, 'Template generated zero BOM lines');
    const confirmed = await api('POST', `/orders/${orderId}/confirm`);
    check(confirmed.status === 200, `Confirm failed: ${JSON.stringify(confirmed.data)}`);
    check(!!confirmed.data.bundle.order.bom_snapshot, 'Confirmed order has no BOM snapshot');
    check(confirmed.data.bundle.order.bom_snapshot_at, 'Snapshot timestamp missing');
  });

  await test('4b. Invalid workflow transition is refused', async () => {
    const response = await api('POST', `/orders/${orderId}/transition`, { status: 'delivered' });
    check(response.status === 409, `Expected 409 for confirmed→delivered, got ${response.status}`);
  });

  /* 5. Work orders + assembly with photo evidence */
  const generatedWorkOrders = await api('POST', `/orders/${orderId}/work-orders`, {});
  check(generatedWorkOrders.status === 200, `Work order generation failed: ${JSON.stringify(generatedWorkOrders.data)}`);
  const board = await api('GET', '/production/board');
  const workOrder = [...board.data.columns.queued, ...board.data.columns.assembling].find((w: any) => w.recipient_id === recipient1.id);
  check(!!workOrder, 'No work order for the first recipient');

  await test('5a. Assembly cannot complete without photo evidence', async () => {
    const detail = await api('GET', `/work-orders/${workOrder.id}`);
    const checklist = (detail.data.workOrder.checklist ? JSON.parse(detail.data.workOrder.checklist) : []).map((c: any) => ({ ...c, done: true }));
    await api('PATCH', `/work-orders/${workOrder.id}`, { status: 'assembling' });
    const response = await api('POST', `/work-orders/${workOrder.id}/complete`, { checklist });
    check(response.status === 409, `Expected 409 without an assembly photo, got ${response.status}`);
  });

  await upload(adminCookie, 'recipient', recipient1.id, 'assembly');
  await test('5b. Assembly completes once checklist and photos are in place', async () => {
    const detail = await api('GET', `/work-orders/${workOrder.id}`);
    const checklist = (detail.data.workOrder.checklist ? JSON.parse(detail.data.workOrder.checklist) : []).map((c: any) => ({ ...c, done: true }));
    const response = await api('POST', `/work-orders/${workOrder.id}/complete`, { checklist });
    check(response.status === 200, `Complete failed: ${JSON.stringify(response.data)}`);
    const after = await api('GET', `/orders/${orderId}`);
    const recipient = after.data.recipients.find((r: any) => r.id === recipient1.id);
    check(recipient.status === 'qc_pending', `Recipient status is ${recipient.status}, expected qc_pending`);
  });

  /* 6. QC: mandatory, photo-gated, failure → rework → pass */
  const qcTemplate = await api('GET', '/qc/templates');
  const checklist = (qcTemplate.data.checklist as string[]).map((label) => ({ label, done: true }));
  await test('6a. QC cannot pass without a QC photograph', async () => {
    const response = await api('POST', `/recipients/${recipient1.id}/qc`, { status: 'passed', checklist });
    check(response.status === 409, `Expected 409 without QC photo, got ${response.status}`);
  });

  await test('6b. Failed QC sends the package to rework', async () => {
    const response = await api('POST', `/recipients/${recipient1.id}/qc`, {
      status: 'failed',
      checklist: checklist.map((item) => ({ ...item, done: false })),
      notes: 'Scratched gift box — replace outer sleeve',
    });
    check(response.status === 201, `QC fail record failed: ${JSON.stringify(response.data)}`);
    const after = await api('GET', `/orders/${orderId}`);
    check(after.data.recipients.find((r: any) => r.id === recipient1.id).status === 'rework', 'Recipient did not move to rework');
  });

  await test('6c. QC passes with complete checklist and photo', async () => {
    await upload(adminCookie, 'recipient', recipient1.id, 'qc');
    const response = await api('POST', `/recipients/${recipient1.id}/qc`, { status: 'passed', checklist });
    check(response.status === 201, `QC pass failed: ${JSON.stringify(response.data)}`);
    const after = await api('GET', `/orders/${orderId}`);
    check(after.data.recipients.find((r: any) => r.id === recipient1.id).status === 'qc_passed', 'Recipient did not reach qc_passed');
  });

  /* 7. Dispatch guard */
  await test('7. A package without passed QC cannot be shipped', async () => {
    const response = await api('POST', '/shipments', {
      order_id: orderId,
      recipient_id: recipient2.id,
      courier_name: 'Delhivery',
      awb: `GUARD${tag}`,
      cost_paise: 12000,
    });
    check(response.status === 409, `Expected 409 for un-QC'd package, got ${response.status}: ${JSON.stringify(response.data)}`);
  });

  /* 8. Manual shipment, duplicate protection, tracking to delivery */
  const shipmentResponse = await api('POST', '/shipments', {
    order_id: orderId,
    recipient_id: recipient1.id,
    courier_name: 'Delhivery',
    service: 'Surface',
    awb: `AWB${tag}`,
    cost_paise: 12500,
    status: 'booked',
  });
  await test('8a. Manual shipment is recorded with AWB and cost', async () => {
    check(shipmentResponse.status === 201, `Shipment create failed: ${JSON.stringify(shipmentResponse.data)}`);
    check(shipmentResponse.data.shipment.awb === `AWB${tag}`, 'AWB not stored');
    check(shipmentResponse.data.shipment.cost_paise === 12500, 'Cost not stored in paise');
  });
  const shipmentId = shipmentResponse.data.shipment.id;

  await test('8b. Duplicate shipment for the same package is blocked', async () => {
    const response = await api('POST', '/shipments', {
      order_id: orderId,
      recipient_id: recipient1.id,
      courier_name: 'Blue Dart',
      awb: `DUP${tag}`,
    });
    check(response.status === 409, `Expected 409 for duplicate shipment, got ${response.status}`);
  });

  await test('8c. Manual tracking status reaches delivered', async () => {
    const transit = await api('POST', `/shipments/${shipmentId}/status`, { status: 'in_transit', description: 'Left Bengaluru hub' });
    check(transit.status === 200, `Transit update failed: ${JSON.stringify(transit.data)}`);
    const delivered = await api('POST', `/shipments/${shipmentId}/status`, { status: 'delivered', description: 'Signed by recipient' });
    check(delivered.status === 200, `Delivery update failed: ${JSON.stringify(delivered.data)}`);
    check(delivered.data.shipment.status === 'delivered' && delivered.data.shipment.delivered_at, 'delivered_at not set');
    const after = await api('GET', `/orders/${orderId}`);
    check(after.data.recipients.find((r: any) => r.id === recipient1.id).status === 'delivered', 'Package did not cascade to delivered');
  });

  /* 9. Manual WhatsApp workflow */
  const messageTemplates = await api('GET', '/messages/templates');
  const templateKey = messageTemplates.data.templates[0]?.key;
  await test('9. WhatsApp message is prepared, marked sent manually and cannot be double-sent', async () => {
    const prepared = await api('POST', '/messages/prepare', { order_id: orderId, recipient_id: recipient1.id, template_key: templateKey });
    check(prepared.status === 201, `Prepare failed: ${JSON.stringify(prepared.data)}`);
    check(prepared.data.whatsappLink?.startsWith('https://wa.me/'), 'No WhatsApp deep link generated');
    const messageId = prepared.data.message.id;
    const sent = await api('POST', `/messages/${messageId}/mark-sent`, { note: 'Sent from studio phone' });
    check(sent.status === 200 && sent.data.message.status === 'sent_manual', 'Message not recorded as manually sent');
    const duplicate = await api('POST', `/messages/${messageId}/mark-sent`, {});
    check(duplicate.status === 409, `Expected 409 on second mark-sent, got ${duplicate.status}`);
    const logged = await api('GET', `/messages?order_id=${orderId}`);
    check(logged.data.messages.some((m: any) => m.id === messageId && m.status === 'sent_manual'), 'Message missing from log');
  });

  /* 10. Procurement: advance warning, override, partial receiving */
  const suppliers = await api('GET', '/suppliers');
  const products = await api('GET', '/products');
  const supplier = suppliers.data.suppliers[0];
  const product = products.data.products.find((p: any) => !p.is_packaging) ?? products.data.products[0];
  const poItem = { product_id: product.id, description: product.name, qty_requested: 10, unit_price_paise: product.purchase_price_paise || 5000 };

  await test('10a. PO below the advance threshold requires an override reason', async () => {
    const blocked = await api('POST', '/purchase-orders', { supplier_id: supplier.id, order_id: orderId, location_id: fulfilment.id, items: [poItem] });
    check(blocked.status === 409, `Expected 409 without override, got ${blocked.status}`);
  });

  const po = await api('POST', '/purchase-orders', {
    supplier_id: supplier.id,
    order_id: orderId,
    location_id: fulfilment.id,
    items: [poItem],
    status: 'sent',
    advance_override_reason: 'Approved by studio director — long-standing supplier, PO needed for dispatch date',
  });
  check(po.status === 201, `PO create failed: ${JSON.stringify(po.data)}`);
  const poId = po.data.purchaseOrder.id;
  const poLineId = po.data.items[0].id;

  await test('10b. Advance override is recorded on the PO and audit log', async () => {
    check(!!po.data.warning, 'No warning returned for an advance override');
    const detail = await api('GET', `/purchase-orders/${poId}`);
    check(!!detail.data.purchaseOrder.advance_warning_override_reason, 'Override reason not persisted');
  });

  const stockQty = async () => {
    const response = await api('GET', `/inventory?location_id=${fulfilment.id}`);
    const row = (response.data.rows ?? []).find((r: any) => r.product_id === product.id);
    return row?.qty_available ?? 0;
  };
  const beforeQty = await stockQty();

  await test('10c. Partial receiving updates stock and PO status', async () => {
    const partial = await api('POST', `/purchase-orders/${poId}/receive`, { location_id: fulfilment.id, lines: [{ item_id: poLineId, received: 4 }] });
    check(partial.status === 200, `Partial receive failed: ${JSON.stringify(partial.data)}`);
    const detail = await api('GET', `/purchase-orders/${poId}`);
    check(detail.data.purchaseOrder.status === 'partial', `PO status is ${detail.data.purchaseOrder.status}, expected partial`);
    const afterQty = await stockQty();
    check(afterQty === beforeQty + 4, `Stock moved by ${afterQty - beforeQty}, expected +4`);
    const complete = await api('POST', `/purchase-orders/${poId}/receive`, { location_id: fulfilment.id, lines: [{ item_id: poLineId, received: 6 }] });
    check(complete.status === 200, `Final receive failed: ${JSON.stringify(complete.data)}`);
    const final = await api('GET', `/purchase-orders/${poId}`);
    check(final.data.purchaseOrder.status === 'received', `PO status is ${final.data.purchaseOrder.status}, expected received`);
  });

  /* 11. Cross-location stock transfer */
  await test('11. Stock transfer moves quantity between stores with a ledger entry', async () => {
    const other = (locations.data.locations ?? []).find((l: any) => l.id !== fulfilment.id);
    check(!!other, 'Need a second location for the transfer test');
    const response = await api('POST', '/inventory/transfer', {
      product_id: product.id,
      from_location_id: fulfilment.id,
      to_location_id: other.id,
      qty: 2,
      note: 'Acceptance transfer',
    });
    check(response.status === 200, `Transfer failed: ${JSON.stringify(response.data)}`);
    const movement = await api('GET', `/inventory/movements?product_id=${product.id}`);
    const logged = (movement.data.movements ?? []).filter((m: any) => String(m.type).startsWith('transfer'));
    check(logged.length >= 2, `Expected paired transfer movements, found ${logged.length}`);
  });

  /* 12. Feedback */
  await test('12. Customer feedback is captured and linked to the order', async () => {
    const response = await api('POST', '/feedback', {
      order_id: orderId,
      recipient_id: recipient1.id,
      delivery_confirmed: true,
      rating: 5,
      comments: 'Arrived early and beautifully packed.',
      packaging_feedback: 'Excellent',
      repeat_interest: true,
    });
    check(response.status === 201, `Feedback failed: ${JSON.stringify(response.data)}`);
    const order = await api('GET', `/orders/${orderId}`);
    check((order.data.feedback ?? []).length >= 1, 'Feedback not attached to order bundle');
  });

  /* 13. Costing */
  await test('13. Costing reflects revenue, BOM estimate, actual POs and shipping', async () => {
    const costing = await api('GET', `/orders/${orderId}/costing`);
    check(costing.status === 200, `Costing failed: ${JSON.stringify(costing.data)}`);
    const totals = costing.data.costing ?? costing.data.totals ?? costing.data;
    check(Number(totals.sellingPricePaise ?? totals.revenuePaise) === 25000000, 'Revenue does not match the order value');
    check(Number(totals.actualTotalPaise ?? totals.actualCostPaise) > 0, 'Actual cost is zero after receiving a PO and shipping');
    check(Number(totals.productActualPaise) > 0, 'PO receipts are not reflected in actual product cost');
    check(Number(totals.shippingActualPaise) === 12500, 'Shipment cost is not reflected in actual shipping cost');
  });

  /* 14. Reports + CSV */
  await test('14. Reports render and CSV export is served', async () => {
    const reports = await api('GET', '/reports');
    check(reports.status === 200 && reports.data.reports.length >= 10, `Only ${reports.data.reports?.length} reports available`);
    const key = reports.data.reports[0].key;
    const json = await api('GET', `/reports/${key}`);
    check(json.status === 200 && Array.isArray(json.data.rows) && Array.isArray(json.data.columns), 'Report JSON malformed');
    const csv = await api('GET', `/reports/${key}?format=csv`);
    check(csv.status === 200 && csv.contentType.includes('text/csv'), `CSV content-type was ${csv.contentType}`);
    check(csv.text.split('\n')[0].includes(','), 'CSV header missing');
  });

  /* 15. Operating mode switch: honest failures, no data change */
  await test('15a. Switching to API mode changes no data', async () => {
    const switched = await api('POST', '/settings/mode', { mode: 'api', note: 'Acceptance test' });
    check(switched.status === 200 && switched.data.operatingMode === 'api', `Mode switch failed: ${JSON.stringify(switched.data)}`);
    check(switched.data.unchanged === true, 'Mode switch reported data changes');
    const after = await api('GET', `/orders/${orderId}`);
    check(after.data.order.status === bundle.order.status || after.data.recipients.length === 5, 'Data changed during mode switch');
  });

  await test('15b. Unconfigured provider refuses to fake a send', async () => {
    const prepared = await api('POST', '/messages/prepare', { order_id: orderId, recipient_id: recipient2.id, template_key: templateKey });
    check(prepared.status === 201, `Prepare for API send failed: ${JSON.stringify(prepared.data)}`);
    const response = await api('POST', `/messages/${prepared.data.message.id}/send`, { confirm: true });
    check([400, 409, 502].includes(response.status), `Expected a refusal, got ${response.status}`);
    check(/NOT CONNECTED|not connected|configured|credential/i.test(JSON.stringify(response.data)), `Refusal message is not honest: ${JSON.stringify(response.data)}`);
    const after = await api('GET', `/messages?order_id=${orderId}`);
    check(!after.data.messages.some((m: any) => m.id === prepared.data.message.id && m.status === 'sent'), 'An unconfigured provider was recorded as sent');
  });

  await test('15c. Switching back to manual preserves shipments and messages', async () => {
    const switched = await api('POST', '/settings/mode', { mode: 'manual' });
    check(switched.status === 200 && switched.data.unchanged === true, 'Manual switch failed or changed data');
    const shipments = await api('GET', `/shipments?order_id=${orderId}`);
    check(shipments.data.shipments.length === 1 && shipments.data.shipments[0].status === 'delivered', 'Shipment lost during mode switch');
  });

  /* 16. Role enforcement, persistence, audit */
  const viewerEmail = `viewer-${tag}@example.com`;
  await test('16a. Viewer accounts can read but not write', async () => {
    const created = await api('POST', '/settings/users', { name: 'Acceptance Viewer', email: viewerEmail, password: 'Viewer@2026', role: 'viewer' });
    check(created.status === 201, `Viewer create failed: ${JSON.stringify(created.data)}`);
    viewerCookie = await login(viewerEmail, 'Viewer@2026');
    const read = await api('GET', '/orders', undefined, { cookie: viewerCookie });
    check(read.status === 200, 'Viewer could not read orders');
    const write = await api('POST', '/customers', { company_name: 'Should Fail' }, { cookie: viewerCookie });
    check(write.status === 403, `Viewer write returned ${write.status}, expected 403`);
  });

  await test('16b. Data persists across sessions and is visible in audit logs', async () => {
    const freshCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const order = await api('GET', `/orders/${orderId}`, undefined, { cookie: freshCookie });
    check(order.data.recipients.length === 5, 'Recipients missing after re-login');
    const settings = await api('GET', '/settings', undefined, { cookie: freshCookie });
    const overrides = (settings.data.audit ?? []).filter((entry: any) => entry.manual_override);
    check(overrides.length >= 1, 'No manual overrides recorded in the audit trail');
    const poAudit = (settings.data.audit ?? []).some((entry: any) => entry.action === 'purchase-order.create' && entry.manual_override);
    check(poAudit, 'Advance override was not audited');
  });

  console.log(`\n${passed} checks passed, ${failures.length} failed.\n`);
  if (failures.length) {
    for (const failure of failures) console.log(` • ${failure}`);
    process.exit(1);
  }
  console.log(`Order under test: ${orderRef} (id ${orderId})\n`);
}

main().catch((error) => {
  console.error(`\nAcceptance run stopped: ${(error as Error).message}\n`);
  console.error(`${passed} checks passed before the stop.\n`);
  process.exit(1);
});
