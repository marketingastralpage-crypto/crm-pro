-- Add imap_sent_folder to smtp_settings
-- Different mail providers use different folder names for sent mail:
-- Gmail: "[Gmail]/Sent Mail", Outlook: "Sent Items", standard: "Sent"
ALTER TABLE public.smtp_settings
  ADD COLUMN IF NOT EXISTS imap_sent_folder TEXT DEFAULT 'Sent';
