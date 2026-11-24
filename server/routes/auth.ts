import { Router } from 'express';
import { z } from 'zod';
import { attemptLogin, clearSessionCookie, createSession, destroySession, sessionTokenFromRequest, setSessionCookie } from '../lib/auth.js';
import { asyncHandler, parse } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { get, run } from '../db.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler((req, res) => {
    const body = parse(z.object({ email: z.string().min(3), password: z.string().min(1) }), req.body);
    const user = attemptLogin(body.email, body.password);
    if (!user) {
      res.status(401).json({ error: 'Incorrect email or password' });
      return;
    }
    const token = createSession(user.id);
    setSessionCookie(res, token);
    logAudit({ userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, entityLabel: user.email });
    res.json({ user });
  }),
);

authRouter.post('/logout', (req, res) => {
  const token = sessionTokenFromRequest(req);
  destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post(
  '/change-password',
  asyncHandler((req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    const body = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'Use at least 8 characters') }),
      req.body,
    );
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!row || !verifyPassword(body.currentPassword, row.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }
    run('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', hashPassword(body.newPassword), req.user.id);
    logAudit({ userId: req.user.id, action: 'auth.password-change', entityType: 'user', entityId: req.user.id });
    res.json({ ok: true });
  }),
);
