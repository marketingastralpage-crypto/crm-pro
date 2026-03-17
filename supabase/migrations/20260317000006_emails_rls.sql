-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: RLS policies for emails table
-- Emails come from a shared IMAP account, so all authenticated users can
-- read and write all emails (no per-user isolation needed here).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage emails" ON public.emails;
CREATE POLICY "Authenticated users can manage emails"
  ON public.emails
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
