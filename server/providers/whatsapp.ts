import type { MessageInput, MessageResult, ProviderDescriptor, ProviderResult, Runtime } from './types.js';

/**
 * WhatsApp Cloud API (Meta). Endpoints follow the official Graph API:
 *   GET  /{version}/{phone-number-id}        -> verify credentials
 *   POST /{version}/{phone-number-id}/messages
 * Customer-initiated conversations inside the 24h window accept plain text;
 * business-initiated messages need an approved template, which you can name
 * in the provider settings.
 */
export const whatsappCloud: ProviderDescriptor = {
  kind: 'notification',
  slug: 'whatsapp_cloud',
  name: 'WhatsApp Cloud API (Meta)',
  description: 'Official Meta WhatsApp Business Cloud API for customer notifications.',
  docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  fields: [
    { key: 'phoneNumberId', label: 'Phone number ID', required: true, placeholder: '1029384756' },
    { key: 'apiVersion', label: 'Graph API version', placeholder: 'v21.0' },
    { key: 'templateName', label: 'Approved template name', placeholder: 'coldpost_order_update', help: 'Required for business-initiated messages outside the 24h customer window. The message body is sent as the template body parameter.' },
    { key: 'languageCode', label: 'Template language', placeholder: 'en' },
    { key: 'senderNumber', label: 'Sender display number', placeholder: '+91…' },
    { key: 'accessToken', label: 'Permanent access token', secret: true, required: true },
  ],
};

function graphBase(runtime: Runtime) {
  const version = runtime.config.apiVersion || 'v21.0';
  return `https://graph.facebook.com/${version}/${runtime.config.phoneNumberId}`;
}

function normalizePhone(raw: string, fallbackCode = '+91') {
  const trimmed = raw.trim().replace(/[\s()-]/g, '');
  if (trimmed.startsWith('+')) return trimmed.slice(1);
  if (trimmed.startsWith('00')) return trimmed.slice(2);
  if (/^\d{10}$/.test(trimmed)) return `${fallbackCode.replace('+', '')}${trimmed}`;
  return trimmed.replace(/^\+/, '');
}

function requireConfig(runtime: Runtime): string[] {
  const missing: string[] = [];
  if (!runtime.config.phoneNumberId) missing.push('Phone number ID');
  if (!runtime.secrets.accessToken) missing.push('Access token');
  return missing;
}

export async function checkWhatsApp(runtime: Runtime): Promise<ProviderResult> {
  const missing = requireConfig(runtime);
  if (missing.length) return { ok: false, message: `Not connected — missing ${missing.join(', ')}` };
  const url = `${graphBase(runtime)}?fields=id,display_phone_number,verified_name`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${runtime.secrets.accessToken}` } });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        message: `Meta rejected the credentials (HTTP ${res.status})`,
        requestMeta: { method: 'GET', url: `${graphBase(runtime)}` },
        responseMeta: { status: res.status, body: json ?? text.slice(0, 500) },
      };
    }
    return {
      ok: true,
      httpStatus: res.status,
      message: `Connected to ${json?.verified_name ?? 'WhatsApp Business'} (${json?.display_phone_number ?? 'number hidden'})`,
      requestMeta: { method: 'GET', url: graphBase(runtime) },
      responseMeta: { status: res.status, body: json },
    };
  } catch (error) {
    return { ok: false, message: `Connection failed — ${(error as Error).message}` };
  }
}

export async function sendWhatsApp(runtime: Runtime, input: MessageInput): Promise<ProviderResult<MessageResult>> {
  const missing = requireConfig(runtime);
  if (missing.length) return { ok: false, message: `WhatsApp not connected — missing ${missing.join(', ')}` };

  const to = normalizePhone(input.to);
  if (!/^\d{8,15}$/.test(to)) return { ok: false, message: `"${input.to}" is not a valid WhatsApp number` };

  if (runtime.environment === 'test') {
    return {
      ok: true,
      test: true,
      message: 'Test mode — message validated, nothing was sent. Switch this provider to Live to deliver messages.',
      data: { providerRef: null },
      requestMeta: { to, preview: input.body.slice(0, 120) },
    };
  }

  const url = `${graphBase(runtime)}/messages`;
  const payload: Record<string, unknown> = { messaging_product: 'whatsapp', to };
  if (runtime.config.templateName) {
    payload.type = 'template';
    payload.template = {
      name: runtime.config.templateName,
      language: { code: runtime.config.languageCode || 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: input.body.slice(0, 1024) }] }],
    };
  } else {
    payload.type = 'text';
    payload.text = { preview_url: true, body: input.body };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.secrets.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const apiMessage = json?.error?.message ?? `HTTP ${res.status}`;
      return {
        ok: false,
        httpStatus: res.status,
        message: `WhatsApp rejected the message — ${apiMessage}`,
        requestMeta: { method: 'POST', url: graphBase(runtime), to, templateName: runtime.config.templateName ?? null },
        responseMeta: { status: res.status, body: json ?? text.slice(0, 800) },
      };
    }
    const providerRef = json?.messages?.[0]?.id ?? null;
    return {
      ok: true,
      httpStatus: res.status,
      data: { providerRef, message: 'Sent to WhatsApp' },
      requestMeta: { method: 'POST', url: graphBase(runtime), to },
      responseMeta: { status: res.status, body: json },
    };
  } catch (error) {
    return { ok: false, message: `Send failed — ${(error as Error).message}` };
  }
}
