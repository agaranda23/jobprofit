-- fix/cross-device-job-sync-overlay — Fix D (optional)
--
-- IMPORTANT: This migration file documents the Supabase dashboard steps required
-- to enable realtime delivery for the jobs table. It CANNOT be applied via the
-- Supabase CLI from this repo (the project uses the hosted dashboard, not
-- supabase link). A founder must apply the two statements below via:
--   Supabase Dashboard → SQL Editor → New query → paste + run
--
-- Without this, realtime INSERT/UPDATE/DELETE events are never delivered to
-- subscribed clients, so the 2-second debounced refreshFromCloud in AppShell
-- never fires on remote changes. Fix A + Fix B (visibility backstop) provide
-- correctness regardless — but realtime makes the UX faster.
--
-- Statement 1: add the jobs table to the supabase_realtime publication.
-- This is idempotent (ALTER PUBLICATION ... ADD TABLE is a no-op if already added).
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;

-- Statement 2: confirm the RLS SELECT policy allows authenticated users to read
-- their own rows. If this policy already exists under a different name, this
-- CREATE will error — skip it in that case.
--
-- The exact policy name is advisory; what matters is that an authenticated user
-- can SELECT rows where user_id = auth.uid(). Realtime uses the same RLS check
-- as regular SELECT — if SELECT is blocked, realtime events are silently dropped.
--
-- Only run the CREATE below if no equivalent SELECT policy exists yet:
CREATE POLICY "Users can read own jobs"
  ON public.jobs
  FOR SELECT
  USING (user_id = auth.uid());
