# Cold Post — operations app

Internal operations system for a physical campaign studio: orders, recipients, BOM,
procurement, inventory, production, QC, dispatch, WhatsApp communication, costing
and reporting — with a multi-city store and supplier network on top.

Everything works in **Manual mode** with no API keys. **API mode** is available for
couriers and WhatsApp once you configure a provider, and every unconfigured provider
reports `NOT CONNECTED` rather than pretending an action succeeded.

---

## Stack

| Layer | Choice |
| --- | --- |
| Server | Node.js 22.5+ (built-in `node:sqlite`), Express 4, Zod |
| Database | SQLite in `data/` with SQL migrations and WAL |
| Web | React 18 + Vite, hand-rolled CSS/SVG charts |
| Auth | scrypt password hashes, hashed session tokens, httpOnly cookie |
| Secrets | AES-256-GCM encryption at rest for provider credentials |

No Python, native addons or external services are required.

## Quick start

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev                 # API :4100 + Vite :5173
```

Open <http://localhost:5173>.

On first boot the app applies migrations, creates the admin user from `.env`, seeds
message/campaign templates and (with `SEED_DEMO=true`) a small demo dataset marked
`demo=1`:

- 3 cities, 6 stores/warehouses, 3 suppliers, 13 catalogue products with per-city offers
- 2 demo customers and 2 demo orders (`CP-2026-0001` confirmed, `CP-2026-0002` delivered)

**Default admin:** `admin@coldpost.in` / `Coldpost@2026` — change it in
**Settings → Users → Change my password** immediately. New users are created there too
(Admin / Operations / Read-only).

Set `SEED_DEMO=false` before the first boot to start with an empty catalogue.

### Production

```bash
npm run build      # typecheck + build web/dist
NODE_ENV=production COOKIE_SECURE=true npm start
```

The single server serves the API, uploaded files and `web/dist` on `PORT` (default
4100). Put it behind HTTPS (Caddy, nginx or a PaaS) and keep `DATA_DIR` on a persistent
volume. Uploaded files live in `DATA_DIR/uploads`; back up the whole `DATA_DIR`
(`coldpost.db` plus uploads) — that is the entire application state.

## Operating modes

**Settings → Operating mode**

- **Manual** — enter courier + AWB by hand, update tracking status as the courier
  reports, prepare WhatsApp messages and confirm you sent them. QC, stock and costing
  behave identically.
- **API** — shipments can be booked through the configured shipping provider, tracking
  can be refreshed from the tracking provider, and WhatsApp messages can be sent through
  Meta Cloud API.

Switching modes never deletes data, books historic shipments or resends messages. The
switch endpoint returns `unchanged: true` only after comparing row counts before and
after. Test mode is available per provider and never produces a real booking.

## Modules

- **Dashboard** — live pipeline, overdue dispatch, procurement warnings, QC queue, cash.
- **Orders** — reference `CP-YYYY-NNNN`, quotation → confirmed workflow with guarded
  transitions, BOM (template-generated or manual, snapshotted on confirmation),
  recipients/packages, costs, activity log.
- **Production** — work orders per package, assigned assembler, checklists, assembly
  photos, QC queue. QC pass requires every checklist item and a QC photo; failure sends
  the package to rework.
- **Products** — central catalogue with city/store offers, pricing and stock visibility.
- **Inventory** — location-wise stock, reserve/release/consume/adjust/receive/transfer
  with a full movement ledger and low-stock reporting.
- **Procurement** — purchase orders with partial receiving and rejection, payment
  tracking, advance-requirement warning with an audited override reason.
- **Suppliers** — contacts, city, lead time, products and purchase history.
- **Shipments** — manual or API booking, AWB, tracking events, delivery, API log.
- **Customers** — companies, contacts, orders, feedback and activity.
- **Reports** — 12 operational/financial reports with date filters and CSV export.
- **Settings** — business profile, currency/numbering, tax and costing defaults,
  QC checklist, campaign templates, WhatsApp templates, integrations, users, audit.
- **Cities & stores** — dynamic cities, stores (retail, wholesale, packaging, printing,
  warehouse, storage, fulfilment hub), central catalogue with per-city offers and
  inter-city stock transfers.

## API integration

**Settings → Integrations & API.** Credentials are encrypted before storage and are
never returned to the browser; the API only reports whether a secret is set.

### Shipping and tracking

No courier is bundled. The adapter is a generic REST connector: set the base URL, the
create-shipment and tracking paths, auth header/token and the field names your courier
expects. Booking requires an explicit `confirm: true` from the UI; failures are logged
with HTTP status and message in the API log. If you need a specific courier's contract
API, implement it in `server/providers/restShipping.ts` / `restTracking.ts` — the service,
logging and UI layers stay the same.

### WhatsApp (Meta Cloud API)

Requires a Meta app with WhatsApp Business, a phone number id and an access token.
Without them, `send` fails honestly with `NOT CONNECTED` and logs the attempt; manual
copy/prepare/mark-sent always works.

Message sending is idempotent: a message already marked sent cannot be sent again.
Booking is likewise blocked once an AWB exists.

## Security

- Server-side session checks on every `/api` route; roles enforced on the server
  (viewer accounts are read-only, admin-only settings/users/providers).
- Cross-origin mutations are rejected; cookies are httpOnly and `SameSite=Lax`,
  `Secure` when `COOKIE_SECURE=true`.
- Zod validation on every write; parameterised SQL throughout.
- Uploads limited to images, PDF and short video, 25 MB, authenticated download route.
- Audit log for all meaningful actions, including manual overrides and mode switches.

## Tests

With the server running:

```bash
npm test
```

The acceptance suite creates a customer, order, five packages, a template BOM, work
orders, assembly photos, a failed and a passed QC, a manual shipment through delivery,
a WhatsApp message, a purchase order with advance override and partial receiving, a
stock transfer, feedback, costing, reports/CSV, mode switching with provider refusal,
viewer permissions and audit persistence. It exits non-zero on the first failure.
Add `TEST_BASE=http://host:port` to point at another instance.

## Project layout

```
server/
  index.ts            app wiring, auth gate, uploads, SPA fallback
  db.ts               SQLite connection, migrations, re-entrant tx()
  migrations/         SQL schema (001_init.sql)
  lib/                auth, orders, inventory, costing, numbering, statuses, settings
  providers/          provider descriptors, generic REST shipping/tracking, WhatsApp
  routes/             one router per module
web/src/
  pages/              screens, including order tabs/
  components/         UI kit, charts, shipment/production modals
scripts/acceptance.ts end-to-end acceptance suite
```

## Known limitations

- No courier is pre-integrated: shipping/tracking need your contract API details.
- WhatsApp templates must be approved in Meta before API sends work in production.
- Reports are computed live; there is no scheduled email delivery.
- Single-tenant: one studio per installation (multiple users and cities are supported).
- The SQLite database is suitable for a studio's volume; very high write concurrency
  would call for PostgreSQL.

---

## Production deployment

### Architecture

| Layer | Provider | Notes |
| --- | --- | --- |
| Source of truth | GitHub `T5023P/coldpost`, branch `main` | Must be a **private** repository |
| Frontend | Cloudflare Pages, project `coldpost` | `web/dist` build output, domain `coldpost.delivery` |
| Backend | Render (Node.js Express) | `npm run build` then `npm start`, binds `process.env.PORT` |
| Database | Supabase PostgreSQL | Session-pooler connection string in `DATABASE_URL` |
| Auth | Supabase Auth | Access token verified server-side; role comes from `public.users` |
| Storage | Supabase Storage | Buckets `coldpost-products`, `coldpost-assemblies`, `coldpost-attachments` (all private) |

### Local development (unchanged)

```bash
npm install
npm run dev          # API on :4100, Vite on :5173
npm test             # 29 acceptance checks against a running API
```

With `DATABASE_URL` unset the app uses local SQLite in `data/`. Login uses the
cookie session created by `server/routes/auth.ts` and the seeded admin account.

### Production authentication

When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, the frontend signs in with
`supabase.auth.signInWithPassword` and sends the access token as
`Authorization: Bearer <token>`. The API verifies that token against Supabase's
`/auth/v1/user` endpoint and then resolves the role from the local `users` row
matched by email. Browser-supplied emails and roles are never trusted.

`public.profiles` mirrors `auth.users` and defaults every new account to
`viewer`. Promotion is an explicit server-side action:

```sql
UPDATE public.profiles SET role = 'admin' WHERE lower(email) = lower('you@example.com');
SELECT public.mirror_profile_to_users(id) FROM public.profiles WHERE lower(email) = lower('you@example.com');
```

### Database migrations

Two separate sets, deliberately:

- `server/migrations/*.sql` — SQLite, applied by `server/db.ts` in development.
- `server/migrations/pg/*.sql` — PostgreSQL, applied to Supabase in filename order.

The PostgreSQL files were moved into their own directory because the SQLite
runner executes every `*.sql` file in its directory and aborted on PostgreSQL DDL.

Do not point the acceptance suite at the production database; run it against a
staging project or local SQLite.

### Required production environment variables

`DATABASE_URL`, `APP_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server only), `NODE_ENV=production`,
`COOKIE_SECURE=true`, `SEED_DEMO=false`, plus `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as Cloudflare Pages build variables.

Secrets live in the host's encrypted environment settings. `.env` is gitignored;
`.env.example` contains placeholders only.

### Known gap

`server/db.pg.ts` is not yet a working PostgreSQL adapter: it still uses `?`
placeholders and its `tx()` helper does not open a transaction, and the route
layer imports the SQLite module directly. PostgreSQL production mode therefore
requires that adapter to be completed and tested before the API can be pointed at
Supabase.
