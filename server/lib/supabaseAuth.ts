import { get } from '../db.js';

/**
 * Supabase Auth bridge.
 *
 * Production authentication is handled by Supabase Auth. The browser sends the
 * Supabase access token as `Authorization: Bearer <token>`; this module verifies
 * that token with Supabase and resolves the matching local `users` row, which is
 * the authoritative source for the application role (admin / ops / viewer).
 *
 * Nothing here trusts an email or role supplied by the browser: the email comes
 * from Supabase's verified user endpoint and the role always comes from the
 * database row.
 */

export type LocalUser = { id: number; name: string; email: string; role: 'admin' | 'ops' | 'viewer'; active: number };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '';

export const supabaseAuthEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON);

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
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
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
export function localUserForEmail(email: string): LocalUser | null {
  return (
    get<LocalUser>(
      'SELECT id, name, email, role, active FROM users WHERE lower(email) = lower(?) AND active = 1',
      email,
    ) ?? null
  );
}
