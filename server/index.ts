import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';
import { ROOT, UPLOAD_DIR, get, migrate } from './db.js';
import { attachUser } from './lib/auth.js';
import { ApiError } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { dashboardRouter } from './routes/dashboard.js';
import { customersRouter } from './routes/customers.js';
import { ordersRouter } from './routes/orders.js';
import { catalogRouter } from './routes/catalog.js';
import { locationsRouter } from './routes/locations.js';
import { suppliersRouter } from './routes/suppliers.js';
import { procurementRouter } from './routes/procurement.js';
import { inventoryRouter } from './routes/inventory.js';
import { productionRouter } from './routes/production.js';
import { shipmentsRouter } from './routes/shipments.js';
import { messagesRouter } from './routes/messages.js';
import { feedbackRouter } from './routes/feedback.js';
import { reportsRouter } from './routes/reports.js';
import { settingsRouter } from './routes/settings.js';
import { uploadsRouter } from './routes/uploads.js';
import { ensureProviderRows } from './providers/service.js';
import { supabaseAuthEnabled } from './lib/supabaseAuth.js';
import { ensureSeed } from './seed.js';

const usePg = !!process.env.DATABASE_URL;

// Conditionally import the pool from db.pg if using PostgreSQL
let pool: any = null;
if (usePg) {
  const pgDb = await import('./db.pg.js');
  pool = pgDb.pool;
}

migrate();
ensureProviderRows();
ensureSeed();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));

// Origins allowed to call the API from a browser. The frontend is served by
// Cloudflare Pages while the API lives on api.coldpost.delivery, so the two
// hosts differ and CORS is required. Only these exact origins are accepted.
const allowedOrigins = new Set<string>();
for (const entry of (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',')) {
  const origin = entry.trim().replace(/\/+$/, '');
  if (origin) allowedOrigins.add(origin);
}
for (const fallback of [
  process.env.FRONTEND_URL,
  'https://coldpost.delivery',
  'https://www.coldpost.delivery',
  'https://coldpost.pages.dev',
]) {
  const origin = (fallback ?? '').trim().replace(/\/+$/, '');
  if (origin) allowedOrigins.add(origin);
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** True when the browser origin is the API's own host or an allowlisted frontend. */
function originAllowed(origin: string, requestHost: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = requestHost.split(':')[0];
    if (parsed.hostname === host) return true;
    return LOOPBACK_HOSTS.includes(parsed.hostname) && LOOPBACK_HOSTS.includes(host);
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin, req.headers.host ?? '')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    // Preflight from an unknown origin gets no CORS headers, so the browser
    // refuses to send the real request.
    res.sendStatus(204);
    return;
  }
  next();
});

// Unauthenticated liveness/readiness probe used by Docker and the tunnel.
app.get('/health', (_req, res) => {
  let sqlite = 'ok';
  try {
    get('SELECT 1 AS ok');
  } catch (error) {
    sqlite = `error: ${(error as Error).message}`;
  }
  const healthy = sqlite === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'coldpost-api',
    sqlite,
    supabaseAuth: supabaseAuthEnabled,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.use(attachUser);

// Block cross-site state changes. Cookies are SameSite=Lax as a second layer.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin, req.headers.host ?? '')) {
      res.status(403).json({ error: 'Cross-origin request blocked' });
      return;
    }
  }
  next();
});

app.use('/api/auth', authRouter);

// Everything below is internal and requires a session.
app.use('/api', (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in' });
    return;
  }
  if (req.method !== 'GET' && req.user.role === 'viewer') {
    res.status(403).json({ error: 'Read-only account — no changes allowed' });
    return;
  }
  next();
});

app.use('/api/meta', metaRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/customers', customersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api', catalogRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api', procurementRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api', productionRouter);
app.use('/api/shipments', shipmentsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/uploads', uploadsRouter);

// Serve uploads static
app.use('/uploads', (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in' });
    return;
  }
  next();
});
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h', dotfiles: 'deny', index: false }));

const distDir = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: 'index.html' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }
  const message = (error as Error)?.message ?? 'Unexpected server error';
  if (message.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'That record already exists (duplicate value)' });
    return;
  }
  console.error('[error]', error);
  res.status(500).json({ error: message });
});

// Some hosting shells inject PORT=0 meaning "pick a port". Cold Post needs a
// stable local port for the Vite proxy, so fall back to 4100 in that case.
const port = Number(process.env.PORT) || 4100;
app.listen(port, () => {
  console.log(`Cold Post running on http://localhost:${port}${fs.existsSync(distDir) ? '' : ' (API only — start Vite for the UI)'}`);
});