-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Outlook Calendar integration tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Token storage for Outlook/Microsoft 365 (one row per CRM user)
CREATE TABLE IF NOT EXISTS public.outlook_calendar_tokens (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    BIGINT,   -- Unix ms timestamp
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.outlook_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own outlook calendar tokens"
  ON public.outlook_calendar_tokens FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. Add outlook_event_id column to calendar_events (for Outlook-synced events)
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS outlook_event_id TEXT;
