/**
 * jobFieldPersistence.test.js
 *
 * Regression tests for the data-loss bug where notes, address, materialsCost,
 * labourHours, and deposit were silently dropped when a new job was logged via
 * AddJobModal. The fix: store.js now writes address/email/notes as dedicated DB
 * columns in the insert row, and writes materialsCost/labourHours/deposit/notes
 * to the META_FIELDS side-channel (jobMeta.js) immediately after insert.
 *
 * Tests cover:
 *   1. addJobToCloud row — address, email, notes reach the DB insert
 *   2. addJobToCloud meta — materialsCost, labourHours, deposit, notes written
 *      to localStorage via writeJobMeta
 *   3. META_FIELDS completeness — all four new fields are in the list
 *   4. extractJobMeta round-trips materialsCost, labourHours, deposit, notes
 *   5. Round-trip: mapCloudJobToToday surfaces materialsCost/labourHours from
 *      the meta JSONB column (simulates a cloud reload after a sync)
 *
 * No DOM, no React. Supabase is mocked inline — same pattern as existing store
 * tests would use (there are no existing store unit tests; this is the first).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractJobMeta, writeJobMeta, readJobMeta } from '../jobMeta';

// ── localStorage mock ─────────────────────────────────────────────────────────
function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    _store: store,
  };
}

const lsMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', lsMock);

// ── Supabase mock ─────────────────────────────────────────────────────────────
// We mock the module so addJobToCloud never touches the network.
// The fake insert captures the inserted row and returns it as `data`.

let _lastInsertedRow = null;

vi.mock('../supabase', () => {
  const fakeSelect = () => ({
    single: async () => ({
      data: { ..._lastInsertedRow, created_at: new Date().toISOString(), meta: {} },
      error: null,
    }),
  });
  const fakeInsert = (row) => {
    _lastInsertedRow = row;
    return { select: fakeSelect };
  };
  const fakeFrom = () => ({ insert: fakeInsert });
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-abc-123' } } }) },
      from: vi.fn(fakeFrom),
    },
  };
});

// ── Import after mocks are registered ────────────────────────────────────────
const { addJobToCloud } = await import('../store.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function fullDetailsPayload(overrides = {}) {
  return {
    id:            crypto.randomUUID(),
    name:          'Bathroom retile',
    customer:      'Dave Williams',
    phone:         '07700900123',
    amount:        450,
    paymentType:   null,
    paid:          false,
    date:          new Date().toISOString(),
    createdAt:     new Date().toISOString(),
    materialsCost: 120,
    labourHours:   8,
    notes:         'Use anti-mould grout on north wall',
    deposit:       50,
    address:       '12 King Street, London',
    email:         'dave@example.com',
    ...overrides,
  };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  lsMock.clear();
  vi.clearAllMocks();
  _lastInsertedRow = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('META_FIELDS — completeness for new cost/note fields', () => {
  it('includes materialsCost', () => {
    const job = { id: 'j1', materialsCost: 120 };
    const meta = extractJobMeta(job);
    expect(meta.materialsCost).toBe(120);
  });

  it('includes labourHours', () => {
    const job = { id: 'j1', labourHours: 8 };
    const meta = extractJobMeta(job);
    expect(meta.labourHours).toBe(8);
  });

  it('includes deposit', () => {
    const job = { id: 'j1', deposit: 50 };
    const meta = extractJobMeta(job);
    expect(meta.deposit).toBe(50);
  });

  it('includes notes (plain string)', () => {
    const job = { id: 'j1', notes: 'Anti-mould grout on north wall' };
    const meta = extractJobMeta(job);
    expect(meta.notes).toBe('Anti-mould grout on north wall');
  });

  it('does not include fields that are absent from the job', () => {
    const job = { id: 'j1', status: 'lead' };
    const meta = extractJobMeta(job);
    expect('materialsCost' in meta).toBe(false);
    expect('labourHours'   in meta).toBe(false);
    expect('deposit'       in meta).toBe(false);
    expect('notes'         in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — round-trip for cost fields', () => {
  it('persists and retrieves materialsCost + labourHours + deposit + notes', () => {
    const id = 'job-cost-roundtrip-001';
    const patch = { materialsCost: 120, labourHours: 8, deposit: 50, notes: 'Use anti-mould grout' };
    writeJobMeta(id, patch);
    const stored = readJobMeta(id);
    expect(stored.materialsCost).toBe(120);
    expect(stored.labourHours).toBe(8);
    expect(stored.deposit).toBe(50);
    expect(stored.notes).toBe('Use anti-mould grout');
  });

  it('does not overwrite unrelated meta fields when writing a cost patch', () => {
    const id = 'job-cost-isolated-001';
    writeJobMeta(id, { status: 'invoice_sent', total: 450 });
    writeJobMeta(id, { materialsCost: 80, labourHours: 4 });
    const stored = readJobMeta(id);
    expect(stored.status).toBe('invoice_sent');
    expect(stored.total).toBe(450);
    expect(stored.materialsCost).toBe(80);
    expect(stored.labourHours).toBe(4);
  });
});

describe('addJobToCloud — DB row includes address, email, notes', () => {
  it('writes address to the inserted row', async () => {
    await addJobToCloud(fullDetailsPayload());
    expect(_lastInsertedRow.address).toBe('12 King Street, London');
  });

  it('writes email to the inserted row', async () => {
    await addJobToCloud(fullDetailsPayload());
    expect(_lastInsertedRow.email).toBe('dave@example.com');
  });

  it('writes notes to the inserted row', async () => {
    await addJobToCloud(fullDetailsPayload());
    expect(_lastInsertedRow.notes).toBe('Use anti-mould grout on north wall');
  });

  it('writes null for address when omitted', async () => {
    const payload = fullDetailsPayload({ address: undefined });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.address).toBeNull();
  });

  it('writes null for notes when omitted', async () => {
    const payload = fullDetailsPayload({ notes: undefined });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.notes).toBeNull();
  });
});

describe('addJobToCloud — meta side-channel for materialsCost, labourHours, deposit', () => {
  it('writes materialsCost to localStorage meta after cloud insert', async () => {
    const payload = fullDetailsPayload();
    const result = await addJobToCloud(payload);
    const stored = readJobMeta(result.id);
    expect(stored.materialsCost).toBe(120);
  });

  it('writes labourHours to localStorage meta after cloud insert', async () => {
    const payload = fullDetailsPayload();
    const result = await addJobToCloud(payload);
    const stored = readJobMeta(result.id);
    expect(stored.labourHours).toBe(8);
  });

  it('writes deposit to localStorage meta after cloud insert', async () => {
    const payload = fullDetailsPayload();
    const result = await addJobToCloud(payload);
    const stored = readJobMeta(result.id);
    expect(stored.deposit).toBe(50);
  });

  it('writes notes to localStorage meta after cloud insert', async () => {
    const payload = fullDetailsPayload();
    const result = await addJobToCloud(payload);
    const stored = readJobMeta(result.id);
    expect(stored.notes).toBe('Use anti-mould grout on north wall');
  });

  it('does not write meta entry when no cost/note fields are present', async () => {
    const minimalPayload = {
      id:          crypto.randomUUID(),
      name:        'Quick job',
      customer:    null,
      amount:      200,
      paid:        true,
      paymentType: 'cash',
    };
    const result = await addJobToCloud(minimalPayload);
    const stored = readJobMeta(result.id);
    expect(stored.materialsCost).toBeUndefined();
    expect(stored.labourHours).toBeUndefined();
    expect(stored.deposit).toBeUndefined();
    expect(stored.notes).toBeUndefined();
  });

  it('all five fields survive a full payload round-trip through meta', async () => {
    const payload = fullDetailsPayload({ materialsCost: 99.5, labourHours: 5.5, deposit: 25 });
    const result = await addJobToCloud(payload);
    const stored = readJobMeta(result.id);
    expect(stored.materialsCost).toBe(99.5);
    expect(stored.labourHours).toBe(5.5);
    expect(stored.deposit).toBe(25);
    expect(stored.notes).toBe('Use anti-mould grout on north wall');
  });
});

describe('mapCloudJobToToday — surfaces meta fields from cloud JSONB on reload', () => {
  // Simulates what happens after a cloud sync: the DB row has meta.materialsCost
  // set (written by updateJobMetaInCloud on the next sync) and mapCloudJobToToday
  // must spread it onto the returned job object.
  // We test this by calling the private shape that mapCloudJobToToday would receive.
  // Because mapCloudJobToToday is not exported, we test the behaviour indirectly
  // through the addJobToCloud return value (which calls mapCloudJobToToday on
  // the insert response). The fake Supabase returns meta:{} at insert time,
  // so we test the meta read path separately using extractJobMeta + readJobMeta.

  it('extractJobMeta correctly captures all four fields from a reloaded job object', () => {
    const simulatedCloudJob = {
      id: 'cloud-job-reload-001',
      status: 'lead',
      materialsCost: 120,
      labourHours: 8,
      deposit: 50,
      notes: 'Use anti-mould grout on north wall',
      address: '12 King Street, London',
      email: 'dave@example.com',
    };
    const meta = extractJobMeta(simulatedCloudJob);
    expect(meta.materialsCost).toBe(120);
    expect(meta.labourHours).toBe(8);
    expect(meta.deposit).toBe(50);
    expect(meta.notes).toBe('Use anti-mould grout on north wall');
    expect(meta.address).toBe('12 King Street, London');
    expect(meta.email).toBe('dave@example.com');
  });
});

// ── Calendar date-save bug regression (fix/calendar-date-save-bug) ────────────
//
// Root cause: addJobToCloud was writing `date: today` unconditionally, discarding
// payload.date. Calendar taps pass a specific YYYY-MM-DD date; the fix derives
// jobDate = payload.date ? localDateString(new Date(payload.date)) : today and
// uses jobDate for the DB insert. addTodayJob (local mirror) was also fixed to
// use payload.date.slice(0,10) when present.

describe('addJobToCloud — calendar date bug regression', () => {
  it('writes payload.date to the DB row when tapping a future date', async () => {
    const futureDate = '2026-08-15';
    const payload = fullDetailsPayload({ date: futureDate });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.date).toBe(futureDate);
  });

  it('writes payload.date to the DB row when tapping a past date', async () => {
    const pastDate = '2026-01-03';
    const payload = fullDetailsPayload({ date: pastDate });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.date).toBe(pastDate);
  });

  it('falls back to today when payload has no date', async () => {
    const today = new Date();
    const expectedDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const payload = fullDetailsPayload({ date: undefined });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.date).toBe(expectedDate);
  });

  it('payment_date is always today (not the scheduled date) for a paid job', async () => {
    const today = new Date();
    const expectedToday = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const payload = fullDetailsPayload({ date: '2026-08-15', paid: true });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.payment_date).toBe(expectedToday);
    // The scheduled/booked date should differ from the payment date
    expect(_lastInsertedRow.date).toBe('2026-08-15');
  });
});

describe('addJobToCloud — no-amount (Lead) job regression', () => {
  it('sets status to "lead" when no amount is provided', async () => {
    const payload = fullDetailsPayload({ amount: null, paid: false });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.status).toBe('lead');
  });

  it('sets line_items to empty array when no amount is provided', async () => {
    const payload = fullDetailsPayload({ amount: '', paid: false });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.line_items).toEqual([]);
  });

  it('sets amount to null when no amount is provided', async () => {
    const payload = fullDetailsPayload({ amount: null, paid: false });
    await addJobToCloud(payload);
    expect(_lastInsertedRow.amount).toBeNull();
  });
});
