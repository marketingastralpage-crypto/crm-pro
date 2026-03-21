-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Isolate smtp_settings per user
-- CRITICAL FIX: Previously all authenticated users shared the same settings.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Delete all existing shared settings (clean slate)
DELETE FROM public.smtp_settings;

-- 2. Add user_id column linked to auth.users
ALTER TABLE public.smtp_settings
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Make user_id NOT NULL
ALTER TABLE public.smtp_settings
  ALTER COLUMN user_id SET NOT NULL;

-- 4. Add unique constraint: one settings row per user
ALTER TABLE public.smtp_settings
  DROP CONSTRAINT IF EXISTS smtp_settings_user_id_key;
ALTER TABLE public.smtp_settings
  ADD CONSTRAINT smtp_settings_user_id_key UNIQUE (user_id);

-- 5. Fix RLS: drop old permissive policy and create per-user policy
DROP POLICY IF EXISTS "Authenticated users can manage smtp_settings" ON public.smtp_settings;

CREATE POLICY "Users manage own smtp_settings"
  ON public.smtp_settings FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
