-- Migration 002 — strictness ask counter
-- Run in the Supabase SQL editor (or psql) BEFORE deploying the updated
-- strictness-ask logic. Additive and non-null with a default; existing rows
-- backfill to 0 automatically and are otherwise unaffected.

-- How many times we've appended the "what's your strictness?" question to this
-- user. The reactive ask (rebuild-food.js) gates on this so we stop after
-- STRICTNESS_ASK_MAX (3) lifetime asks instead of nagging on every food query.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS strictness_ask_count INT NOT NULL DEFAULT 0;
