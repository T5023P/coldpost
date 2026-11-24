-- Supabase Auth integration.
--
-- Production authentication is Supabase Auth (auth.users). This migration adds:
--   1. public.profiles — the application profile linked to auth.users by UUID.
--   2. RLS so a signed-in user may read only their own profile.
--   3. A bridge that mirrors profiles into public.users, because the existing
--      business schema (audit_logs.user_id, orders.created_by, ...) references
--      public.users(id) as an integer. The bridge keeps every existing foreign
--      key and audit trail working without a destructive rewrite.
--
-- New accounts get the least-privilege role 'viewer'. Promotion to admin/ops is
-- an explicit, server-side action — never something a client can request.

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  full_name  text,
  role       text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'ops', 'viewer')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_key ON public.profiles (lower(email));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- No INSERT/UPDATE/DELETE policies: profile writes require the service role.

-- The existing app keys users by integer id; make email the join point.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON public.users (lower(email));

CREATE OR REPLACE FUNCTION public.mirror_profile_to_users(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.users (name, email, password_hash, role, active)
  VALUES (
    COALESCE(p.full_name, p.email),
    p.email,
    '!supabase-auth',      -- no local password; sign-in happens via Supabase Auth
    p.role::role_enum,
    p.is_active
  )
  ON CONFLICT (lower(email)) DO UPDATE
    SET name = EXCLUDED.name,
        role = EXCLUDED.role,
        active = EXCLUDED.active,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  PERFORM public.mirror_profile_to_users(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill for accounts that already exist in Supabase Auth.
INSERT INTO public.profiles (id, email, full_name)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'full_name', u.email)
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;

SELECT public.mirror_profile_to_users(id) FROM public.profiles;
