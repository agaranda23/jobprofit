-- Add remind_job_costs preference column to profiles.
-- Column already exists in the live DB (deployed with feat/cost-capture-on-paid).
-- IF NOT EXISTS makes this safe to re-run against any environment.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS remind_job_costs boolean DEFAULT true;
