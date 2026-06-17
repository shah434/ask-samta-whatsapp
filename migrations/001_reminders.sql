-- Migration 001 — reminder feature columns
-- Run in the Supabase SQL editor (or psql) BEFORE deploying the reminder code.
-- Both columns are additive and nullable; existing rows are unaffected.

-- Queue of scheduled reminders for a user. Each element:
--   { type, day, send_at, sun_time, display, city, sent }
-- The reminder cron reads this; the sunset flow appends to it on a user "yes".
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS scheduled_reminders JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Last inbound message time. The cron gates sends to the open 24h WhatsApp
-- session window using this — a reminder must never fire into a closed session.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- Optional but recommended once user count grows: lets the cron find rows with
-- due reminders without a full-table scan. Safe to add now.
-- CREATE INDEX IF NOT EXISTS idx_users_scheduled_reminders
--   ON users USING gin (scheduled_reminders);
