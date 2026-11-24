import { get } from '../db.js';

/**
 * Supabase Auth bridge.
 *
 * Production authentication is handled by Supabase Auth. The browser sends the
 * Supabase access token as `Authorization: Bearer <token>`; this module verifies
 * that token with Supabase and resolves the matching `users` row, which is the
 * authoritative source for the application role (admin / ops / viewer).
 *
 * Nothing here trusts an email or role supplied by the browser: the email comes
 * from Supabase's verified user endpoint and the role always comes from the
 * database row.
 *
 * When DATABASE_URL is set the identity lookup reads Supabase PostgreSQL (the
 * `public.users` table kept in sync by the auth trigger). Otherwise it falls
 * back to the local SQLite database so offline development still works.
 */

export type LocalUser = { id: number; name: string; email: string; role: 'admin' | 'ops' | 'viewer'; active: number };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');

// Server-side only. The publishable/anon key is preferred for user-token
// verification; the secret key is accepted as a fallback because Supabase
// requires *some* valid project key on the apikey header.
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  '';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

export const supabaseAuthEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

let pool: import('pg').Pool | null = null;

async function pgIdentity(email: string): Promise<LocalUser | null> {
  if (!pool) {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  }
  const { rows } = await pool.query<{ id: number; name: string; email: string; role: LocalUser['role']; active: boolean }>(
    'SELECT id, name, email, role, active FROM public.users WHERE lower(email) = lower($1) AND active',
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active ? 1 : 0 };
}

export function bearerToken(req: { headers: Record<string, unknown> }): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/** Verifies a Supabase access token and returns the verified identity. */
export async function verifySupabaseToken(token: string): Promise<{ id: string; email: string } | null> {
  if (!supabaseAuthEnabled) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { id?: string; email?: string; email_confirmed_at?: string };
    if (!data?.id || !data?.email) return null;
    return { id: data.id, email: data.email };
  } catch {
    return null;
  }
}

/** Looks up the local permission record for a verified Supabase email. */
export async function localUserForEmail(email: string): Promise<LocalUser | null> {
  if (DATABASE_URL) {
    try {
      const row = await pgIdentity(email);
      if (row) return row;
    } catch (error) {
      console.error('[auth] PostgreSQL identity lookup failed:', (error as Error).message);
    }
  }
  return (
    get<LocalUser>('SELECT id, name, email, role, active FROM users WHERE lower(email) = lower(?) AND active = 1', email) ?? null
  );
}
