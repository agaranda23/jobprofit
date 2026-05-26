BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_voice_lang text NOT NULL DEFAULT 'en-GB';

COMMIT;

-- Rollback: ALTER TABLE public.profiles DROP COLUMN preferred_voice_lang;
--
-- RLS note: existing policies on public.profiles cover all columns via row-level
-- grants — no policy changes needed. Users can only read/write their own row.
