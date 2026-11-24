import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Only the publishable/anon key belongs in the browser bundle.
// The service-role key must never be shipped to the frontend.
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

const url = (env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const supabaseEnabled = Boolean(supabase);
