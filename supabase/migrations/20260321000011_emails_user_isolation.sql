-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Isolate emails per user
-- CRITICAL FIX: Previously all authenticated users shared the same inbox.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Delete all existing shared emails (clean slate)
DELETE FROM public.emails;

-- 2. Add user_id column linked to auth.users
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Make user_id NOT NULL
ALTER TABLE public.emails
  ALTER COLUMN user_id SET NOT NULL;

-- 4. Drop old unique constraint on message_id alone (now uniqueness is per user)
ALTER TABLE public.emails
  DROP CONSTRAINT IF EXISTS emails_message_id_key;

-- 5. Add composite unique constraint: (user_id, message_id)
ALTER TABLE public.emails
  ADD CONSTRAINT emails_user_id_message_id_key UNIQUE (user_id, message_id);

-- 6. Fix RLS: drop old permissive policy and create per-user policy
DROP POLICY IF EXISTS "Authenticated users can manage emails" ON public.emails;

CREATE POLICY "Users manage own emails"
  ON public.emails FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
