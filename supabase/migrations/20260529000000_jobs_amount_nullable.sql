-- Make jobs.amount nullable with no default so a Lead job can be saved
-- without a price ("No price yet" state). Both ops are safe no-ops if the
-- column is already nullable / already has no default.
ALTER TABLE public.jobs ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE public.jobs ALTER COLUMN amount DROP DEFAULT;
