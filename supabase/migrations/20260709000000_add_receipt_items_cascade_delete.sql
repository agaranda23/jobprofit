-- Migration: add ON DELETE CASCADE from receipt_items to receipts
-- Date: 2026-07-09
-- Branch: fix/receipt-delete-cascade
--
-- PURPOSE
-- -------
-- receipts and receipt_items were created via the Supabase dashboard, not a
-- migration file (see 20260520213419_add_meta_column_to_jobs_and_receipts_rls.sql
-- and the deletion-order comment in netlify/functions/delete-account.js).
-- No migration has ever declared the receipt_items.receipt_id foreign key, so
-- we cannot assume it currently has ON DELETE CASCADE — deleting a single
-- receipt in-app (deleteReceiptFromCloud in src/lib/store.js) only removed
-- the parent receipts row, leaving receipt_items orphaned. Orphaned line
-- items silently skew VAT-reclaim totals and job cost/profit rollups (the
-- headline metric this app exists to protect).
--
-- The application-code half of this fix (explicit receipt_items delete
-- before the receipts delete) shipped in the same PR as this migration, so
-- correctness does not depend on this migration being applied. This
-- migration is the belt-and-braces schema fix: any receipt_items rows
-- orphaned by a future code path (or a direct SQL delete) are still cleaned
-- up by the database itself.
--
-- WHAT THIS DOES
-- --------------
-- 1. Deletes any receipt_items rows that are ALREADY orphaned (receipt_id
--    pointing at a receipts row that no longer exists) — a no-op if there are
--    none, but required so step 2 doesn't fail with a FK violation on
--    pre-existing orphans.
-- 2. Finds whatever FK constraint (if any) currently exists on
--    receipt_items.receipt_id -> receipts.id and, if it isn't already
--    ON DELETE CASCADE, drops and recreates it as
--    receipt_items_receipt_id_fkey ... ON DELETE CASCADE.
--
-- IDEMPOTENCY
-- -----------
-- Safe to re-run: if the constraint already exists with CASCADE, the DO
-- block detects that and does nothing. The orphan cleanup DELETE is a no-op
-- once orphans are gone.
--
-- RUN ORDER
-- ---------
-- Run in the Supabase SQL editor. No superuser role required.
--
-- ROLLBACK
-- --------
-- See the ROLLBACK block at the bottom (commented out).

BEGIN;

-- ─── 1. Clean up any pre-existing orphans ────────────────────────────────────
-- Without this, step 2's ADD CONSTRAINT would fail with a foreign key
-- violation if any receipt was ever deleted before this fix shipped.
DELETE FROM public.receipt_items ri
WHERE NOT EXISTS (
  SELECT 1 FROM public.receipts r WHERE r.id = ri.receipt_id
);

-- ─── 2. Ensure receipt_items.receipt_id has an ON DELETE CASCADE FK ──────────
DO $$
DECLARE
  existing_constraint text;
  existing_delete_rule text;
BEGIN
  SELECT tc.constraint_name, rc.delete_rule
    INTO existing_constraint, existing_delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'receipt_items'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'receipt_id'
  LIMIT 1;

  -- Already correct — nothing to do.
  IF existing_constraint IS NOT NULL AND existing_delete_rule = 'CASCADE' THEN
    RETURN;
  END IF;

  -- Drop whatever FK currently sits on this column (any name) so we can
  -- recreate it with the CASCADE rule.
  IF existing_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.receipt_items DROP CONSTRAINT %I',
      existing_constraint
    );
  END IF;

  ALTER TABLE public.receipt_items
    ADD CONSTRAINT receipt_items_receipt_id_fkey
      FOREIGN KEY (receipt_id) REFERENCES public.receipts(id) ON DELETE CASCADE;
END $$;

COMMIT;

-- ─── ROLLBACK (do not run unless reverting) ──────────────────────────────────
--
-- BEGIN;
--
-- ALTER TABLE public.receipt_items
--   DROP CONSTRAINT IF EXISTS receipt_items_receipt_id_fkey;
--
-- -- Note: this does NOT restore whatever FK (if any) existed before this
-- -- migration ran — that constraint's name/rule was never recorded anywhere.
-- -- If you need the pre-migration state back, recreate it manually.
--
-- COMMIT;
