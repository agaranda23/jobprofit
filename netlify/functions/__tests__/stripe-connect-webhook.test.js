/**
 * Tests for netlify/functions/stripe-connect-webhook.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 *
 * Covers:
 *   A. Bad Stripe signature → 400
 *   B. Missing env vars → 500
 *   C. checkout.session.completed happy path:
 *       - token marked paid
 *       - job marked paid (canonical fields)
 *       - fee_pence / net_pence / receipt_url stored
 *       - returns 200
 *   D. checkout.session.completed idempotent (already paid → 200, no double-mutate)
 *   E. checkout.session.completed unknown token → 200 (log, don't fail Stripe queue)
 *   F. charge.refunded full refund → token status='refunded', job reverted to invoice_sent
 *   G. charge.refunded partial refund → refunded_amount_pence updated, status stays 'paid'
 *   H. account.application.deauthorized → profile fields cleared
 *   I. Unknown event type → 200 (ignored)
 *   J. Method guard (GET) → 405
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const FAKE_STRIPE_SK      = 'sk_test_fake';
const FAKE_WEBHOOK_SECRET = 'whsec_test_connect_fake';
const FAKE_URL            = 'https://abc.supabase.co';
const FAKE_SRK            = 'service-role-key-fake';
const FAKE_TOKEN          = 'tok_abc123fakepaytoken';
const FAKE_PI_ID          = 'pi_test_connect_fake123';
const FAKE_ACCOUNT_ID     = 'acct_testconnect456';
const FAKE_INVOICE_ID     = 'invoice-uuid-111';
const FAKE_TRADER_ID      = 'trader-uuid-222';
const FAKE_CHARGE_ID      = 'ch_testcharge789';
const FAKE_RECEIPT_URL    = 'https://pay.stripe.com/receipts/test_receipt';
const FAKE_SESSION_ID     = 'cs_test_abc';

// ── Stripe mock ───────────────────────────────────────────────────────────────

// constructEvent is the critical mock: it must throw on bad signature and return
// a valid event on good signature. We control its behaviour per test via mockConstructEvent.
let mockConstructEvent = vi.fn();

// Mock PaymentIntent retrieval (for fee/net fetch)
let mockPiRetrieve = vi.fn(async () => ({
  charges: {
    data: [{
      receipt_url: FAKE_RECEIPT_URL,
      balance_transaction: {
        fee: 830,   // £8.30
        net: 53170, // £531.70
      },
    }],
  },
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      webhooks: {
        constructEvent: (...args) => mockConstructEvent(...args),
      },
      paymentIntents: {
        retrieve: (...args) => mockPiRetrieve(...args),
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────

// We need fine-grained control over select/update per table per test.
// The mock builder pattern mirrors create-invoice-payment-link.test.js.

let mockTokenSelectResult  = { data: null };  // default: token not found
let mockProfileSelectResult = { data: { stripe_user_id: FAKE_ACCOUNT_ID } };
let mockJobSelectResult    = { data: null };  // default: job not found
let mockUpdateResult       = { error: null };

// Track calls to verify idempotency and mutation behaviour
let tokenUpdateCalls  = [];
let jobUpdateCalls    = [];
let profileUpdateCalls = [];

function makeSelectChain(tableResult) {
  return {
    select: () => makeSelectChain(tableResult),
    eq:     () => makeSelectChain(tableResult),
    single: async () => tableResult,
    order:  () => makeSelectChain(tableResult),
    limit:  () => makeSelectChain(tableResult),
  };
}


// We return a fresh adminClient mock that routes by table name.
function buildAdminClient() {
  return {
    from: (table) => {
      if (table === 'invoice_payment_tokens') {
        return {
          select: () => makeSelectChain(mockTokenSelectResult),
          update: (data) => {
            tokenUpdateCalls.push({ table, data });
            return { eq: () => ({ eq: () => mockUpdateResult, ...mockUpdateResult }) };
          },
        };
      }
      if (table === 'jobs') {
        return {
          select: () => makeSelectChain(mockJobSelectResult),
          update: (data) => {
            jobUpdateCalls.push({ table, data });
            return { eq: () => mockUpdateResult };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => makeSelectChain(mockProfileSelectResult),
          update: (data) => {
            profileUpdateCalls.push({ table, data });
            return { eq: () => mockUpdateResult };
          },
        };
      }
      return { select: () => makeSelectChain({ data: null }) };
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => buildAdminClient(),
}));

// ── Handler import ────────────────────────────────────────────────────────────
const { handler } = await import('../stripe-connect-webhook.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEvent(opts = {}) {
  return {
    httpMethod:      opts.httpMethod ?? 'POST',
    isBase64Encoded: false,
    body:            JSON.stringify({ id: 'evt_test', type: opts.type ?? 'checkout.session.completed' }),
    headers:         { 'stripe-signature': 'valid_sig' },
  };
}

function makeStripeEvent(type, dataObject, account = null) {
  return { type, data: { object: dataObject }, account };
}

function makeSession(overrides = {}) {
  return {
    id:             FAKE_SESSION_ID,
    payment_intent: FAKE_PI_ID,
    metadata:       {
      jobprofit_token:           FAKE_TOKEN,
      jobprofit_invoice_id:      FAKE_INVOICE_ID,
      jobprofit_trader_user_id:  FAKE_TRADER_ID,
    },
    ...overrides,
  };
}

function makePaidTokenRow(overrides = {}) {
  return {
    id:                        'token-row-uuid-1',
    token:                     FAKE_TOKEN,
    invoice_id:                FAKE_INVOICE_ID,
    trader_user_id:            FAKE_TRADER_ID,
    stripe_payment_intent_id:  FAKE_PI_ID,
    amount_pence:              54000,
    status:                    'pending',
    ...overrides,
  };
}

function makeCharge(overrides = {}) {
  return {
    id:               FAKE_CHARGE_ID,
    payment_intent:   FAKE_PI_ID,
    amount:           54000,
    amount_refunded:  54000, // full refund by default
    ...overrides,
  };
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY              = FAKE_STRIPE_SK;
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET  = FAKE_WEBHOOK_SECRET;
  process.env.VITE_SUPABASE_URL              = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY      = FAKE_SRK;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setEnv();
  tokenUpdateCalls   = [];
  jobUpdateCalls     = [];
  profileUpdateCalls = [];
  mockTokenSelectResult   = { data: null };
  mockProfileSelectResult = { data: { stripe_user_id: FAKE_ACCOUNT_ID } };
  mockJobSelectResult     = { data: null };
  mockUpdateResult        = { error: null };
  mockConstructEvent.mockReset();
  mockPiRetrieve.mockReset();
  mockPiRetrieve.mockResolvedValue({
    charges: {
      data: [{
        receipt_url: FAKE_RECEIPT_URL,
        balance_transaction: { fee: 830, net: 53170 },
      }],
    },
  });
});

// ── A. Signature verification ─────────────────────────────────────────────────

describe('A. Stripe signature verification', () => {
  it('returns 400 when signature is invalid', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await handler(buildEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.error).toMatch(/signature verification failed/i);
  });
});

// ── B. Missing env vars ───────────────────────────────────────────────────────

describe('B. Missing env vars', () => {
  it('returns 500 when env vars are absent', async () => {
    clearEnv();
    // constructEvent won't even be called — guard fires first
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(500);
    setEnv();
  });
});

// ── C. checkout.session.completed happy path ──────────────────────────────────

describe('C. checkout.session.completed — happy path', () => {
  beforeEach(() => {
    // Valid pending token exists
    mockTokenSelectResult = { data: makePaidTokenRow({ status: 'pending' }) };
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeSession()),
    );
  });

  it('returns 200', async () => {
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true });
  });

  it('marks the token row paid with fee, net, receipt_url', async () => {
    await handler(buildEvent());

    const tokenUpdate = tokenUpdateCalls.find(c => c.table === 'invoice_payment_tokens');
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate.data.status).toBe('paid');
    expect(tokenUpdate.data.stripe_payment_intent_id).toBe(FAKE_PI_ID);
    expect(tokenUpdate.data.fee_pence).toBe(830);
    expect(tokenUpdate.data.net_pence).toBe(53170);
    expect(tokenUpdate.data.receipt_url).toBe(FAKE_RECEIPT_URL);
    expect(tokenUpdate.data.paid_at).toBeTruthy();
  });

  it('marks the parent job paid with canonical fields', async () => {
    await handler(buildEvent());

    const jobUpdate = jobUpdateCalls.find(c => c.table === 'jobs');
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate.data.paid).toBe(true);
    expect(jobUpdate.data.status).toBe('paid');
    expect(jobUpdate.data.paymentStatus).toBe('paid');
    expect(jobUpdate.data.card_paid_at).toBeTruthy();
  });

  it('retrieves the balance_transaction from the connected account', async () => {
    await handler(buildEvent());

    expect(mockPiRetrieve).toHaveBeenCalledWith(
      FAKE_PI_ID,
      expect.objectContaining({ expand: expect.arrayContaining(['charges.data.balance_transaction']) }),
      expect.objectContaining({ stripeAccount: FAKE_ACCOUNT_ID }),
    );
  });
});

// ── D. checkout.session.completed idempotent ──────────────────────────────────

describe('D. checkout.session.completed — idempotent', () => {
  it('returns 200 without mutating DB when token is already paid', async () => {
    mockTokenSelectResult = { data: makePaidTokenRow({ status: 'paid' }) };
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeSession()),
    );

    const res = await handler(buildEvent());

    expect(res.statusCode).toBe(200);
    // No DB mutations — idempotent early return
    expect(tokenUpdateCalls.length).toBe(0);
    expect(jobUpdateCalls.length).toBe(0);
  });
});

// ── E. checkout.session.completed — unknown token ─────────────────────────────

describe('E. checkout.session.completed — unknown token', () => {
  it('returns 200 and does not mutate DB when token row is not found', async () => {
    mockTokenSelectResult = { data: null };
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeSession()),
    );

    const res = await handler(buildEvent());

    expect(res.statusCode).toBe(200);
    expect(tokenUpdateCalls.length).toBe(0);
    expect(jobUpdateCalls.length).toBe(0);
  });
});

// ── F. charge.refunded — full refund ─────────────────────────────────────────

describe('F. charge.refunded — full refund', () => {
  beforeEach(() => {
    // Token exists in 'paid' state
    mockTokenSelectResult = { data: makePaidTokenRow({ status: 'paid' }) };
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('charge.refunded', makeCharge({ amount: 54000, amount_refunded: 54000 })),
    );
  });

  it('returns 200', async () => {
    const res = await handler(buildEvent({ type: 'charge.refunded' }));
    expect(res.statusCode).toBe(200);
  });

  it('flips token status to refunded', async () => {
    await handler(buildEvent({ type: 'charge.refunded' }));

    const tokenUpdate = tokenUpdateCalls.find(c => c.table === 'invoice_payment_tokens');
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate.data.status).toBe('refunded');
    expect(tokenUpdate.data.refunded_amount_pence).toBe(54000);
  });

  it('reverts job status to invoice_sent', async () => {
    await handler(buildEvent({ type: 'charge.refunded' }));

    const jobUpdate = jobUpdateCalls.find(c => c.table === 'jobs');
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate.data.paid).toBe(false);
    expect(jobUpdate.data.status).toBe('invoice_sent');
    expect(jobUpdate.data.paidAt).toBeNull();
    expect(jobUpdate.data.card_paid_at).toBeNull();
  });
});

// ── G. charge.refunded — partial refund ──────────────────────────────────────

describe('G. charge.refunded — partial refund', () => {
  beforeEach(() => {
    mockTokenSelectResult = { data: makePaidTokenRow({ status: 'paid' }) };
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('charge.refunded', makeCharge({ amount: 54000, amount_refunded: 10000 })),
    );
  });

  it('returns 200', async () => {
    const res = await handler(buildEvent({ type: 'charge.refunded' }));
    expect(res.statusCode).toBe(200);
  });

  it('records refunded_amount_pence without flipping token status', async () => {
    await handler(buildEvent({ type: 'charge.refunded' }));

    const tokenUpdate = tokenUpdateCalls.find(c => c.table === 'invoice_payment_tokens');
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate.data.refunded_amount_pence).toBe(10000);
    // status must NOT be 'refunded' for partial — only refunded_amount_pence changes
    expect(tokenUpdate.data.status).toBeUndefined();
  });

  it('does not revert the job for a partial refund', async () => {
    await handler(buildEvent({ type: 'charge.refunded' }));

    const jobUpdate = jobUpdateCalls.find(c => c.table === 'jobs');
    expect(jobUpdate).toBeUndefined();
  });
});

// ── H. account.application.deauthorized ──────────────────────────────────────

describe('H. account.application.deauthorized', () => {
  it('clears stripe_user_id and sets disconnected status on the profile', async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('account.application.deauthorized', {}, FAKE_ACCOUNT_ID),
    );

    const res = await handler(buildEvent({ type: 'account.application.deauthorized' }));

    expect(res.statusCode).toBe(200);

    const profileUpdate = profileUpdateCalls.find(c => c.table === 'profiles');
    expect(profileUpdate).toBeDefined();
    expect(profileUpdate.data.stripe_user_id).toBeNull();
    expect(profileUpdate.data.stripe_connect_status).toBe('disconnected');
    expect(profileUpdate.data.stripe_connect_disconnected_at).toBeTruthy();
  });

  it('does not touch invoice_payment_tokens on deauthorize', async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('account.application.deauthorized', {}, FAKE_ACCOUNT_ID),
    );

    await handler(buildEvent({ type: 'account.application.deauthorized' }));

    expect(tokenUpdateCalls.length).toBe(0);
  });
});

// ── I. Unknown event ──────────────────────────────────────────────────────────

describe('I. Unknown event type', () => {
  it('returns 200 without mutating DB', async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('payment_intent.created', {}),
    );

    const res = await handler(buildEvent({ type: 'payment_intent.created' }));

    expect(res.statusCode).toBe(200);
    expect(tokenUpdateCalls.length).toBe(0);
    expect(jobUpdateCalls.length).toBe(0);
  });
});

// ── J. Method guard ───────────────────────────────────────────────────────────

describe('J. Method guard', () => {
  it('returns 405 for GET requests', async () => {
    const res = await handler(buildEvent({ httpMethod: 'GET' }));
    expect(res.statusCode).toBe(405);
  });
});

// ── K. Deposit completed — happy path ─────────────────────────────────────────

describe('K. checkout.session.completed with jp_type=deposit', () => {
  const FAKE_DEPOSIT_TOKEN = 'dep-tok-abc123';
  const FAKE_QUOTE_ID      = 'quote-uuid-999';
  const FAKE_DEPOSIT_META  = {
    jp_type:                  'deposit',
    jobprofit_deposit_token:  FAKE_DEPOSIT_TOKEN,
    jobprofit_quote_id:       FAKE_QUOTE_ID,
    jobprofit_trader_user_id: FAKE_TRADER_ID,
    jobprofit_deposit_percent: '25',
  };

  function makeDepositSession(overrides = {}) {
    return {
      id:             FAKE_SESSION_ID,
      payment_intent: FAKE_PI_ID,
      metadata:       { ...FAKE_DEPOSIT_META, ...overrides },
    };
  }

  function makeDepositTokenRow(overrides = {}) {
    return {
      id:             'deposit-token-row-1',
      token:          FAKE_DEPOSIT_TOKEN,
      kind:           'deposit',
      invoice_id:     FAKE_QUOTE_ID,
      quote_id:       FAKE_QUOTE_ID,
      trader_user_id: FAKE_TRADER_ID,
      amount_pence:   13500, // 25% of £540
      status:         'pending',
      ...overrides,
    };
  }

  it('K1: marks deposit token paid with fee/net/receipt_url', async () => {
    mockTokenSelectResult = { data: makeDepositTokenRow() };
    mockJobSelectResult   = {
      data: {
        id:       FAKE_QUOTE_ID,
        user_id:  FAKE_TRADER_ID,
        meta:     {},
        summary:  'Bathroom re-tile',
      },
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeDepositSession()),
    );

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    // Token update should have status='paid'
    const tokenUpdate = tokenUpdateCalls.find(c => c.data.status === 'paid');
    expect(tokenUpdate).toBeTruthy();
    expect(tokenUpdate.data.fee_pence).toBe(830);
    expect(tokenUpdate.data.net_pence).toBe(53170);
    expect(tokenUpdate.data.receipt_url).toBe(FAKE_RECEIPT_URL);
  });

  it('K2: deposit token row has kind=deposit correctly checked', async () => {
    // Deposit row with kind='deposit' — should be found and processed
    mockTokenSelectResult = { data: makeDepositTokenRow({ kind: 'deposit' }) };
    mockJobSelectResult   = {
      data: {
        id:      FAKE_QUOTE_ID,
        user_id: FAKE_TRADER_ID,
        meta:    {},
        summary: 'Patio job',
      },
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeDepositSession()),
    );

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
  });

  it('K3: idempotent — already-paid deposit token returns 200 without mutations', async () => {
    mockTokenSelectResult = { data: makeDepositTokenRow({ status: 'paid' }) };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeDepositSession()),
    );

    const initialTokenUpdates = tokenUpdateCalls.length;
    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);
    // No new token update should have been pushed
    expect(tokenUpdateCalls.length).toBe(initialTokenUpdates);
  });
});

// ── L. Deposit refund ─────────────────────────────────────────────────────────

describe('L. charge.refunded with kind=deposit', () => {
  it('L1: full deposit refund — clears deposit_paid_at on job, token becomes refunded', async () => {
    mockTokenSelectResult = {
      data: {
        id:                       'deposit-token-row-2',
        kind:                     'deposit',
        quote_id:                 'quote-uuid-ref',
        invoice_id:               'quote-uuid-ref',
        trader_user_id:           FAKE_TRADER_ID,
        stripe_payment_intent_id: FAKE_PI_ID,
        amount_pence:             13500,
        status:                   'paid',
      },
    };

    const charge = {
      id: 'ch_fake',
      payment_intent: FAKE_PI_ID,
      amount: 13500,
      amount_refunded: 13500,
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('charge.refunded', charge),
    );

    const res = await handler(buildEvent({ type: 'charge.refunded' }));
    expect(res.statusCode).toBe(200);
    // Token update: status='refunded'
    const tokenRefund = tokenUpdateCalls.find(c => c.data.status === 'refunded');
    expect(tokenRefund).toBeTruthy();
    // Job update: deposit_paid_at cleared
    const jobDepositClear = jobUpdateCalls.find(c => c.data.deposit_paid_at === null);
    expect(jobDepositClear).toBeTruthy();
  });

  it('L2: partial deposit refund — refunded_amount_pence updated, no job mutation', async () => {
    mockTokenSelectResult = {
      data: {
        id:                       'deposit-token-row-3',
        kind:                     'deposit',
        quote_id:                 'quote-uuid-partial',
        invoice_id:               'quote-uuid-partial',
        trader_user_id:           FAKE_TRADER_ID,
        stripe_payment_intent_id: FAKE_PI_ID,
        amount_pence:             13500,
        status:                   'paid',
      },
    };

    const charge = {
      id: 'ch_partial',
      payment_intent: FAKE_PI_ID,
      amount: 13500,
      amount_refunded: 5000, // partial
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('charge.refunded', charge),
    );

    const res = await handler(buildEvent({ type: 'charge.refunded' }));
    expect(res.statusCode).toBe(200);
    // Token update: only refunded_amount_pence, no status change to 'refunded'
    const partialRefund = tokenUpdateCalls.find(c => c.data.refunded_amount_pence === 5000);
    expect(partialRefund).toBeTruthy();
    expect(tokenUpdateCalls.some(c => c.data.status === 'refunded')).toBe(false);
  });
});

// ── M. Deposit consent fields written to jobs.meta ────────────────────────────
// These tests verify that the GDPR consent gap on the deposit acceptance path
// is closed: when a deposit checkout completes, the webhook must write
// consentGiven/consentAt/consentPolicyVersion into jobs.meta, mirroring
// what accept-quote.js writes on the sign path.

describe('M. Deposit completed — consent fields in jobs.meta', () => {
  const FAKE_DEPOSIT_TOKEN   = 'dep-tok-consent-test';
  const FAKE_QUOTE_ID        = 'quote-uuid-consent';
  const FAKE_CONSENT_AT      = '2026-06-02T10:00:00.000Z';

  function makeDepositSessionWithConsent(overrides = {}) {
    return {
      id:             FAKE_SESSION_ID,
      payment_intent: FAKE_PI_ID,
      metadata: {
        jp_type:                    'deposit',
        jobprofit_deposit_token:    FAKE_DEPOSIT_TOKEN,
        jobprofit_quote_id:         FAKE_QUOTE_ID,
        jobprofit_trader_user_id:   FAKE_TRADER_ID,
        jobprofit_deposit_percent:  '25',
        consent_given:              'true',
        consent_at:                 FAKE_CONSENT_AT,
        consent_policy_version:     'v1',
        ...overrides,
      },
    };
  }

  function makeDepositTokenRow(overrides = {}) {
    return {
      id:             'deposit-consent-row-1',
      token:          FAKE_DEPOSIT_TOKEN,
      kind:           'deposit',
      invoice_id:     FAKE_QUOTE_ID,
      quote_id:       FAKE_QUOTE_ID,
      trader_user_id: FAKE_TRADER_ID,
      amount_pence:   13500,
      status:         'pending',
      ...overrides,
    };
  }

  it('M1: writes consentGiven:true, consentAt, consentPolicyVersion:v1 when consent metadata is present', async () => {
    mockTokenSelectResult = { data: makeDepositTokenRow() };
    mockJobSelectResult   = {
      data: {
        id:       FAKE_QUOTE_ID,
        user_id:  FAKE_TRADER_ID,
        meta:     {},
        summary:  'Kitchen fit',
        payments: [],
      },
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeDepositSessionWithConsent()),
    );

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);

    const jobUpdate = jobUpdateCalls.find(c => c.table === 'jobs' && c.data.meta);
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate.data.meta.consentGiven).toBe(true);
    expect(jobUpdate.data.meta.consentAt).toBe(FAKE_CONSENT_AT);
    expect(jobUpdate.data.meta.consentPolicyVersion).toBe('v1');
    expect(jobUpdate.data.meta.quoteStatus).toBe('accepted');
  });

  it('M2: graceful fallback — no consent metadata (old in-flight link) still marks accepted, consentGiven:false', async () => {
    mockTokenSelectResult = { data: makeDepositTokenRow() };
    mockJobSelectResult   = {
      data: {
        id:       FAKE_QUOTE_ID,
        user_id:  FAKE_TRADER_ID,
        meta:     {},
        summary:  'Old link job',
        payments: [],
      },
    };

    // Old session — no consent_ keys in metadata
    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', {
        id:             FAKE_SESSION_ID,
        payment_intent: FAKE_PI_ID,
        metadata: {
          jp_type:                   'deposit',
          jobprofit_deposit_token:   FAKE_DEPOSIT_TOKEN,
          jobprofit_quote_id:        FAKE_QUOTE_ID,
          jobprofit_trader_user_id:  FAKE_TRADER_ID,
          jobprofit_deposit_percent: '25',
          // no consent_ fields
        },
      }),
    );

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);

    const jobUpdate = jobUpdateCalls.find(c => c.table === 'jobs' && c.data.meta);
    expect(jobUpdate).toBeDefined();
    // Quote still accepted — not crashing
    expect(jobUpdate.data.meta.quoteStatus).toBe('accepted');
    // Consent recorded as not captured rather than throwing
    expect(jobUpdate.data.meta.consentGiven).toBe(false);
    expect(jobUpdate.data.meta.consentPolicyVersion).toBeNull();
  });

  it('M3: does not overwrite existing consent fields when quote was already signed first', async () => {
    mockTokenSelectResult = { data: makeDepositTokenRow() };
    // Quote already has consent from the sign flow
    mockJobSelectResult   = {
      data: {
        id:       FAKE_QUOTE_ID,
        user_id:  FAKE_TRADER_ID,
        meta: {
          acceptedSignature:    'data:image/png;base64,EXISTING',
          acceptedAt:           '2026-06-01T09:00:00.000Z',
          acceptedSource:       'remote',
          consentGiven:         true,
          consentAt:            '2026-06-01T09:00:00.000Z',
          consentPolicyVersion: 'v1',
        },
        summary:  'Already signed',
        payments: [],
      },
    };

    mockConstructEvent.mockReturnValue(
      makeStripeEvent('checkout.session.completed', makeDepositSessionWithConsent()),
    );

    const res = await handler(buildEvent());
    expect(res.statusCode).toBe(200);

    const jobUpdate = jobUpdateCalls.find(c => c.table === 'jobs' && c.data.meta);
    expect(jobUpdate).toBeDefined();
    // The original consent timestamp must not be overwritten
    expect(jobUpdate.data.meta.consentAt).toBe('2026-06-01T09:00:00.000Z');
    expect(jobUpdate.data.meta.consentGiven).toBe(true);
  });
});
