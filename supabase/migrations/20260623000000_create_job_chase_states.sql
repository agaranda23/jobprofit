-- Creates per-job chase state table for cloud-synced chase tracking.
-- Replaces the localStorage-only approach so state survives device changes / reinstalls.
-- The localStorage layer is kept as the instant-feedback + offline fallback.
--
-- Manual apply: paste this into Supabase Studio → SQL Editor and run it.
-- See supabase/migrations/APPLIED.md for the ledger.

create table if not exists job_chase_states (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users on delete cascade,
  job_id           uuid        not null,
  chase_count      int         not null default 1,
  last_chased_at   timestamptz not null,
  first_chased_at  timestamptz not null,
  unique (user_id, job_id)
);

-- RLS
alter table job_chase_states enable row level security;

create policy "owner select"
  on job_chase_states for select
  using (auth.uid() = user_id);

create policy "owner insert"
  on job_chase_states for insert
  with check (auth.uid() = user_id);

create policy "owner update"
  on job_chase_states for update
  using (auth.uid() = user_id);

create policy "owner delete"
  on job_chase_states for delete
  using (auth.uid() = user_id);
