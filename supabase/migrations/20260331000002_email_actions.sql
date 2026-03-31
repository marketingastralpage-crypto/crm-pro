-- Add action columns to emails table
ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS starred    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS spam       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Indexes for virtual folder queries
CREATE INDEX IF NOT EXISTS idx_emails_user_starred  ON emails(user_id, starred,  date DESC) WHERE starred  = TRUE;
CREATE INDEX IF NOT EXISTS idx_emails_user_archived ON emails(user_id, archived, date DESC) WHERE archived = TRUE;
CREATE INDEX IF NOT EXISTS idx_emails_user_spam     ON emails(user_id, spam,     date DESC) WHERE spam     = TRUE;
CREATE INDEX IF NOT EXISTS idx_emails_user_deleted  ON emails(user_id, deleted_at)           WHERE deleted_at IS NOT NULL;

-- Add configurable IMAP folder names for archive / trash / spam
ALTER TABLE smtp_settings
  ADD COLUMN IF NOT EXISTS imap_archive_folder TEXT DEFAULT 'Archive',
  ADD COLUMN IF NOT EXISTS imap_trash_folder   TEXT DEFAULT 'Trash',
  ADD COLUMN IF NOT EXISTS imap_spam_folder    TEXT DEFAULT 'Junk';
