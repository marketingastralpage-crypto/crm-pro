-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Isolate contacts per user
-- Adds user_id column, fixes RLS policies, cleans shared data.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Delete all existing shared contacts (clean slate)
DELETE FROM public.contacts;

-- 2. Add user_id column linked to auth.users
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Make user_id NOT NULL (after backfill — table is now empty so this is safe)
ALTER TABLE public.contacts
  ALTER COLUMN user_id SET NOT NULL;

-- 4. Fix RLS: drop old permissive policy and create per-user policies
DROP POLICY IF EXISTS "Authenticated users can manage contacts" ON public.contacts;

CREATE POLICY "Users can view own contacts"
  ON public.contacts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own contacts"
  ON public.contacts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own contacts"
  ON public.contacts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own contacts"
  ON public.contacts FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
