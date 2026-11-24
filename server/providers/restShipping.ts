import type { ProviderDescriptor, ProviderResult, Runtime, ShipmentBookingInput, ShipmentBookingResult } from './types.js';

export const genericRestShipping: ProviderDescriptor = {
  kind: 'shipping',
  slug: 'generic_rest',
  name: 'Generic REST courier',
  description:
    'Connects to any courier or shipping aggregator that exposes an HTTP JSON booking API. Enter the endpoint and the field paths returned by your provider.',
  requiresExternalSetup: true,
  note: 'No courier API is bundled. Until you enter your provider base URL and token, this provider stays NOT CONNECTED and no real booking can be made.',
  fields: [
    { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.yourcourier.com', required: true, help: 'No trailing slash. Must be https.' },
    { key: 'bookPath', label: 'Booking path', placeholder: '/v1/shipments', required: true },
    { key: 'testPath', label: 'Connection test path', placeholder: '/v1/ping', help: 'Optional GET endpoint used by Test connection.' },
    { key: 'authHeader', label: 'Auth header name', placeholder: 'Authorization' },
    { key: 'authScheme', label: 'Auth scheme prefix', placeholder: 'Bearer' },
    { key: 'courierName', label: 'Courier display name', placeholder: 'Blue Dart' },
    { key: 'serviceName', label: 'Default service code', placeholder: 'SD' },
    { key: 'awbPath', label: 'AWB response path', placeholder: 'data.awb', required: true, help: 'Dot path to the AWB in the JSON response.' },
    { key: 'trackingUrlPath', label: 'Tracking URL response path', placeholder: 'data.tracking_url' },
    { key: 'token', label: 'API token', secret: true, required: true },
  ],
};

function pick(obj: unknown, dotPath: string | undefined): unknown {
  if (!dotPath) return undefined;
  let current: any = obj;
  for (const part of dotPath.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function missingConfig(runtime: Runtime) {
  const missing: string[] = [];
  for (const field of genericRestShipping.fields) {
    if (!field.required) continue;
    const value = field.secret ? runtime.secrets[field.key] : runtime.config[field.key];
    if (!value) missing.push(field.label);
  }
  return missing;
}

async function http(url: string, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkShippingConnection(runtime: Runtime): Promise<ProviderResult> {
  const missing = missingConfig(runtime);
  if (missing.length) {
    return { ok: false, message: `Not connected — missing ${missing.join(', ')}` };
  }
  const { baseUrl, testPath, authHeader, authScheme } = runtime.config;
  const token = runtime.secrets.token;
  if (!testPath) {
    return { ok: true, message: 'Credentials saved. Provider has no test endpoint configured, so only configuration was validated.', requestMeta: { baseUrl } };
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers[authHeader || 'Authorization'] = authScheme ? `${authScheme} ${token}` : token;
  try {
    const res = await http(`${baseUrl}${testPath}`, { method: 'GET', headers });
    return {
      ok: res.ok,
      httpStatus: res.status,
      message: res.ok ? 'Provider responded successfully' : `Provider returned HTTP ${res.status}`,
      requestMeta: { method: 'GET', url: `${baseUrl}${testPath}` },
      responseMeta: { status: res.status, body: res.json ?? res.text.slice(0, 500) },
    };
  } catch (error) {
    return { ok: false, message: `Connection failed — ${(error as Error).message}`, requestMeta: { method: 'GET', url: `${baseUrl}${testPath}` } };
  }
}

export async function bookShipment(runtime: Runtime, input: ShipmentBookingInput): Promise<ProviderResult<ShipmentBookingResult>> {
  const missing = missingConfig(runtime);
  if (missing.length) return { ok: false, message: `Provider not connected — missing ${missing.join(', ')}` };

  const { baseUrl, bookPath, authHeader, authScheme, awbPath, trackingUrlPath, courierName, serviceName } = runtime.config;
  const token = runtime.secrets.token;
  const url = `${baseUrl}${bookPath}`;
  const payload = {
    reference: input.reference,
    order_reference: input.orderRef,
    service: input.service || serviceName || null,
    weight_grams: input.weightG ?? null,
    dimensions: input.dimensions ?? null,
    declared_value: input.declaredValuePaise ? input.declaredValuePaise / 100 : null,
    package_count: input.packageCount,
    consignee: {
      name: input.recipient.name,
      company: input.recipient.company ?? null,
      phone: input.recipient.phone ?? null,
      email: input.recipient.email ?? null,
      address_line1: input.recipient.addressLine1 ?? null,
      address_line2: input.recipient.addressLine2 ?? null,
      city: input.recipient.city ?? null,
      state: input.recipient.state ?? null,
      pincode: input.recipient.pincode ?? null,
      country: input.recipient.country ?? 'India',
    },
  };
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (token) headers[authHeader || 'Authorization'] = authScheme ? `${authScheme} ${token}` : token;

  // A test-mode call is a dry run: it never creates a real booking.
  if (runtime.environment === 'test') {
    return {
      ok: true,
      test: true,
      message: 'Test mode — payload validated, no booking was created. Switch this provider to Live to book for real.',
      data: { awb: '', trackingUrl: null, providerRef: null, courierName: courierName ?? runtime.provider.name },
      requestMeta: { method: 'POST', url, payload },
    };
  }

  try {
    const res = await http(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const awb = pick(res.json, awbPath);
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        message: `Courier rejected the booking (HTTP ${res.status})`,
        requestMeta: { method: 'POST', url, payload },
        responseMeta: { status: res.status, body: res.json ?? res.text.slice(0, 800) },
      };
    }
    if (!awb) {
      return {
        ok: false,
        httpStatus: res.status,
        message: `Booking response did not contain an AWB at "${awbPath}" — nothing was recorded as booked`,
        requestMeta: { method: 'POST', url, payload },
        responseMeta: { status: res.status, body: res.json ?? res.text.slice(0, 800) },
      };
    }
    const trackingUrl = pick(res.json, trackingUrlPath);
    return {
      ok: true,
      httpStatus: res.status,
      data: {
        awb: String(awb),
        trackingUrl: trackingUrl ? String(trackingUrl) : null,
        providerRef: String(pick(res.json, 'data.id') ?? awb),
        courierName: courierName ?? runtime.provider.name,
      },
      requestMeta: { method: 'POST', url, payload },
      responseMeta: { status: res.status, body: res.json ?? res.text.slice(0, 800) },
    };
  } catch (error) {
    return { ok: false, message: `Booking request failed — ${(error as Error).message}`, requestMeta: { method: 'POST', url, payload } };
  }
}
