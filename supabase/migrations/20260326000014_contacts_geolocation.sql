-- Add geolocation address fields to contacts table
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS via       TEXT,
  ADD COLUMN IF NOT EXISTS citta     TEXT,
  ADD COLUMN IF NOT EXISTS provincia TEXT,
  ADD COLUMN IF NOT EXISTS stato     TEXT;
