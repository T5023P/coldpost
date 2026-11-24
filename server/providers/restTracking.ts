import type { ProviderDescriptor, ProviderResult, Runtime, TrackingEvent, TrackingResult } from './types.js';

export const genericRestTracking: ProviderDescriptor = {
  kind: 'tracking',
  slug: 'generic_rest',
  name: 'Generic REST tracking',
  description:
    'Pulls scan events from any courier tracking endpoint that returns JSON. Configure the URL template and the dot paths to the status and event list.',
  requiresExternalSetup: true,
  fields: [
    { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.yourcourier.com', required: true },
    { key: 'trackingPathTemplate', label: 'Tracking path template', placeholder: '/v1/track?awb={awb}', required: true, help: 'Use {awb} where the tracking number goes.' },
    { key: 'eventsPath', label: 'Events array path', placeholder: 'data.events' },
    { key: 'statusPath', label: 'Status path', placeholder: 'data.status' },
    { key: 'eventStatusField', label: 'Event status field', placeholder: 'status' },
    { key: 'eventDescriptionField', label: 'Event description field', placeholder: 'description' },
    { key: 'eventTimeField', label: 'Event time field', placeholder: 'timestamp' },
    { key: 'eventLocationField', label: 'Event location field', placeholder: 'location' },
    { key: 'authHeader', label: 'Auth header name', placeholder: 'Authorization' },
    { key: 'authScheme', label: 'Auth scheme prefix', placeholder: 'Bearer' },
    { key: 'token', label: 'API token', secret: true },
  ],
};

function pick(obj: unknown, dotPath: string | undefined): any {
  if (!dotPath) return undefined;
  let current: any = obj;
  for (const part of dotPath.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

export function mapCarrierStatus(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (/(delivered|pod)/.test(value)) return 'delivered';
  if (/(out for delivery|ofd)/.test(value)) return 'out_for_delivery';
  if (/(return|rto)/.test(value)) return 'returned';
  if (/(exception|failed|undeliver|cancel)/.test(value)) return 'exception';
  if (/(in.?transit|transit|reached|dispatched from)/.test(value)) return 'in_transit';
  if (/(picked|picked up|booked|manifest)/.test(value)) return 'dispatched';
  return null;
}

export async function fetchTracking(runtime: Runtime, awb: string): Promise<ProviderResult<TrackingResult>> {
  const { baseUrl, trackingPathTemplate, authHeader, authScheme } = runtime.config;
  const token = runtime.secrets.token;
  if (!baseUrl || !trackingPathTemplate) {
    return { ok: false, message: 'Tracking provider not connected — base URL and path template are required' };
  }
  const url = `${baseUrl}${trackingPathTemplate.replace('{awb}', encodeURIComponent(awb))}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers[authHeader || 'Authorization'] = authScheme ? `${authScheme} ${token}` : token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      return { ok: false, httpStatus: res.status, message: `Tracking request failed (HTTP ${res.status})`, requestMeta: { url }, responseMeta: { body: text.slice(0, 500) } };
    }
    const cfg = runtime.config;
    const list = pick(json, cfg.eventsPath) ?? (Array.isArray(json) ? json : []);
    const events: TrackingEvent[] = (Array.isArray(list) ? list : []).slice(0, 50).map((item: any) => ({
      status: String(item?.[cfg.eventStatusField || 'status'] ?? 'in_transit'),
      description: String(item?.[cfg.eventDescriptionField || 'description'] ?? ''),
      location: String(item?.[cfg.eventLocationField || 'location'] ?? ''),
      eventAt: item?.[cfg.eventTimeField || 'timestamp'] ? String(item[cfg.eventTimeField || 'timestamp']) : undefined,
    }));
    return {
      ok: true,
      httpStatus: res.status,
      data: { status: pick(json, cfg.statusPath), events, raw: json },
      requestMeta: { url },
      responseMeta: { status: res.status, eventCount: events.length },
    };
  } catch (error) {
    return { ok: false, message: `Tracking request failed — ${(error as Error).message}`, requestMeta: { url } };
  } finally {
    clearTimeout(timer);
  }
}
