import { Router } from 'express';
import { z } from 'zod';
import { all, get, insert, run, update } from '../db.js';
import { asyncHandler, idParam, parse, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { getAllSettings, getSetting, operatingMode, setSetting } from '../lib/settings.js';
import { ApiError } from '../lib/http.js';
import { hashPassword } from '../lib/crypto.js';
import { ensureProviderRows, publicProvider, setProviderSecrets, getProviderRow, testProviderConnection, DESCRIPTORS } from '../providers/service.js';

export const settingsRouter = Router();

const EDITABLE_KEYS = ['business', 'currency', 'tax', 'numbering', 'costing', 'messaging', 'notifications', 'qcChecklist', 'procurement'] as const;

settingsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const users = all<any>('SELECT id, name, email, role, active, last_login_at, created_at FROM users ORDER BY id');
    const providers = all<any>('SELECT * FROM api_providers ORDER BY kind, id').map(publicProvider);
    const apiLogs = all<any>(
      `SELECT l.*, p.name AS provider_name, u.name AS user_name FROM api_logs l
       LEFT JOIN api_providers p ON p.id = l.provider_id LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.id DESC LIMIT 60`,
    );
    const audit = all<any>(
      `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 120`,
    );
    res.json({
      settings: getAllSettings(),
      operatingMode: operatingMode(),
      users,
      providers,
      providerCatalog: DESCRIPTORS.map((d) => ({ kind: d.kind, slug: d.slug, name: d.name, description: d.description, fields: d.fields, docsUrl: d.docsUrl ?? null, note: d.note ?? null })),
      apiLogs,
      audit,
      meta: {
        orderCount: get<{ c: number }>('SELECT COUNT(*) AS c FROM orders')!.c,
        messageCount: get<{ c: number }>('SELECT COUNT(*) AS c FROM messages')!.c,
        shipmentCount: get<{ c: number }>('SELECT COUNT(*) AS c FROM shipments')!.c,
      },
    });
  }),
);

settingsRouter.patch(
  '/',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can change settings');
    const body = parse(z.object({ key: z.string(), value: z.any() }), req.body);
    if (!EDITABLE_KEYS.includes(body.key as any)) {
      throw new ApiError(400, `${body.key} is not an editable setting. Use the operating mode or provider endpoints instead.`);
    }
    if (body.key === 'qcChecklist' && (!Array.isArray(body.value) || body.value.some((v: unknown) => typeof v !== 'string' || !v.trim()))) {
      throw new ApiError(400, 'QC checklist must be a list of non-empty items');
    }
    if (['currency', 'numbering', 'tax', 'costing', 'messaging', 'procurement'].includes(body.key) && (typeof body.value !== 'object' || body.value === null)) {
      throw new ApiError(400, `${body.key} must be an object`);
    }
    setSetting(body.key, body.value, req.user!.id);
    logAudit({ userId: req.user!.id, action: 'settings.update', entityType: 'settings', entityLabel: body.key, meta: { value: body.value } });
    res.json({ settings: getAllSettings() });
  }),
);

/** Mode switching never touches orders, shipments or messages. */
settingsRouter.post(
  '/mode',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can switch the operating mode');
    const body = parse(
      z.object({
        mode: z.enum(['manual', 'api']),
        note: z.string().optional().nullable(),
        apply_manual_fallback: z.boolean().optional().default(false),
      }),
      req.body,
    );
    const before = {
      orders: get<{ c: number }>('SELECT COUNT(*) AS c FROM orders')!.c,
      messages: get<{ c: number }>('SELECT COUNT(*) AS c FROM messages')!.c,
      shipments: get<{ c: number }>('SELECT COUNT(*) AS c FROM shipments')!.c,
    };
    setSetting('operatingMode', body.mode, req.user!.id);
    if (body.mode === 'api') ensureProviderRows();
    logAudit({
      userId: req.user!.id,
      action: 'settings.operating-mode',
      entityType: 'settings',
      entityLabel: 'operatingMode',
      meta: { from: operatingMode() === body.mode ? 'unknown' : 'other', to: body.mode, note: body.note ?? null, counts: before },
    });
    const after = {
      orders: get<{ c: number }>('SELECT COUNT(*) AS c FROM orders')!.c,
      messages: get<{ c: number }>('SELECT COUNT(*) AS c FROM messages')!.c,
      shipments: get<{ c: number }>('SELECT COUNT(*) AS c FROM shipments')!.c,
    };
    res.json({
      operatingMode: body.mode,
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      counts: after,
      providers: all<any>('SELECT * FROM api_providers').map(publicProvider),
    });
  }),
);

/* -------------------------------- Users -------------------------------- */

settingsRouter.get(
  '/users',
  asyncHandler((req, res) => {
    res.json({ users: all<any>('SELECT id, name, email, role, active, last_login_at, created_at FROM users ORDER BY id') });
  }),
);

settingsRouter.post(
  '/users',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can add users');
    const body = parse(
      z.object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8, 'Use at least 8 characters'),
        role: z.enum(['admin', 'ops', 'viewer']).default('ops'),
      }),
      req.body,
    );
    if (get('SELECT id FROM users WHERE lower(email) = lower(?)', body.email)) throw new ApiError(409, 'A user with that email already exists');
    const id = insert('users', { name: body.name, email: body.email, password_hash: hashPassword(body.password), role: body.role });
    logAudit({ userId: req.user!.id, action: 'user.create', entityType: 'user', entityId: id, entityLabel: body.email, meta: { role: body.role } });
    res.status(201).json({ user: get('SELECT id, name, email, role, active FROM users WHERE id = ?', id) });
  }),
);

settingsRouter.patch(
  '/users/:id',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can edit users');
    const id = idParam(req);
    const target = requireRow(get<any>('SELECT * FROM users WHERE id = ?', id), 'User');
    const body = parse(
      z.object({ name: z.string().min(2).optional(), role: z.enum(['admin', 'ops', 'viewer']).optional(), active: z.union([z.boolean(), z.number()]).optional() }),
      req.body,
    );
    if (target.id === req.user!.id && body.active !== undefined && !body.active) {
      throw new ApiError(409, 'You cannot deactivate your own account');
    }
    const adminCount = get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1")!.c;
    if (target.role === 'admin' && (body.role === 'ops' || body.role === 'viewer' || body.active === 0) && adminCount <= 1) {
      throw new ApiError(409, 'At least one active admin is required');
    }
    update('users', id, {
      ...body,
      ...(body.active === undefined ? {} : { active: body.active ? 1 : 0 }),
      updated_at: new Date().toISOString(),
    });
    logAudit({ userId: req.user!.id, action: 'user.update', entityType: 'user', entityId: id, entityLabel: target.email, meta: body });
    res.json({ user: get('SELECT id, name, email, role, active FROM users WHERE id = ?', id) });
  }),
);

settingsRouter.post(
  '/users/:id/password',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can reset passwords');
    const id = idParam(req);
    const target = requireRow(get<any>('SELECT * FROM users WHERE id = ?', id), 'User');
    const body = parse(z.object({ password: z.string().min(8, 'Use at least 8 characters') }), req.body);
    run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", hashPassword(body.password), id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
    logAudit({ userId: req.user!.id, action: 'user.password-reset', entityType: 'user', entityId: id, entityLabel: target.email });
    res.json({ ok: true });
  }),
);

/* ------------------------------ Providers ------------------------------ */

settingsRouter.get(
  '/providers',
  asyncHandler((req, res) => {
    res.json({
      providers: all<any>('SELECT * FROM api_providers ORDER BY kind, id').map(publicProvider),
      catalog: DESCRIPTORS,
      operatingMode: operatingMode(),
      logs: all<any>(
        `SELECT l.*, p.name AS provider_name FROM api_logs l LEFT JOIN api_providers p ON p.id = l.provider_id
         ORDER BY l.id DESC LIMIT 100`,
      ),
    });
  }),
);

settingsRouter.patch(
  '/providers/:id',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can configure providers');
    const id = idParam(req);
    const provider = getProviderRow(id);
    const body = parse(
      z.object({
        name: z.string().min(2).optional(),
        config: z.record(z.any()).optional(),
        environment: z.enum(['test', 'live']).optional(),
        active: z.union([z.boolean(), z.number()]).optional(),
      }),
      req.body,
    );
    const currentConfig = JSON.parse(provider.config || '{}');
    const config = body.config ? { ...currentConfig, ...body.config } : currentConfig;
    for (const key of Object.keys(config)) {
      if (config[key] === '') delete config[key];
    }
    run(
      `UPDATE api_providers SET name = ?, config = ?, environment = ?, active = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      body.name ?? provider.name,
      JSON.stringify(config),
      body.environment ?? provider.environment,
      body.active === undefined ? provider.active : body.active ? 1 : 0,
      provider.status === 'connected' ? 'configured' : provider.status,
      id,
    );
    logAudit({
      userId: req.user!.id,
      action: 'provider.update',
      entityType: 'api_provider',
      entityId: id,
      entityLabel: provider.name,
      meta: { environment: body.environment ?? provider.environment, keysChanged: body.config ? Object.keys(body.config) : [] },
    });
    res.json({ provider: publicProvider(getProviderRow(id)) });
  }),
);

settingsRouter.post(
  '/providers/:id/secrets',
  asyncHandler((req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can set credentials');
    const id = idParam(req);
    const provider = getProviderRow(id);
    const body = parse(z.object({ secrets: z.record(z.string()) }), req.body);
    setProviderSecrets(id, body.secrets);
    run("UPDATE api_providers SET status = 'configured', updated_at = datetime('now') WHERE id = ? AND status = 'not_connected'", id);
    logAudit({
      userId: req.user!.id,
      action: 'provider.secrets',
      entityType: 'api_provider',
      entityId: id,
      entityLabel: provider.name,
      meta: { keys: Object.keys(body.secrets) },
    });
    res.json({ provider: publicProvider(getProviderRow(id)), note: 'Credentials stored encrypted. They are never returned to the browser.' });
  }),
);

settingsRouter.post(
  '/providers/:id/test',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'admin') throw new ApiError(403, 'Only admins can test providers');
    const id = idParam(req);
    const result = await testProviderConnection(id, req.user!.id);
    res.json({ ...result, provider: publicProvider(getProviderRow(id)) });
  }),
);

settingsRouter.get(
  '/api-logs',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.provider_id) {
      clauses.push('l.provider_id = ?');
      params.push(Number(q.provider_id));
    }
    if (q.status) {
      clauses.push('l.status = ?');
      params.push(q.status);
    }
    res.json({
      logs: all<any>(
        `SELECT l.*, p.name AS provider_name, u.name AS user_name FROM api_logs l
         LEFT JOIN api_providers p ON p.id = l.provider_id LEFT JOIN users u ON u.id = l.user_id
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY l.id DESC LIMIT 200`,
        ...params,
      ),
    });
  }),
);

settingsRouter.get(
  '/audit-logs',
  asyncHandler((req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const clauses: string[] = [];
    const params: any[] = [];
    if (q.entity_type) {
      clauses.push('a.entity_type = ?');
      params.push(q.entity_type);
    }
    if (q.search) {
      clauses.push('(a.action LIKE ? OR a.entity_label LIKE ?)');
      params.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.overrides === 'true') clauses.push('a.manual_override = 1');
    res.json({
      logs: all<any>(
        `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT 300`,
        ...params,
      ),
    });
  }),
);
