-- Allow client-generated UUIDs for jobs.
--
-- Before this migration, jobs.id had no server-side DEFAULT, so the database
-- assigned UUIDs on insert. We now set gen_random_uuid() as the default so
-- clients can also supply their own UUID in the insert payload — enabling the
-- offline queue to write a deterministic ID before the row reaches Supabase.
--
-- Existing rows are unaffected. The dual-ID compatibility layer in store.js
-- (cloudId / id fields) is intentionally preserved — cleanup is a separate PR.

ALTER TABLE jobs
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
