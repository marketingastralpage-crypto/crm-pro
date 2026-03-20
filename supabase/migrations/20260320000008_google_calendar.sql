-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Google Calendar integration tables
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Token storage (one row per CRM user)
CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    BIGINT,   -- Unix ms timestamp
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own calendar tokens"
  ON public.google_calendar_tokens FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 2. Local event cache
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_event_id TEXT,
  title           TEXT NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ,
  guests          TEXT[],
  color           TEXT DEFAULT '#7c5ef0',
  notes           TEXT,
  contact_id      TEXT REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own calendar events"
  ON public.calendar_events FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Index for fast date-range queries
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start
  ON public.calendar_events (user_id, start_time);
