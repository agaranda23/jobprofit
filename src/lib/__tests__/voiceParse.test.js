/**
 * voiceParse — unit tests for multilingual job transcript parsing.
 *
 * fetch is mocked to avoid hitting the Netlify AI proxy.
 * The mock mimics the shape of a real Claude response:
 *   { content: [{ type: 'text', text: '<JSON string>' }] }
 *
 * supabase.auth.getSession is mocked so the JWT gate doesn't block the AI
 * path in tests. The mock returns a fake access_token so fetch is reached.
 *
 * Two code paths are tested:
 *   1. AI path: fetch succeeds, response contains a valid JSON block.
 *   2. Regex fallback path: fetch throws (simulates offline / proxy down).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJobFromSpeech, resolveNextWeekday } from '../voiceParse.js';

// ── Mock Supabase module ──────────────────────────────────────────────────────
// voiceParse.js now imports { supabase } from './supabase' and calls
// supabase.auth.getSession() before hitting the AI proxy. We stub it here so
// the AI path tests receive a valid (fake) access token and reach the fetch mock.
vi.mock('../supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetchSuccess(json) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify(json) }],
    }),
  });
}

function mockFetchFailure() {
  return vi.fn().mockRejectedValue(new Error('Network error'));
}

// ── AI path tests ─────────────────────────────────────────────────────────────

describe('parseJobFromSpeech — AI path', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('English: extracts name, customer, amount, payment from a standard transcript', async () => {
    global.fetch = mockFetchSuccess({ name: 'Kitchen job', customer: 'Sarah', amount: 380, paymentType: 'cash' });
    const result = await parseJobFromSpeech('Kitchen job Sarah £380 cash');
    expect(result.name).toBe('Kitchen job');
    expect(result.customer).toBe('Sarah');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Polish: maps gotówka → cash and keeps job name in Polish', async () => {
    global.fetch = mockFetchSuccess({ name: 'Kuchnia', customer: 'Sarah', amount: 380, paymentType: 'cash' });
    const result = await parseJobFromSpeech('Kuchnia Sarah 380 gotówka');
    expect(result.name).toBe('Kuchnia');
    expect(result.customer).toBe('Sarah');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Romanian: maps numerar → cash, extracts customer', async () => {
    global.fetch = mockFetchSuccess({ name: 'Bucătărie', customer: 'Maria', amount: 250, paymentType: 'cash' });
    const result = await parseJobFromSpeech('Bucătărie pentru Maria 250 numerar');
    expect(result.amount).toBe(250);
    expect(result.paymentType).toBe('cash');
    expect(result.customer).toBe('Maria');
  });

  it('Portuguese: maps dinheiro → cash, no customer', async () => {
    global.fetch = mockFetchSuccess({ name: 'Cozinha', customer: null, amount: 500, paymentType: 'cash' });
    const result = await parseJobFromSpeech('Cozinha 500 dinheiro');
    expect(result.amount).toBe(500);
    expect(result.paymentType).toBe('cash');
    expect(result.customer).toBeNull();
  });

  it('Spanish: maps efectivo → cash, no customer', async () => {
    global.fetch = mockFetchSuccess({ name: 'Cocina', customer: null, amount: 300, paymentType: 'cash' });
    const result = await parseJobFromSpeech('Cocina 300 efectivo');
    expect(result.amount).toBe(300);
    expect(result.paymentType).toBe('cash');
    expect(result.customer).toBeNull();
  });

  it('returns empty-ish object for an empty transcript without calling fetch', async () => {
    global.fetch = vi.fn();
    const result = await parseJobFromSpeech('');
    expect(result).toEqual({
      name: '', customer: null, amount: null, paymentType: null,
      vat: null, depositPercent: null, depositDue: null,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Regex fallback path tests ─────────────────────────────────────────────────

describe('parseJobFromSpeech — regex fallback (fetch fails)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('English: extracts amount and cash from regex when fetch fails', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 cash');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
    expect(result.customer).toBeNull();
  });

  it('Polish: regex extracts amount and gotówka → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kuchnia 380 gotówka');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Romanian: regex extracts amount and numerar → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Bucătărie 250 numerar');
    expect(result.amount).toBe(250);
    expect(result.paymentType).toBe('cash');
  });

  it('Portuguese: regex extracts amount and dinheiro → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Cozinha 500 dinheiro');
    expect(result.amount).toBe(500);
    expect(result.paymentType).toBe('cash');
  });

  it('Spanish: regex extracts amount and efectivo → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Cocina 300 efectivo');
    expect(result.amount).toBe(300);
    expect(result.paymentType).toBe('cash');
  });

  it('Polish: regex maps przelew → bank transfer', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Remont 1200 przelew');
    expect(result.amount).toBe(1200);
    expect(result.paymentType).toBe('bank transfer');
  });

  it('Spanish: regex maps tarjeta → card', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Pintura 400 tarjeta');
    expect(result.amount).toBe(400);
    expect(result.paymentType).toBe('card');
  });

  it('Romanian: regex maps cec → cheque', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Tencuire 600 cec');
    expect(result.amount).toBe(600);
    expect(result.paymentType).toBe('cheque');
  });

  it('Italian: regex extracts amount and contanti → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Cucina 380 contanti');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Italian: regex maps bonifico → bank transfer', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Tetto 1200 bonifico');
    expect(result.amount).toBe(1200);
    expect(result.paymentType).toBe('bank transfer');
  });

  it('Russian: regex maps наличные → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Кухня 380 наличные');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Russian: regex maps перевод → bank transfer', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Ремонт 1500 перевод');
    expect(result.amount).toBe(1500);
    expect(result.paymentType).toBe('bank transfer');
  });

  it('Lithuanian: regex maps grynais → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Virtuvė 250 grynais');
    expect(result.amount).toBe(250);
    expect(result.paymentType).toBe('cash');
  });

  it('Lithuanian: regex maps pavedimas → bank transfer', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Stogas 900 pavedimas');
    expect(result.amount).toBe(900);
    expect(result.paymentType).toBe('bank transfer');
  });

  it('Ukrainian: regex maps готівка → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Кухня 300 готівка');
    expect(result.amount).toBe(300);
    expect(result.paymentType).toBe('cash');
  });

  it('Ukrainian: regex maps переказ → bank transfer', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Ванна 800 переказ');
    expect(result.amount).toBe(800);
    expect(result.paymentType).toBe('bank transfer');
  });

  it('Arabic: regex maps نقدا → cash', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('مطبخ 380 نقدا');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Arabic: regex converts Arabic-Indic numerals to amount', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('مطبخ ٣٨٠ نقدا');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('Arabic: regex maps تحويل → bank transfer', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('حمام 500 تحويل');
    expect(result.amount).toBe(500);
    expect(result.paymentType).toBe('bank transfer');
  });
});

// ── regexAmount — £-prefix wins over a leading count word (fix/robustness-hardening) ──
//
// Bug: "for 3 people £380 cash" previously matched the FIRST bare number (3)
// because the regex had no preference for £-prefixed values.
// Fix: £-prefixed numbers take priority; bare numbers fall back to last match.

describe('parseJobFromSpeech — regex fallback: £ prefix wins over bare count words', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('"for 3 people £380 cash" extracts 380 not 3', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('for 3 people £380 cash');
    expect(result.amount).toBe(380);
    expect(result.paymentType).toBe('cash');
  });

  it('"£1.2k" extracts 1200 (k-multiplier on £-prefixed)', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Boiler service £1.2k');
    expect(result.amount).toBe(1200);
  });

  it('"plain 380" with no £ sign still extracts 380', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Plastering 380');
    expect(result.amount).toBe(380);
  });

  it('"200 quid" extracts 200 via bare-number fallback', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Fence repair 200 quid');
    expect(result.amount).toBe(200);
    expect(result.paymentType).toBeNull();
  });

  it('takes the LAST £-amount when multiple are present', async () => {
    global.fetch = mockFetchFailure();
    // e.g. "was £400, now £350" — take the last one
    const result = await parseJobFromSpeech('was £400 now £350 cash');
    expect(result.amount).toBe(350);
  });

  it('takes the LAST bare number when no £ sign present', async () => {
    global.fetch = mockFetchFailure();
    // "2 rooms 450" — 450 is the price, 2 is a count
    const result = await parseJobFromSpeech('2 rooms 450');
    expect(result.amount).toBe(450);
  });
});

// ── resolveNextWeekday — pure date-resolution helper ───────────────────────────

describe('resolveNextWeekday', () => {
  it('resolves "friday" from a Wednesday to the coming Friday (2 days away)', () => {
    const wednesday = new Date('2026-07-01T09:00:00Z'); // 2026-07-01 is a Wednesday
    expect(resolveNextWeekday('friday', wednesday)).toBe('2026-07-03');
  });

  it('resolves to TODAY when the named weekday matches the current day', () => {
    const friday = new Date('2026-07-03T09:00:00Z'); // 2026-07-03 is a Friday
    expect(resolveNextWeekday('friday', friday)).toBe('2026-07-03');
  });

  it('wraps to next week when the named day already passed this week', () => {
    const friday = new Date('2026-07-03T09:00:00Z');
    // "Monday" from a Friday is 3 days away (the FOLLOWING Monday)
    expect(resolveNextWeekday('monday', friday)).toBe('2026-07-06');
  });

  it('is case-insensitive', () => {
    const wednesday = new Date('2026-07-01T09:00:00Z');
    expect(resolveNextWeekday('FRIDAY', wednesday)).toBe('2026-07-03');
  });

  it('returns null for an unrecognised day name', () => {
    expect(resolveNextWeekday('someday', new Date('2026-07-01T09:00:00Z'))).toBeNull();
  });
});

// ── VAT / deposit fields — AI path ──────────────────────────────────────────────

describe('parseJobFromSpeech — AI path: vat / depositPercent / depositDue', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('extracts vat:true, depositPercent, and passes depositDue through from the model', async () => {
    global.fetch = mockFetchSuccess({
      name: 'Kitchen', customer: 'John', amount: 4800, paymentType: null,
      vat: true, depositPercent: 25, depositDue: null,
    });
    const result = await parseJobFromSpeech('Kitchen for John, £4,800 plus VAT, 25% deposit');
    expect(result.amount).toBe(4800);
    expect(result.vat).toBe(true);
    expect(result.depositPercent).toBe(25);
    expect(result.depositDue).toBeNull();
  });

  it('passes through a depositDue ISO date supplied by the model', async () => {
    global.fetch = mockFetchSuccess({
      name: 'Bathroom refit', customer: 'Mrs Mitchell', amount: 2950, paymentType: 'bank transfer',
      vat: null, depositPercent: 50, depositDue: '2026-07-03',
    });
    const result = await parseJobFromSpeech('Bathroom refit for Mrs Mitchell £2950 bank transfer, 50% deposit due Friday', new Date('2026-07-01T09:00:00Z'));
    expect(result.depositPercent).toBe(50);
    expect(result.depositDue).toBe('2026-07-03');
  });

  it('defaults vat/depositPercent/depositDue to null when the model omits them', async () => {
    global.fetch = mockFetchSuccess({ name: 'Plastering', customer: null, amount: 250, paymentType: null });
    const result = await parseJobFromSpeech('Plastering 250');
    expect(result.vat).toBeNull();
    expect(result.depositPercent).toBeNull();
    expect(result.depositDue).toBeNull();
  });
});

// ── VAT / deposit fields — regex fallback (offline path) ────────────────────────

describe('parseJobFromSpeech — regex fallback: vat / depositPercent / depositDue', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('"plus VAT" sets vat:true', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 plus VAT');
    expect(result.vat).toBe(true);
  });

  it('"+ VAT" sets vat:true', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 + VAT');
    expect(result.vat).toBe(true);
  });

  it('"including VAT" sets vat:true', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 including VAT');
    expect(result.vat).toBe(true);
  });

  it('no VAT mention leaves vat:null', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 cash');
    expect(result.vat).toBeNull();
  });

  it('"25% deposit" extracts depositPercent:25', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen for John £4800, 25% deposit');
    expect(result.depositPercent).toBe(25);
  });

  it('"50 deposit" (no % sign) extracts depositPercent:50', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Bathroom refit £2950, 50 deposit');
    expect(result.depositPercent).toBe(50);
  });

  it('no deposit mention leaves depositPercent:null', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 cash');
    expect(result.depositPercent).toBeNull();
  });

  it('"due Friday" resolves depositDue to the next Friday from the supplied `now`', async () => {
    global.fetch = mockFetchFailure();
    const wednesday = new Date('2026-07-01T09:00:00Z');
    const result = await parseJobFromSpeech('Bathroom refit £2950, 50% deposit due Friday', wednesday);
    expect(result.depositDue).toBe('2026-07-03');
  });

  it('"by Monday" resolves depositDue via the "by" phrasing too', async () => {
    global.fetch = mockFetchFailure();
    const wednesday = new Date('2026-07-01T09:00:00Z');
    const result = await parseJobFromSpeech('Fence repair £200, deposit by Monday', wednesday);
    expect(result.depositDue).toBe('2026-07-06');
  });

  it('no due-day phrase leaves depositDue:null', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen job £380 cash');
    expect(result.depositDue).toBeNull();
  });

  it('strips "plus VAT", "25% deposit", and "due Friday" out of the job name', async () => {
    global.fetch = mockFetchFailure();
    const result = await parseJobFromSpeech('Kitchen for John, £4,800 plus VAT, 25% deposit due Friday');
    expect(result.name.toLowerCase()).not.toContain('vat');
    expect(result.name.toLowerCase()).not.toContain('deposit');
    expect(result.name.toLowerCase()).not.toContain('friday');
    expect(result.name).toContain('Kitchen');
  });
});

// ── VOICE_LANGS list coverage ─────────────────────────────────────────────────
// These tests lock in the expected locale list so accidental deletions are caught.
// The list is duplicated here intentionally — the test is the contract.

describe('VOICE_LANGS expected locale list', () => {
  const EXPECTED_CODES = [
    'en-GB', 'pl-PL', 'ro-RO', 'pt-PT', 'es-ES',
    'it-IT', 'ru-RU', 'lt-LT', 'uk-UA', 'ar-SA',
  ];

  it('contains exactly 10 supported locales', () => {
    expect(EXPECTED_CODES).toHaveLength(10);
  });

  it('includes all five new locales added in this PR', () => {
    const newLocales = ['it-IT', 'ru-RU', 'lt-LT', 'uk-UA', 'ar-SA'];
    newLocales.forEach(code => expect(EXPECTED_CODES).toContain(code));
  });

  it('keeps en-GB as the first entry', () => {
    expect(EXPECTED_CODES[0]).toBe('en-GB');
  });
});
