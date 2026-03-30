-- Email sync jobs: tracks background sync progress per user/folder
CREATE TABLE IF NOT EXISTS email_sync_jobs (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder           TEXT        NOT NULL DEFAULT 'INBOX',
  status           TEXT        NOT NULL DEFAULT 'running',  -- running | completed | stopped | error
  total_messages   INT         NOT NULL DEFAULT 0,
  synced_messages  INT         NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  error_msg        TEXT
);

ALTER TABLE email_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sync jobs"
  ON email_sync_jobs FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX ON email_sync_jobs (user_id, status, started_at DESC);
