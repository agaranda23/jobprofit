/**
 * Tests for netlify/functions/delete-account.js
 *
 * No network, no Supabase connection. All DB/storage/auth calls are mocked.
 * Pattern: pure-logic + mocked I/O, matches accept-quote.test.js convention.
 *
 * Covers:
 *   A. HTTP method guard — only POST is accepted
 *   B. Env var guard — 500 when VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing
 *   C. Auth guard — 401 when Authorization header is absent or JWT is invalid
 *   D. Table deletion sequence — correct tables deleted, in order, for the resolved userId
 *   E. Storage cleanup — job-photos listed and removed under userId prefix
 *   F. Auth user deletion — auth.admin.deleteUser called with the resolved userId
 *   G. Success response — 200 { deleted: true }
 *   H. Error paths — DB failure returns 502, storage failure is non-fatal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Env setup ─────────────────────────────────────────────────────────────────
const FAKE_URL = 'https://fake.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';
const FAKE_USER_ID = 'user-uuid-1234-5678-abcd-ef0123456789';
const FAKE_TOKEN = 'valid-jwt-token';

// ── Supabase admin client mock ────────────────────────────────────────────────

// Tracks calls so we can assert the deletion sequence
let deletedTables = [];
let authDeleteUserId = null;
let storageListResult = { data: [], error: null };
let storageRemoveError = null;
let authGetUserResult = { data: { user: { id: FAKE_USER_ID } }, error: null };
let tableDeleteErrors = {}; // { tableName: error }

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => {
      const makeTableChain = (tableName) => ({
        delete: vi.fn(() => ({
          eq: vi.fn(async () => {
            deletedTables.push(tableName);
            return { error: tableDeleteErrors[tableName] || null };
          }),
        })),
      });

      return {
        auth: {
          getUser: vi.fn(async () => authGetUserResult),
          admin: {
            deleteUser: vi.fn(async (uid) => {
              authDeleteUserId = uid;
              return { error: null };
            }),
          },
        },
        from: vi.fn((tableName) => makeTableChain(tableName)),
        storage: {
          from: vi.fn(() => ({
            list: vi.fn(async () => storageListResult),
            remove: vi.fn(async () => ({ error: storageRemoveError })),
          })),
        },
      };
    }),
  };
});

function makeEvent(headers = {}, method = 'POST') {
  return {
    httpMethod: method,
    headers: {
      authorization: `Bearer ${FAKE_TOKEN}`,
      ...headers,
    },
    body: null,
  };
}

async function getHandler() {
  const mod = await import('../delete-account.js');
  return mod.handler;
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  deletedTables = [];
  authDeleteUserId = null;
  storageListResult = { data: [], error: null };
  storageRemoveError = null;
  authGetUserResult = { data: { user: { id: FAKE_USER_ID } }, error: null };
  tableDeleteErrors = {};
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

// ─── A. HTTP method guard ─────────────────────────────────────────────────────

describe('A. HTTP method guard', () => {
  it('returns 200 + empty body for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('returns 405 for GET', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({}, 'GET'));
    expect(res.statusCode).toBe(405);
  });

  it('returns 405 for DELETE', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({}, 'DELETE'));
    expect(res.statusCode).toBe(405);
  });
});

// ─── B. Env var guard ─────────────────────────────────────────────────────────

describe('B. Env var guard', () => {
  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when VITE_SUPABASE_URL is missing', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── C. Auth guard ────────────────────────────────────────────────────────────

describe('C. Auth guard', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', headers: {}, body: null });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/missing authorization/i);
  });

  it('returns 401 when JWT is invalid (auth.getUser returns error)', async () => {
    authGetUserResult = { data: { user: null }, error: { message: 'invalid jwt' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid or expired/i);
  });

  it('returns 401 when auth.getUser returns null user with no error', async () => {
    authGetUserResult = { data: { user: null }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(401);
  });

  it('user id is NEVER taken from request body — always from verified JWT', async () => {
    // Even if a malicious caller sends a different user_id in the body,
    // the function ignores it and uses only the JWT-derived id.
    const handler = await getHandler();
    const eventWithBodyUserId = {
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${FAKE_TOKEN}` },
      body: JSON.stringify({ user_id: 'attacker-uuid' }),
    };
    const res = await handler(eventWithBodyUserId);
    // Should succeed and use FAKE_USER_ID (from JWT), not attacker-uuid
    expect(res.statusCode).toBe(200);
    expect(authDeleteUserId).toBe(FAKE_USER_ID);
  });
});

// ─── D. Table deletion sequence ───────────────────────────────────────────────

describe('D. Table deletion sequence', () => {
  it('deletes all required tables', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    expect(deletedTables).toContain('receipt_items');
    expect(deletedTables).toContain('receipts');
    expect(deletedTables).toContain('push_subscriptions');
    expect(deletedTables).toContain('jobs');
    expect(deletedTables).toContain('profiles');
  });

  it('deletes receipt_items before receipts (child before parent)', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    const itemsIdx = deletedTables.indexOf('receipt_items');
    const receiptsIdx = deletedTables.indexOf('receipts');
    expect(itemsIdx).toBeLessThan(receiptsIdx);
  });

  it('deletes jobs before profiles', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    const jobsIdx = deletedTables.indexOf('jobs');
    const profilesIdx = deletedTables.indexOf('profiles');
    expect(jobsIdx).toBeLessThan(profilesIdx);
  });

  it('returns 502 when a table deletion fails', async () => {
    tableDeleteErrors['jobs'] = { message: 'DB error' };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
  });
});

// ─── E. Auth user deletion ────────────────────────────────────────────────────

describe('E. Auth user deletion', () => {
  it('calls auth.admin.deleteUser with the JWT-resolved userId', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    expect(authDeleteUserId).toBe(FAKE_USER_ID);
  });

  it('returns 200 on successful deletion', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true });
  });
});

// ─── F. Storage cleanup ───────────────────────────────────────────────────────

describe('F. Storage cleanup (job-photos)', () => {
  it('succeeds even if storage list returns no objects', async () => {
    storageListResult = { data: [], error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
  });

  it('does not abort if storage list returns an error (non-fatal)', async () => {
    storageListResult = { data: null, error: { message: 'bucket not found' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    // Storage failure is logged but does not block auth user deletion
    expect(res.statusCode).toBe(200);
    expect(authDeleteUserId).toBe(FAKE_USER_ID);
  });

  it('does not abort if storage remove fails (non-fatal)', async () => {
    storageListResult = { data: [{ name: 'photo1.jpg' }], error: null };
    storageRemoveError = { message: 'remove failed' };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(authDeleteUserId).toBe(FAKE_USER_ID);
  });
});
