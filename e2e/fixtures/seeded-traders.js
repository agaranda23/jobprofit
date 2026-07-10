// seeded-traders.js — six dedicated test-user profiles for the Get Paid loop
// E2E suite, plus helpers to create/fetch them idempotently and to inject an
// authenticated session into a Playwright page without walking the magic-link
// UI (fast path — see loginAs()).
//
// Column names below are taken directly from the Netlify functions that read
// the `profiles` table (fetch-public-invoice.js, create-invoice-payment-link-public.js,
// chase-reminders.js) — not guessed. If the founders' Supabase schema has since
// drifted, seedTestUsers() will surface a clear Postgres error naming the
// missing column rather than failing silently.
//
// ASSUMPTION (flag in report): this assumes `profiles.id` is a foreign key to
// `auth.users.id`, created either by a DB trigger on signup or requiring an
// explicit insert after auth.admin.createUser(). We do both defensively below
// (create the auth user, then upsert the profiles row) — upsert is a no-op if
// a trigger already created the row.
import { createClient } from '@supabase/supabase-js';

// Tag written into jobs.meta.e2eSeedTag on every job this suite creates, and
// used as a prefix on synthetic invoice_payment_tokens.token values. Lets
// global-teardown.js (and founders, manually) distinguish suite-seeded rows
// from real trader data in a shared Supabase project.
export const SEED_TAG = 'e2e-gp-loop';

export const TEST_TRADER_EMAIL_DOMAIN = 'ohnar-test.local';

// A synthetic 24-hex-char Connect account id shape. We never call real Stripe
// Connect APIs against these — stripe-connect-webhook.js's balance_transaction
// fetch is wrapped in a non-fatal try/catch (see module docblock in that file),
// so an account id that doesn't resolve on Stripe's side degrades gracefully:
// the job/token still gets marked paid, fee/net just stay 0.
function fakeStripeAccountId(letter) {
  return `acct_test_e2e${letter.toLowerCase()}000000000000`;
}

// ── Trader definitions ──────────────────────────────────────────────────────
// Each entry is the `profiles` row patch applied after the auth user exists.
// `password` is intentionally absent — this app has no password auth (magic
// link + Google OAuth only, see AuthScreen.jsx); loginAs() below injects a
// session directly instead of driving a UI login for every spec except
// prod-smoke.spec.js, which deliberately exercises the real magic-link path.

export const TEST_TRADERS = {
  // Trader A — Stripe connected, complete profile. The "everything works"
  // trader used by the happy-path and WhatsApp-mechanics specs.
  A: {
    key: 'A',
    email: `e2e-trader-a@${TEST_TRADER_EMAIL_DOMAIN}`,
    profile: {
      business_name: 'Ohnar E2E Trader A Plumbing',
      first_name: 'Aisha',
      last_name: 'TraderA',
      address: '1 Test Street, Manchester, M1 1AA',
      phone: '07700900001',
      email: `e2e-trader-a@${TEST_TRADER_EMAIL_DOMAIN}`,
      account_name: 'Aisha TraderA',
      sort_code: '123456',
      account_number: '12345678',
      vat_number: '',
      stripe_connect_status: 'connected',
      stripe_user_id: fakeStripeAccountId('A'),
      stripe_payment_link: '',
      plan: 'pro',
      trial_ends_at: null,
      auto_chase_enabled: true,
    },
  },

  // Trader B — static Stripe Payment Link, NOT Connect. Exercises the
  // StaticPayLink branch in PublicInvoiceView.
  B: {
    key: 'B',
    email: `e2e-trader-b@${TEST_TRADER_EMAIL_DOMAIN}`,
    profile: {
      business_name: 'Ohnar E2E Trader B Electrical',
      first_name: 'Ben',
      last_name: 'TraderB',
      address: '2 Test Street, Leeds, LS1 1AA',
      phone: '07700900002',
      email: `e2e-trader-b@${TEST_TRADER_EMAIL_DOMAIN}`,
      account_name: 'Ben TraderB',
      sort_code: '123457',
      account_number: '12345679',
      vat_number: '',
      stripe_connect_status: 'disconnected',
      stripe_user_id: null,
      stripe_payment_link: 'https://buy.stripe.com/test_e2e_trader_b_static_link',
      plan: 'pro',
      trial_ends_at: null,
      auto_chase_enabled: true,
    },
  },

  // Trader C — bank details only, no card option at all. Exercises the
  // bank-only fallback note in PublicInvoiceView AND is reused (per QAE's
  // fixture note) for the 409 NOT_CONNECTED spec if isolation from D isn't
  // required — this suite keeps C and D separate (see D below) so
  // public-invoice-render-variants and stripe-not-connected-409 never share
  // mutable state when run in parallel workers.
  C: {
    key: 'C',
    email: `e2e-trader-c@${TEST_TRADER_EMAIL_DOMAIN}`,
    profile: {
      business_name: 'Ohnar E2E Trader C Roofing',
      first_name: 'Cara',
      last_name: 'TraderC',
      address: '3 Test Street, Bristol, BS1 1AA',
      phone: '07700900003',
      email: `e2e-trader-c@${TEST_TRADER_EMAIL_DOMAIN}`,
      account_name: 'Cara TraderC',
      sort_code: '123458',
      account_number: '12345680',
      vat_number: '',
      stripe_connect_status: 'disconnected',
      stripe_user_id: null,
      stripe_payment_link: '',
      plan: 'pro',
      trial_ends_at: null,
      auto_chase_enabled: true,
    },
  },

  // Trader D — not connected, no static link, no bank details either.
  // Dedicated to stripe-not-connected-409.spec.js so its 409 assertion never
  // races with public-invoice-render-variants.spec.js mutating Trader C.
  D: {
    key: 'D',
    email: `e2e-trader-d@${TEST_TRADER_EMAIL_DOMAIN}`,
    profile: {
      business_name: 'Ohnar E2E Trader D Landscaping',
      first_name: 'Dev',
      last_name: 'TraderD',
      address: '4 Test Street, Cardiff, CF1 1AA',
      phone: '07700900004',
      email: `e2e-trader-d@${TEST_TRADER_EMAIL_DOMAIN}`,
      account_name: '',
      sort_code: '',
      account_number: '',
      vat_number: '',
      stripe_connect_status: 'disconnected',
      stripe_user_id: null,
      stripe_payment_link: '',
      plan: 'pro',
      trial_ends_at: null,
      auto_chase_enabled: true,
    },
  },

  // Trader E — free tier with an EXPIRED trial. plan stays 'trial' (matches
  // isTrialActive()/isPro() semantics in src/lib/plan.js — trial_ends_at in
  // the past means isPro() === false) rather than 'free', so the spec proves
  // the interesting case: a trader who USED to have Pro and dropped out of it,
  // not just a user who never had it.
  E: {
    key: 'E',
    email: `e2e-trader-e@${TEST_TRADER_EMAIL_DOMAIN}`,
    profile: {
      business_name: 'Ohnar E2E Trader E Gardening',
      first_name: 'Eli',
      last_name: 'TraderE',
      address: '5 Test Street, Glasgow, G1 1AA',
      phone: '07700900005',
      email: `e2e-trader-e@${TEST_TRADER_EMAIL_DOMAIN}`,
      account_name: 'Eli TraderE',
      sort_code: '123459',
      account_number: '12345681',
      vat_number: '',
      stripe_connect_status: 'disconnected',
      stripe_user_id: null,
      stripe_payment_link: '',
      plan: 'trial',
      // 30 days in the past — well clear of isTrialActive()'s `> now` check.
      trial_ends_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      auto_chase_enabled: true,
    },
  },

  // Trader F — push-subscribed, auto-chase enabled. Used only by the
  // API-level chase-reminders spec; a synthetic push_subscriptions row is
  // seeded separately by seedPushSubscription() below (invalid endpoint —
  // sendPushToUser's fail-soft contract means this never blocks the meta
  // write chase-reminders.js performs after attempting the push).
  F: {
    key: 'F',
    email: `e2e-trader-f@${TEST_TRADER_EMAIL_DOMAIN}`,
    profile: {
      business_name: 'Ohnar E2E Trader F Joinery',
      first_name: 'Fay',
      last_name: 'TraderF',
      address: '6 Test Street, Norwich, NR1 1AA',
      phone: '07700900006',
      email: `e2e-trader-f@${TEST_TRADER_EMAIL_DOMAIN}`,
      account_name: 'Fay TraderF',
      sort_code: '123460',
      account_number: '12345682',
      vat_number: '',
      stripe_connect_status: 'disconnected',
      stripe_user_id: null,
      stripe_payment_link: '',
      plan: 'pro',
      trial_ends_at: null,
      auto_chase_enabled: true,
    },
  },
};

// ── Admin client (lazy) ─────────────────────────────────────────────────────
// Constructed on first use, not at module load — importing this file must
// never throw just because env vars aren't set yet (e.g. `playwright test --list`
// in a shell with no .env.test sourced).
let _adminClient = null;

export function getAdminClient() {
  if (_adminClient) return _adminClient;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'seeded-traders: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to seed test users. ' +
        'See e2e/.env.example.'
    );
  }

  _adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}

// ── Idempotent user creation ────────────────────────────────────────────────

/**
 * Finds or creates the auth user + profiles row for one trader definition.
 * Idempotent: safe to call on every test run. Returns the trader def merged
 * with a resolved `id` (auth.users.id === profiles.id).
 */
async function ensureTrader(traderDef) {
  const admin = getAdminClient();

  // Look up by profiles.email first — cheaper than paginating auth admin
  // listUsers(), and profiles.email is populated by the same seed call so a
  // second run always finds it here.
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', traderDef.email)
    .maybeSingle();

  let userId = existingProfile?.id;

  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: traderDef.email,
      email_confirm: true,
      user_metadata: { e2e_seed_tag: SEED_TAG, e2e_trader_key: traderDef.key },
    });

    if (createErr) {
      // Race with another parallel worker seeding the same trader, or the
      // user exists in auth.users but the profiles row lookup above missed it
      // (e.g. profiles.email is null for a pre-existing row). Fall back to
      // scanning auth users by email once before giving up.
      const { data: page } = await admin.auth.admin.listUsers({ perPage: 200 });
      const match = page?.users?.find((u) => u.email === traderDef.email);
      if (!match) {
        throw new Error(
          `seeded-traders: could not create or find auth user for ${traderDef.email}: ${createErr.message}`
        );
      }
      userId = match.id;
    } else {
      userId = created.user.id;
    }
  }

  const { error: upsertErr } = await admin
    .from('profiles')
    .upsert({ id: userId, ...traderDef.profile }, { onConflict: 'id' });

  if (upsertErr) {
    throw new Error(
      `seeded-traders: profiles upsert failed for ${traderDef.email}: ${upsertErr.message}`
    );
  }

  return { ...traderDef, id: userId };
}

/**
 * Seeds (or reuses) all six test traders. Idempotent — safe to call at the
 * top of every spec file or once in a Playwright fixture/setup project.
 * Returns a map keyed by trader letter (A–F), each entry carrying `id`.
 *
 * @returns {Promise<Record<string, object>>}
 */
export async function seedTestUsers() {
  const entries = await Promise.all(Object.values(TEST_TRADERS).map(ensureTrader));
  const byKey = {};
  for (const t of entries) byKey[t.key] = t;
  return byKey;
}

/**
 * Seeds a single trader by letter — convenience for specs that only need one.
 */
export async function seedTrader(letter) {
  const def = TEST_TRADERS[letter];
  if (!def) throw new Error(`seeded-traders: unknown trader letter "${letter}"`);
  return ensureTrader(def);
}

/**
 * Inserts (or replaces) a push_subscriptions row for Trader F so
 * chase-reminders.js's `subscribedUserIds` query picks them up.
 * The endpoint is deliberately fake — sendPushToUser's fail-soft contract
 * (see netlify/functions/_lib/sendPushToUser.js) means a failed push never
 * blocks the chaseRemindedTier meta write chase-reminders.js performs after.
 */
export async function seedPushSubscription(traderId) {
  const admin = getAdminClient();
  await admin.from('push_subscriptions').delete().eq('user_id', traderId);
  const { error } = await admin.from('push_subscriptions').insert({
    user_id: traderId,
    endpoint: `https://fcm.googleapis.com/fcm/send/${SEED_TAG}-fake-endpoint`,
    p256dh: 'BFakeP256dhKeyForE2ETestingPurposesOnlyNotARealKeyAAAAAAAAAAAAAAAA',
    auth_secret: 'fakeAuthSecretE2E',
  });
  if (error) {
    throw new Error(`seeded-traders: push_subscriptions insert failed: ${error.message}`);
  }
}

// ── Session injection (fast login) ──────────────────────────────────────────

/**
 * Extracts the Supabase project ref from VITE_SUPABASE_URL
 * (https://<ref>.supabase.co) — needed to construct the exact localStorage
 * key @supabase/supabase-js v2 uses to persist a session: `sb-<ref>-auth-token`.
 */
function projectRefFromUrl(supabaseUrl) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(supabaseUrl || '');
  if (!match) {
    throw new Error(
      `seeded-traders: could not extract project ref from VITE_SUPABASE_URL="${supabaseUrl}". ` +
        'loginAs() assumes the standard *.supabase.co host — update this helper if the project ' +
        'uses a custom domain.'
    );
  }
  return match[1];
}

/**
 * Mints a real Supabase session for a trader via the admin `generateLink` API
 * (magiclink type) and immediately exchanges it for tokens with `verifyOtp` —
 * both are service-role-only calls, never exposed to the browser under test.
 *
 * ASSUMPTION (flag in report): `generateLink` + `verifyOtp` token_hash exchange
 * is the documented supabase-js v2 pattern for minting a session server-side
 * without the user ever seeing an email. Verify this still matches whatever
 * supabase-js version is pinned in package.json (^2.104.0 at last read) —
 * the admin API has had shape changes across major versions.
 *
 * @param {string} email
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: number, user: object}>}
 */
async function mintSession(email) {
  const admin = getAdminClient();

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr) {
    throw new Error(`seeded-traders: generateLink failed for ${email}: ${linkErr.message}`);
  }

  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error(
      `seeded-traders: generateLink response for ${email} had no properties.hashed_token — ` +
        'supabase-js response shape may have changed; inspect linkData manually.'
    );
  }

  // Exchange the hashed token for a real session. Uses a throwaway anon
  // client (not the admin client) because verifyOtp is a public-key operation.
  const { createClient: createAnonClient } = await import('@supabase/supabase-js');
  const anon = createAnonClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyErr || !verifyData?.session) {
    throw new Error(
      `seeded-traders: verifyOtp failed for ${email}: ${verifyErr?.message || 'no session returned'}`
    );
  }

  return verifyData.session;
}

/**
 * Injects an authenticated Supabase session into a fresh Playwright page
 * BEFORE the app loads, via an init script that writes localStorage in the
 * exact shape @supabase/supabase-js expects at `sb-<ref>-auth-token`.
 *
 * Much faster than driving the magic-link UI for every spec — use this
 * everywhere EXCEPT prod-smoke.spec.js, which deliberately proves the real
 * auth path still works post-deploy (see that file's docblock).
 *
 * Must be called BEFORE `page.goto()` — addInitScript only affects
 * navigations that happen after it's registered.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ email: string }} trader - a resolved trader (from seedTestUsers())
 */
export async function loginAs(page, trader) {
  const session = await mintSession(trader.email);
  const projectRef = projectRefFromUrl(process.env.VITE_SUPABASE_URL);
  const storageKey = `sb-${projectRef}-auth-token`;

  // supabase-js persists the full session object (not just the tokens) under
  // this key, including token_type/expires_in/user — write the same shape so
  // the client's internal getSession() resolves without a network refresh.
  const storedValue = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type || 'bearer',
    user: session.user,
  });

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [storageKey, storedValue]
  );
}
