-- Add meet_link column to calendar_events for storing Google Meet URLs
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS meet_link TEXT;
