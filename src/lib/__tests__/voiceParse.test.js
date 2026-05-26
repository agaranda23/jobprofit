/**
 * voiceParse — unit tests for multilingual job transcript parsing.
 *
 * fetch is mocked to avoid hitting the Netlify AI proxy.
 * The mock mimics the shape of a real Claude response:
 *   { content: [{ type: 'text', text: '<JSON string>' }] }
 *
 * Two code paths are tested:
 *   1. AI path: fetch succeeds, response contains a valid JSON block.
 *   2. Regex fallback path: fetch throws (simulates offline / proxy down).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseJobFromSpeech } from '../voiceParse.js';

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
    expect(result).toEqual({ name: '', customer: null, amount: null, paymentType: null });
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
});
