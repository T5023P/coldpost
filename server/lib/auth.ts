import type { NextFunction, Request, Response } from 'express';
import { get, run } from '../db.js';
import { randomToken, sha256, verifyPassword } from './crypto.js';
import { bearerToken, localUserForEmail, supabaseAuthEnabled, verifySupabaseToken } from './supabaseAuth.js';

export type Role = 'admin' | 'ops' | 'viewer';
export type AuthedUser = { id: number; name: string; email: string; role: Role; active: number };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export const COOKIE_NAME = 'cp_session';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionTokenFromRequest(req: Request): string | null {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] ?? null;
}

export function createSession(userId: number): string {
  const token = randomToken(32);
  const days = Number(process.env.SESSION_DAYS ?? 14) || 14;
  const expires = new Date(Date.now() + days * 86400_000).toISOString();
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  return token;
}

export function destroySession(token: string | null) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function userFromToken(token: string | null): AuthedUser | null {
  if (!token) return null;
  const row = get<AuthedUser>(
    `SELECT u.id, u.name, u.email, u.role, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`,
    sha256(token),
  );
  return row ?? null;
}

export function attemptLogin(email: string, password: string): AuthedUser | null {
  const row = get<AuthedUser & { password_hash: string }>(
    'SELECT id, name, email, role, active, password_hash FROM users WHERE lower(email) = lower(?)',
    email,
  );
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", row.id);
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active };
}

export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  // Local cookie sessions keep SQLite development mode working unchanged.
  const cookieUser = userFromToken(sessionTokenFromRequest(req));
  if (cookieUser) {
    req.user = cookieUser;
    return next();
  }

  // Production: verify the Supabase access token and take the role from the
  // server-side user record. A browser-supplied role or email is never trusted.
  if (supabaseAuthEnabled) {
    const token = bearerToken(req);
    if (token) {
      const identity = await verifySupabaseToken(token);
      if (identity) {
        const local = await localUserForEmail(identity.email);
        if (local) req.user = local;
      }
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Your role does not allow this action' });
    next();
  };
}

/** Any role except viewer may mutate data. */
export function requireWrite(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'Read-only account — no changes allowed' });
  next();
}

export function setSessionCookie(res: Response, token: string) {
  const days = Number(process.env.SESSION_DAYS ?? 14) || 14;
  const secure = process.env.COOKIE_SECURE === 'true';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: days * 86400_000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}
