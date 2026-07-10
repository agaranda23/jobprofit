// helpers.js — reusable utilities shared across the Get Paid loop E2E specs.
//
// Deliberately framework-light: plain functions over Node's native fetch and
// the Playwright Page/BrowserContext APIs, no custom test() wrapper. Keeps
// every spec file readable top-to-bottom without hunting through a fixture
// extension layer for what a helper actually does.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { SEED_TAG } from './seeded-traders.js';

// ── WhatsApp deep-link interception ─────────────────────────────────────────

/**
 * Intercepts window.open() calls on `page`, runs `triggerAction` (whatever UI
 * interaction is expected to call window.open — e.g. tapping "Send invoice
 * link via WhatsApp"), then returns the captured URL.
 *
 * A real WhatsApp app hand-off cannot be tested in Playwright — the mobile
 * emulation profiles here (WebKit/Chromium) cannot switch to a native app.
 * This only proves the correct wa.me URL was CONSTRUCTED, not that WhatsApp
 * opens it. That gap is closed by manual device testing (flagged in the
 * founder report).
 *
 * window.open is overridden to return null (mimicking a popup-blocked
 * window) rather than actually navigating — this keeps the test page intact
 * so subsequent assertions (toast, modal state) still work.
 *
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<void>} triggerAction
 * @returns {Promise<{ url: string, allOpens: Array<{url: string, target: string, ts: number}> }>}
 */
export async function extractWhatsAppUrl(page, triggerAction) {
  await page.evaluate(() => {
    window.__jpCapturedOpens = [];
    window.open = (url, target) => {
      window.__jpCapturedOpens.push({ url, target, ts: Date.now() });
      return null;
    };
  });

  await triggerAction();

  await page.waitForFunction(
    () => Array.isArray(window.__jpCapturedOpens) && window.__jpCapturedOpens.length > 0,
    { timeout: 10_000 }
  );

  const captured = await page.evaluate(() => window.__jpCapturedOpens);
  const waEntry = captured.find((c) => typeof c.url === 'string' && c.url.includes('wa.me'));

  if (!waEntry) {
    throw new Error(
      `extractWhatsAppUrl: window.open was called ${captured.length} time(s) but none matched wa.me. ` +
        `Captured: ${JSON.stringify(captured)}`
    );
  }

  return { url: waEntry.url, allOpens: captured };
}

// ── Public route navigation ─────────────────────────────────────────────────

/**
 * Navigates to a public, unauthenticated route (/q/<token>, /i/<token>,
 * /r/<token> — client-rendered per src/main.jsx's parsePublic*Route()
 * functions; /p/<token> is DIFFERENT — see note below).
 *
 * Accepts either a fresh BrowserContext (preferred — guarantees no leaked
 * auth state from an injected trader session) or an existing Page.
 *
 * IMPORTANT — /p/<token> is NOT rendered by the React app at all. It's a
 * server-side 302/200 HTML response from netlify/functions/pay-redirect.js,
 * wired via the `/p/*` redirect in netlify.toml. It only resolves correctly
 * when running against `netlify dev` or a real Netlify deploy — plain
 * `vite dev` on :5173 will 404 it. See payment-link-expiry.spec.js.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} pageOrContext
 * @param {'/q'|'/i'|'/r'|'/p'} routePrefix
 * @param {string} token
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function navigateToPublicPage(pageOrContext, routePrefix, token) {
  const page = typeof pageOrContext.newPage === 'function'
    ? await pageOrContext.newPage()
    : pageOrContext;

  const path = `${routePrefix.replace(/\/$/, '')}/${encodeURIComponent(token)}`;
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  return { page, response };
}

// ── Supabase eventual-consistency polling ───────────────────────────────────

/**
 * Polls a Supabase table (via a service-role client) until a row matching
 * `condition` appears, or throws after `timeoutMs`.
 *
 * `condition` can be:
 *   - a plain object of column:value equality filters (fast path, single
 *     `.match()` query, returns as soon as PostgREST finds one row), or
 *   - a predicate function `(row) => boolean`, in which case `options.baseFilter`
 *     narrows the query and the predicate runs client-side over the result set
 *     (needed for checks .match() can't express, e.g. "amount_pence > 0").
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} table
 * @param {object|((row: object) => boolean)} condition
 * @param {{ timeoutMs?: number, intervalMs?: number, baseFilter?: object, select?: string }} [options]
 * @returns {Promise<object>} the matching row
 */
export async function waitForSupabaseWrite(client, table, condition, options = {}) {
  const { timeoutMs = 20_000, intervalMs = 1000, baseFilter = {}, select = '*' } = options;
  const isPredicate = typeof condition === 'function';
  const deadline = Date.now() + timeoutMs;
  let lastSeen = null;
  let lastError = null;

  while (Date.now() < deadline) {
    let query = client.from(table).select(select);
    const filters = isPredicate ? baseFilter : condition;
    for (const [col, val] of Object.entries(filters)) {
      query = query.eq(col, val);
    }

    const { data, error } = await query;
    if (error) {
      lastError = error;
    } else if (data?.length) {
      if (!isPredicate) return data[0];
      const match = data.find(condition);
      if (match) return match;
      lastSeen = data[data.length - 1];
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForSupabaseWrite: timed out after ${timeoutMs}ms polling "${table}" for ` +
      `${isPredicate ? 'a predicate match' : JSON.stringify(condition)}` +
      (lastSeen ? ` — last row seen: ${JSON.stringify(lastSeen)}` : '') +
      (lastError ? ` — last query error: ${lastError.message}` : '')
  );
}

// ── Synthetic Stripe Connect webhook ────────────────────────────────────────

/**
 * Builds a minimal `checkout.session.completed` event payload matching the
 * shape stripe-connect-webhook.js's handleCheckoutCompleted() reads:
 * session.payment_intent + session.metadata.{jobprofit_token,
 * jobprofit_invoice_id, jobprofit_trader_user_id}. See that file's
 * `handleCheckoutCompleted` docblock for the full field-resolution order.
 *
 * @param {{ token?: string, invoiceId: string, traderUserId: string, traderStripeAccountId: string, amountPence?: number }} args
 */
export function buildCheckoutSessionCompletedEvent({
  token,
  invoiceId,
  traderUserId,
  traderStripeAccountId,
  amountPence = 10000,
}) {
  const sessionId = `cs_test_${randomUUID().replace(/-/g, '')}`;
  const paymentIntentId = `pi_test_${randomUUID().replace(/-/g, '')}`;

  return {
    id: `evt_test_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    api_version: '2024-06-20',
    type: 'checkout.session.completed',
    account: traderStripeAccountId,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_intent: paymentIntentId,
        amount_total: amountPence,
        currency: 'gbp',
        metadata: {
          jobprofit_token: token || '',
          jobprofit_invoice_id: invoiceId,
          jobprofit_job_id: invoiceId,
          jobprofit_trader_user_id: traderUserId,
        },
      },
    },
  };
}

/**
 * Signs `eventPayload` with the Connect webhook secret and POSTs it to
 * /.netlify/functions/stripe-connect-webhook — exactly the shape Stripe
 * itself would send, using Stripe SDK's own test-signing helper so the HMAC
 * matches what `stripe.webhooks.constructEvent` verifies server-side.
 *
 * ⚠️ ENV VAR NAME CORRECTION (flagged in the founder report): the function
 * reads STRIPE_CONNECT_WEBHOOK_SECRET, not STRIPE_WEBHOOK_SECRET — that name
 * is already taken by the separate subscription webhook (stripe-webhook.js).
 * Using the wrong secret produces a 400 signature-verification failure that
 * looks like a bug in this helper rather than a naming mismatch.
 *
 * @param {string} baseURL - the app origin under test (PLAYWRIGHT_TEST_URL)
 * @param {object} eventPayload - from buildCheckoutSessionCompletedEvent() or similar
 * @returns {Promise<{ status: number, body: object|null }>}
 */
export async function createSyntheticStripeWebhook(baseURL, eventPayload) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      'createSyntheticStripeWebhook: STRIPE_CONNECT_WEBHOOK_SECRET is not set. This must be a ' +
        'Stripe TEST MODE signing secret for a Connect webhook endpoint — never a live secret.'
    );
  }

  const payloadString = JSON.stringify(eventPayload);
  const signatureHeader = Stripe.webhooks.generateTestHeaderString({
    payload: payloadString,
    secret,
  });

  const endpoint = `${baseURL.replace(/\/$/, '')}/.netlify/functions/stripe-connect-webhook`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signatureHeader,
    },
    body: payloadString,
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON or empty body — leave as null.
  }

  return { status: res.status, body };
}

// ── Job + token seeding ──────────────────────────────────────────────────────

/**
 * Creates a job row directly in Supabase (bypassing the UI) with sensible
 * Get Paid loop defaults, tagged meta.e2eSeedTag so global-teardown.js can
 * find and remove it later.
 *
 * Column names verified against netlify/functions/create-invoice-payment-link-public.js
 * (jobs.id, user_id, amount, summary, meta) and stripe-connect-webhook.js
 * (jobs.paid, status, payment_date, card_paid_at).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client - service-role client
 * @param {{ id: string }} trader - resolved trader (has .id)
 * @param {object} [overrides] - top-level column overrides; pass `meta: {...}` to merge into defaults
 * @returns {Promise<object>} the inserted job row
 */
export async function seedJob(client, trader, overrides = {}) {
  const { meta: metaOverrides, ...columnOverrides } = overrides;

  const baseRow = {
    id: randomUUID(),
    user_id: trader.id,
    customer_name: 'E2E Test Customer',
    amount: 100,
    summary: 'E2E seeded job — bathroom tap replacement',
    address: '10 Customer Street, Testville, TE1 1ST',
    phone: '07700900999',
    email: 'e2e-customer@ohnar-test.local',
    notes: '',
    status: 'active',
    paid: false,
  };

  const baseMeta = {
    e2eSeedTag: SEED_TAG,
    total: 100,
    lineItems: [{ id: 'li_1', desc: 'Test job — E2E seed', cost: 100 }],
    quoteStatus: 'draft',
    payments: [],
  };

  const row = {
    ...baseRow,
    ...columnOverrides,
    meta: { ...baseMeta, ...(metaOverrides || {}) },
  };

  const { data, error } = await client.from('jobs').insert(row).select().single();
  if (error) throw new Error(`seedJob: insert failed — ${error.message}`);
  return data;
}

/**
 * Creates an invoice_payment_tokens row directly, for specs that need to
 * exercise a terminal token state (expired/paid/refunded) without walking
 * the full create-invoice-payment-link-public.js flow first.
 *
 * Column names verified against create-invoice-payment-link-public.js's own
 * insert call and stripe-connect-webhook.js's update calls.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} client - service-role client
 * @param {{ id: string, user_id: string }} job - a row from seedJob()
 * @param {object} [overrides] - e.g. { status: 'expired', expires_at: <past ISO> }
 * @returns {Promise<object>} the inserted token row
 */
export async function seedInvoiceToken(client, job, overrides = {}) {
  const row = {
    token: `${SEED_TAG}-${randomUUID()}`,
    invoice_id: job.id,
    trader_user_id: job.user_id,
    stripe_checkout_session_id: `cs_test_${randomUUID().replace(/-/g, '')}`,
    amount_pence: 10000,
    currency: 'gbp',
    status: 'pending',
    kind: 'invoice',
    expires_at: new Date(Date.now() + 23.5 * 3600 * 1000).toISOString(),
    ...overrides,
  };

  const { data, error } = await client.from('invoice_payment_tokens').insert(row).select().single();
  if (error) throw new Error(`seedInvoiceToken: insert failed — ${error.message}`);
  return data;
}
