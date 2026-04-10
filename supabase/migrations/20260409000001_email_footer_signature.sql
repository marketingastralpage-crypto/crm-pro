-- Email footer signature settings + public asset bucket
ALTER TABLE public.smtp_settings
  ADD COLUMN IF NOT EXISTS footer_company_name           TEXT,
  ADD COLUMN IF NOT EXISTS footer_address                TEXT,
  ADD COLUMN IF NOT EXISTS footer_vat_number             TEXT,
  ADD COLUMN IF NOT EXISTS footer_phone                  TEXT,
  ADD COLUMN IF NOT EXISTS footer_social_facebook_url    TEXT,
  ADD COLUMN IF NOT EXISTS footer_social_instagram_url   TEXT,
  ADD COLUMN IF NOT EXISTS footer_social_linkedin_url    TEXT,
  ADD COLUMN IF NOT EXISTS footer_social_tiktok_url      TEXT,
  ADD COLUMN IF NOT EXISTS footer_lia_url                TEXT,
  ADD COLUMN IF NOT EXISTS footer_unsubscribe_url        TEXT,
  ADD COLUMN IF NOT EXISTS footer_privacy_url            TEXT,
  ADD COLUMN IF NOT EXISTS footer_logo_path              TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Users can view own email assets" ON storage.objects;
CREATE POLICY "Users can view own email assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'email-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can upload own email assets" ON storage.objects;
CREATE POLICY "Users can upload own email assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'email-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own email assets" ON storage.objects;
CREATE POLICY "Users can update own email assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'email-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'email-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own email assets" ON storage.objects;
CREATE POLICY "Users can delete own email assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'email-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
