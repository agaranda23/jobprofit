# Migration ledger

**Single source of truth** for which migrations have been applied to the production Supabase project.

## Rule

Every time you paste a migration into Supabase Studio → SQL Editor, update the
`applied_to_prod` field in the table below **before** closing the tab.
Same-day update is required.

If a migration is intentionally deferred (waiting on a feature branch to
stabilise before going live), set `applied_to_prod: deferred` and add a
one-line note.

See [`supabase/MIGRATIONS.md`](../MIGRATIONS.md) for the full apply process,
the audit script, and the long-term `supabase db push` path.

---

## Applied status

| # | Filename | applied_to_prod | Notes |
|---|----------|-----------------|-------|
| 1 | `20260513_create_profiles_table.sql` | yes (2026-05-13) | Creates profiles table + handle_new_user trigger; supersedes earlier name-columns migration |
| 2 | `20260520213419_add_meta_column_to_jobs_and_receipts_rls.sql` | yes (2026-05-20) | Adds jobs.meta JSONB; codifies receipts + receipt_items RLS |
| 3 | `20260520223130_jobs_public_select_by_token.sql` | yes (2026-05-20) | Anon SELECT policy for public quote/invoice/receipt pages via token |
| 4 | `20260521000000_enable_realtime_on_jobs.sql` | yes (2026-05-21) | Enables Supabase Realtime on the jobs table |
| 5 | `20260524000000_add_push_subscriptions.sql` | yes (2026-05-24) | Creates push_subscriptions table for web push notifications |
| 6 | `20260526000000_add_preferred_voice_lang.sql` | yes (2026-05-26) | Adds preferred_voice_lang column to profiles |
| 7 | `20260529000000_jobs_amount_nullable.sql` | yes (2026-05-29) | Makes jobs.amount nullable + drops DEFAULT so Lead jobs can be saved without a price |
| 8 | `20260530000000_add_description_to_jobs.sql` | yes (2026-06-19) | Adds jobs.description (nullable text). **Was missing from prod — caused P0 on 2026-06-19. Applied that same day.** |
| 9 | `20260530100000_jobs_client_uuid_default.sql` | deferred | Sets jobs.id DEFAULT gen_random_uuid() for offline-queue deterministic IDs. Deferred — offline-queue PR not live in prod yet |
| 10 | `20260531000000_add_missing_profile_columns.sql` | yes (2026-05-31) | Profile sweep: adds plan, trial_ends_at, stripe_customer_id, VAT and trade columns |
| 11 | `20260531100000_add_weekly_digest_enabled.sql` | yes (2026-05-31) | Adds weekly_digest_enabled boolean to profiles |
| 12 | `20260531200000_add_cis_profile_columns.sql` | yes (2026-05-31) | Adds CIS (Construction Industry Scheme) columns to profiles |
| 13 | `20260531300000_add_stripe_connect_columns.sql` | yes (2026-05-31) | Adds Stripe Connect onboarding columns to profiles |
| 14 | `20260531400000_add_invoice_payment_tokens.sql` | deferred | Creates invoice_payment_tokens table for Stripe Pay-now links. Deferred — stripe-connect-pr2 not enabled in prod |
| 15 | `20260531500000_stripe_connect_payment_columns.sql` | deferred | Adds fee/net/receipt/refund columns to invoice_payment_tokens + jobs.card_paid_at. Depends on #14 |
| 16 | `20260531600000_add_deposit_support.sql` | deferred | Deposit-on-acceptance columns across invoice_payment_tokens, jobs, profiles. Depends on #14 and #15 |
| 17 | `20260601000000_add_missing_profile_columns_v2.sql` | yes (2026-06-01) | Second profile sweep: additional columns missed in the first pass |
| 18 | `20260601100000_create_logos_storage_bucket.sql` | yes (2026-06-01) | Creates the logos Storage bucket for business logo uploads |
| 19 | `20260601200000_add_auto_chase_enabled.sql` | yes (2026-06-01) | Adds auto_chase_enabled boolean to profiles |
| 20 | `20260601300000_add_contact_and_utr_to_profiles.sql` | yes (2026-06-01) | Adds contact_phone, contact_email, utr_number to profiles |
| 21 | `20260601400000_add_document_settings_to_profiles.sql` | yes (2026-06-01) | Adds document_settings JSONB to profiles (quote/invoice footer, terms text) |
| 22 | `20260601500000_add_terms_and_website_to_profiles.sql` | yes (2026-06-01) | Adds terms_text and website_url to profiles |
| 23 | `20260602000000_add_ai_quote_builds_quota.sql` | yes (2026-06-02) | Adds ai_quote_builds_used + ai_quote_builds_reset_at to profiles for monthly quota tracking |
| 24 | `20260602100000_add_trade_type_columns.sql` | yes (2026-06-02) | Adds trade_type, trade_type_other, trade_type_confirmed to profiles |
| 25 | `20260606000000_codify_jobs_rls.sql` | yes (2026-06-06) | Codifies owner-scoped RLS on jobs (SELECT/INSERT/UPDATE/DELETE by auth.uid() = user_id) |
| 26 | `20260606000001_close_anon_jobs_enumeration.sql` | yes (2026-06-06) | Drops permissive anon token SELECT policy; public job data now served via fetch-public-job function only. **Negative migration — verifies ABSENCE of jobs_select_public_by_token policy** |
| 27 | `20260610000000_create_materials_table.sql` | yes (2026-06-10) | Creates materials table (per-user library of material/part line items) with RLS |
| 28 | `20260610000001_add_default_markup_to_profiles.sql` | yes (2026-06-10) | Adds default_markup_percent to profiles |
| 29 | `20260617000000_trial_starts_at_first_use.sql` | yes (2026-06-17) | Removes trial_ends_at DEFAULT so trial clock starts on first app use. **Negative migration — verifies ABSENCE of DEFAULT on profiles.trial_ends_at** |
| 30 | `20260616000000_add_founding_member.sql` | yes (2026-06-19) | Founding Member price-lock columns applied to prod on launch day (2026-06-19) |
| 31 | `20260622000000_add_welcome_email_sent_at.sql` | deferred | Adds profiles.welcome_email_sent_at (timestamptz) — idempotency guard for send-welcome-email function. Run in Supabase Studio after merging feat/welcome-email and before provisioning RESEND_API_KEY. |
| 32 | `20260623000000_create_job_chase_states.sql` | deferred | Creates job_chase_states table for cloud-synced chase tracking (JP-LU8 PR A). **RUN THIS IN THE SUPABASE SQL EDITOR BEFORE OR AFTER MERGE** — the cloud path degrades gracefully to localStorage if the table is missing, so merging first is safe. See migration file for full SQL. |

---

## Negative-migration convention

Some migrations DROP a policy, DROP a DEFAULT, or DROP a column. The drift check
is **inverted** — the migration is applied when the thing no longer exists in
prod.

For the audit script to handle these correctly, add this comment near the top of
the SQL file:

```sql
-- DRIFT-CHECK: negative migration — verifies ABSENCE of <thing>
```

Current negative migrations in this repo:

- **#26** `20260606000001_close_anon_jobs_enumeration.sql` — DROP POLICY.
  If policy `jobs_select_public_by_token` still exists in prod, the migration
  was not applied.
- **#29** `20260617000000_trial_starts_at_first_use.sql` — DROP DEFAULT.
  If `profiles.trial_ends_at` still has a column default, the migration was not
  applied.
