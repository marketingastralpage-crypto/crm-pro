-- Add sender profile fields to smtp_settings for campaign email signatures
ALTER TABLE public.smtp_settings
  ADD COLUMN IF NOT EXISTS mittente_nome TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS mittente_cognome TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS mittente_ruolo TEXT DEFAULT '';
