-- Push subscription endpoints (one per device/browser per user)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT        NOT NULL UNIQUE,
  p256dh      TEXT        NOT NULL,
  auth        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions USING (user_id = auth.uid());

-- Pending push notifications to be delivered server-side
CREATE TABLE IF NOT EXISTS push_queue (
  id          TEXT        PRIMARY KEY,  -- same as client notif id (ev_xxx, act_xxx)
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  fire_at     TIMESTAMPTZ NOT NULL,
  sent        BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push queue"
  ON push_queue USING (user_id = auth.uid());

-- Index for the cron query: unsent notifications that are due
CREATE INDEX IF NOT EXISTS push_queue_unsent ON push_queue (fire_at) WHERE sent = FALSE;
