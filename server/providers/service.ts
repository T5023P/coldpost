import { all, get, insert, jsonParse, run } from '../db.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { ApiError } from '../lib/http.js';
import { genericRestShipping, checkShippingConnection, bookShipment } from './restShipping.js';
import { genericRestTracking } from './restTracking.js';
import { whatsappCloud, checkWhatsApp } from './whatsapp.js';
import type { ProviderDescriptor, ProviderResult, ProviderRow, Runtime } from './types.js';

export const DESCRIPTORS: ProviderDescriptor[] = [genericRestShipping, genericRestTracking, whatsappCloud];

export function descriptorFor(kind: string, slug: string): ProviderDescriptor | undefined {
  return DESCRIPTORS.find((d) => d.kind === kind && d.slug === slug);
}

export function getProviderRow(id: number): ProviderRow {
  const row = get<ProviderRow>('SELECT * FROM api_providers WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'API provider not found');
  return row;
}

export function getDefaultProvider(kind: 'shipping' | 'tracking' | 'notification'): ProviderRow | undefined {
  return get<ProviderRow>(
    'SELECT * FROM api_providers WHERE kind = ? AND active = 1 ORDER BY is_default DESC, id LIMIT 1',
    kind,
  );
}

function secretFlags(providerId: number) {
  const rows = all<{ key: string }>('SELECT key FROM api_secrets WHERE provider_id = ?', providerId);
  return Object.fromEntries(rows.map((r) => [r.key, true]));
}

export function loadRuntime(row: ProviderRow): Runtime {
  const config = jsonParse<Record<string, any>>(row.config, {});
  const secrets: Record<string, string> = {};
  for (const secret of all<{ key: string; value_enc: string }>('SELECT key, value_enc FROM api_secrets WHERE provider_id = ?', row.id)) {
    try {
      secrets[secret.key] = decryptSecret(secret.value_enc);
    } catch {
      /* unreadable secret => treated as missing */
    }
  }
  return { provider: row, config, secrets, environment: row.environment };
}

export function readiness(row: ProviderRow): { ready: boolean; missing: string[] } {
  const descriptor = descriptorFor(row.kind, row.slug);
  if (!descriptor) return { ready: false, missing: ['Unknown provider type'] };
  const runtime = loadRuntime(row);
  const missing: string[] = [];
  for (const field of descriptor.fields) {
    if (!field.required) continue;
    const value = field.secret ? runtime.secrets[field.key] : runtime.config[field.key];
    if (!value) missing.push(field.label);
  }
  return { ready: missing.length === 0, missing };
}

export function publicProvider(row: ProviderRow) {
  const descriptor = descriptorFor(row.kind, row.slug);
  const { ready, missing } = readiness(row);
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    description: row.description,
    environment: row.environment,
    status: ready ? row.status : 'not_connected',
    configured: ready,
    missing,
    config: jsonParse<Record<string, any>>(row.config, {}),
    secretsSet: secretFlags(row.id),
    lastCheckAt: row.last_check_at,
    lastCheckMessage: row.last_check_message,
    isDefault: !!row.is_default,
    active: !!row.active,
    fields: descriptor?.fields ?? [],
    docsUrl: descriptor?.docsUrl ?? null,
    note: descriptor?.note ?? null,
  };
}

export function ensureProviderRows() {
  const seeds = [
    { kind: 'shipping', descriptor: genericRestShipping },
    { kind: 'tracking', descriptor: genericRestTracking },
    { kind: 'notification', descriptor: whatsappCloud },
  ] as const;
  for (const seed of seeds) {
    const exists = get<{ id: number }>('SELECT id FROM api_providers WHERE kind = ? AND slug = ?', seed.kind, seed.descriptor.slug);
    if (exists) continue;
    insert('api_providers', {
      kind: seed.kind,
      slug: seed.descriptor.slug,
      name: seed.descriptor.name,
      description: seed.descriptor.description,
      config: '{}',
      environment: 'test',
      status: 'not_connected',
      is_default: 1,
      active: 1,
    });
  }
}

export function setProviderSecrets(providerId: number, secrets: Record<string, string>) {
  for (const [key, value] of Object.entries(secrets)) {
    if (!value) {
      run('DELETE FROM api_secrets WHERE provider_id = ? AND key = ?', providerId, key);
      continue;
    }
    run(
      `INSERT INTO api_secrets (provider_id, key, value_enc, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(provider_id, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = datetime('now')`,
      providerId,
      key,
      encryptSecret(value),
    );
  }
}

function trim(value: unknown, limit: number) {
  if (value === undefined || value === null) return null;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return null;
  }
}

export interface CallOptions<T> {
  provider: ProviderRow;
  action: string;
  userId?: number | null;
  idempotencyKey?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  retryOf?: number | null;
  requestMeta?: Record<string, unknown>;
  execute: (runtime: Runtime) => Promise<ProviderResult<T>>;
}

export async function callProvider<T>(options: CallOptions<T>) {
  const runtime = loadRuntime(options.provider);
  const started = Date.now();
  let result: ProviderResult<T>;
  try {
    result = await options.execute(runtime);
  } catch (error) {
    result = { ok: false, message: (error as Error).message };
  }
  const duration = Date.now() - started;
  const status = result.ok ? (result.test ? 'test_success' : 'success') : 'failed';
  const logId = insert('api_logs', {
    provider_id: options.provider.id,
    action: options.action,
    environment: runtime.environment,
    status,
    http_status: result.httpStatus ?? null,
    request_meta: trim(result.requestMeta ?? options.requestMeta, 4000),
    response_meta: trim(result.responseMeta, 4000),
    error: result.ok ? null : result.message ?? 'Unknown provider error',
    idempotency_key: options.idempotencyKey ?? null,
    entity_type: options.entityType ?? null,
    entity_id: options.entityId ?? null,
    user_id: options.userId ?? null,
    retry_of: options.retryOf ?? null,
    duration_ms: duration,
  });
  return { result, logId, environment: runtime.environment };
}

export async function testProviderConnection(providerId: number, userId?: number | null) {
  const row = getProviderRow(providerId);
  const runtime = loadRuntime(row);
  const descriptor = descriptorFor(row.kind, row.slug);
  const started = Date.now();

  let result: ProviderResult;
  if (!descriptor) {
    result = { ok: false, message: 'Unknown provider type' };
  } else if (row.kind === 'shipping') {
    result = await checkShippingConnection(runtime);
  } else if (row.kind === 'notification') {
    result = await checkWhatsApp(runtime);
  } else {
    result = await checkTrackingConfiguration(runtime);
  }

  const { ready, missing } = readiness(row);
  const status = result.ok ? 'connected' : ready ? 'error' : 'not_connected';
  run(
    "UPDATE api_providers SET status = ?, last_check_at = datetime('now'), last_check_message = ?, updated_at = datetime('now') WHERE id = ?",
    status,
    result.message ?? (missing.length ? `Missing: ${missing.join(', ')}` : 'No response'),
    providerId,
  );
  insert('api_logs', {
    provider_id: providerId,
    action: 'test_connection',
    environment: runtime.environment,
    status: result.ok ? (result.test ? 'test_success' : 'success') : 'failed',
    http_status: result.httpStatus ?? null,
    request_meta: trim(result.requestMeta ?? null, 4000),
    response_meta: trim(result.responseMeta ?? null, 4000),
    error: result.ok ? null : result.message ?? null,
    user_id: userId ?? null,
    duration_ms: Date.now() - started,
  });
  return { ok: result.ok, message: result.message ?? '', missing, test: !!result.test, environment: runtime.environment };
}

async function checkTrackingConfiguration(runtime: Runtime): Promise<ProviderResult> {
  const missing: string[] = [];
  if (!runtime.config.baseUrl) missing.push('Base URL');
  if (!runtime.config.trackingPathTemplate) missing.push('Tracking path template');
  if (missing.length) return { ok: false, message: `Not connected — missing ${missing.join(', ')}` };
  return {
    ok: true,
    message: 'Tracking configuration saved. Tracking is fetched when you refresh a shipment.',
    requestMeta: { baseUrl: runtime.config.baseUrl, template: runtime.config.trackingPathTemplate },
  };
}

export { bookShipment };
