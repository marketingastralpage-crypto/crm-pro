-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Enable Row Level Security on all CRM tables
-- Only authenticated users can read/write their own data.
-- ─────────────────────────────────────────────────────────────────────────────

-- contacts table
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage contacts" ON public.contacts;
CREATE POLICY "Authenticated users can manage contacts"
  ON public.contacts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- smtp_settings table
ALTER TABLE public.smtp_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage smtp_settings" ON public.smtp_settings;
CREATE POLICY "Authenticated users can manage smtp_settings"
  ON public.smtp_settings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
