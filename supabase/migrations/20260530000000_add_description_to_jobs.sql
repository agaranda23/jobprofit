-- Add jobs.description — one-line scope text for a job (Design A, spine block).
-- e.g. "Replace bathroom tiling and re-grout — 2 days"
-- Nullable with no default: existing jobs have no description until the user adds one.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS description text;
