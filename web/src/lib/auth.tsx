import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { supabase, supabaseEnabled } from './supabase';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'ops' | 'viewer';
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User | null }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setUser(null);
    window.addEventListener('cp:unauthorized', onUnauthorized);

    // Session restoration after refresh: Supabase keeps the session in storage,
    // re-read it and re-resolve the server-controlled profile.
    let unsubscribe: (() => void) | undefined;
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) refresh();
      });
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) setUser(null);
        else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') refresh();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }

    return () => {
      window.removeEventListener('cp:unauthorized', onUnauthorized);
      unsubscribe?.();
    };
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (supabaseEnabled && supabase) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        // The role always comes from the server-side profile, never the browser.
        const data = await api<{ user: User | null }>('/auth/me');
        if (!data.user) {
          await supabase.auth.signOut().catch(() => undefined);
          throw new Error('This account has no Cold Post profile. Ask an administrator to grant access.');
        }
        setUser(data.user);
        return;
      }
      const data = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut().catch(() => undefined);
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
