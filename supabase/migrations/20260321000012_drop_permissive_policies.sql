-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Remove catch-all permissive RLS policies
-- CRITICAL FIX: These policies had USING (true) which overrode all per-user
-- isolation policies (PERMISSIVE policies are OR'd in PostgreSQL).
-- ─────────────────────────────────────────────────────────────────────────────

-- These were created manually in the Supabase dashboard and were silently
-- granting every authenticated user access to ALL rows in these tables.

DROP POLICY IF EXISTS "public access" ON public.contacts;
DROP POLICY IF EXISTS "allow all" ON public.smtp_settings;
