/**
 * Unit tests for Phase H — realtime.js subscription helper.
 *
 * No DOM, no React, no live Supabase client. The Supabase channel API is
 * mocked inline — this matches the codebase convention established in
 * jobMetaCloud.test.js (mirror functions for cloud-dependent paths).
 *
 * Supabase realtime integration (events actually firing when a DB row changes)
 * is an E2E concern covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   A. subscribeToJobs — returns an unsubscribe function
 *   B. subscribeToJobs — no-ops cleanly when userId is missing
 *   C. Channel setup — correct event/schema/table/filter passed to .on()
 *   D. onChange — called when the channel fires a change event
 *   E. onReconnect — called when channel status becomes 'SUBSCRIBED'
 *   F. onReconnect — not called on other statuses (e.g. 'CHANNEL_ERROR')
 *   G. unsub — calls supabase.removeChannel with the channel reference
 *   H. Signature detection logic — mirrors the AppShell handler inline
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase channel mock factory ────────────────────────────────────────────
// Mirrors the supabase-js channel API surface used by subscribeToJobs.
// We do NOT import src/lib/supabase.js because createClient() runs at module
// load and requires VITE_SUPABASE_URL / VITE_SUPABASE_KEY env vars.

function makeChannelMock() {
  const mock = {
    _onHandler: null,
    _subscribeCallback: null,
    on: vi.fn((_event, _filter, handler) => {
      mock._onHandler = handler;
      return mock; // chainable
    }),
    subscribe: vi.fn((callback) => {
      mock._subscribeCallback = callback;
      return mock; // chainable
    }),
    // Helpers to simulate events from tests
    fireChange: (payload) => mock._onHandler?.(payload),
    fireStatus: (status) => mock._subscribeCallback?.(status),
  };
  return mock;
}

function makeSupabaseMock() {
  let lastChannel = null;
  const mock = {
    channel: vi.fn((name) => {
      lastChannel = makeChannelMock();
      lastChannel._name = name;
      return lastChannel;
    }),
    removeChannel: vi.fn(() => Promise.resolve()),
    getLastChannel: () => lastChannel,
  };
  return mock;
}

// ── Inline mirror of subscribeToJobs ─────────────────────────────────────────
// Mirrors production: src/lib/realtime.js — subscribeToJobs()
// Accepts the supabase client as a parameter so the mock can be injected.

function subscribeToJobsMirror(supabase, userId, onChange, onReconnect) {
  if (!userId) {
    return () => {};
  }

  const channelName = `jobs:user-${userId}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => { onChange(payload); }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && typeof onReconnect === 'function') {
        onReconnect();
      }
    });

  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ─────────────────────────────────────────────────────────────────────────────

let supabaseMock;

beforeEach(() => {
  supabaseMock = makeSupabaseMock();
  vi.clearAllMocks();
});

// ─── A. Returns an unsubscribe function ──────────────────────────────────────

describe('subscribeToJobs — returns unsub function', () => {
  it('returns a function', () => {
    const unsub = subscribeToJobsMirror(supabaseMock, 'user-123', () => {}, undefined);
    expect(typeof unsub).toBe('function');
  });

  it('calls supabase.channel() exactly once', () => {
    subscribeToJobsMirror(supabaseMock, 'user-123', () => {}, undefined);
    expect(supabaseMock.channel).toHaveBeenCalledTimes(1);
  });
});

// ─── B. No-op when userId is missing ─────────────────────────────────────────

describe('subscribeToJobs — no-op on missing userId', () => {
  it('returns a no-op function when userId is null', () => {
    const unsub = subscribeToJobsMirror(supabaseMock, null, () => {}, undefined);
    expect(typeof unsub).toBe('function');
    // Should not throw
    expect(() => unsub()).not.toThrow();
  });

  it('does NOT call supabase.channel() when userId is null', () => {
    subscribeToJobsMirror(supabaseMock, null, () => {}, undefined);
    expect(supabaseMock.channel).not.toHaveBeenCalled();
  });

  it('does NOT call supabase.channel() when userId is empty string', () => {
    subscribeToJobsMirror(supabaseMock, '', () => {}, undefined);
    expect(supabaseMock.channel).not.toHaveBeenCalled();
  });
});

// ─── C. Channel setup — correct args ─────────────────────────────────────────

describe('subscribeToJobs — channel setup', () => {
  it('uses channel name jobs:user-<userId>', () => {
    const userId = 'abc-123';
    subscribeToJobsMirror(supabaseMock, userId, () => {}, undefined);
    expect(supabaseMock.channel).toHaveBeenCalledWith(`jobs:user-${userId}`);
  });

  it('calls .on() with postgres_changes, wildcard event, public.jobs, user_id filter', () => {
    const userId = 'abc-123';
    subscribeToJobsMirror(supabaseMock, userId, () => {}, undefined);
    const ch = supabaseMock.getLastChannel();
    expect(ch.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${userId}`,
      }),
      expect.any(Function)
    );
  });

  it('calls .subscribe()', () => {
    subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, undefined);
    const ch = supabaseMock.getLastChannel();
    expect(ch.subscribe).toHaveBeenCalledTimes(1);
  });
});

// ─── D. onChange called on channel change event ───────────────────────────────

describe('subscribeToJobs — onChange handler', () => {
  it('calls onChange with the payload when a change event fires', () => {
    const onChange = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', onChange, undefined);
    const ch = supabaseMock.getLastChannel();
    const payload = { eventType: 'UPDATE', new: { id: 'j1', customer_name: 'Bob' } };
    ch.fireChange(payload);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(payload);
  });

  it('calls onChange for INSERT events', () => {
    const onChange = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', onChange, undefined);
    const ch = supabaseMock.getLastChannel();
    ch.fireChange({ eventType: 'INSERT', new: { id: 'j2' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('calls onChange for DELETE events', () => {
    const onChange = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', onChange, undefined);
    const ch = supabaseMock.getLastChannel();
    ch.fireChange({ eventType: 'DELETE', old: { id: 'j3' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ─── E. onReconnect called on SUBSCRIBED status ───────────────────────────────

describe('subscribeToJobs — onReconnect', () => {
  it('calls onReconnect when status is SUBSCRIBED', () => {
    const onReconnect = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, onReconnect);
    const ch = supabaseMock.getLastChannel();
    ch.fireStatus('SUBSCRIBED');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('calls onReconnect on second SUBSCRIBED (reconnect scenario)', () => {
    const onReconnect = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, onReconnect);
    const ch = supabaseMock.getLastChannel();
    ch.fireStatus('SUBSCRIBED');
    ch.fireStatus('CHANNEL_ERROR');
    ch.fireStatus('SUBSCRIBED');
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it('does not call onReconnect when onReconnect is not provided (undefined)', () => {
    // Should not throw even without onReconnect
    const onChange = vi.fn();
    expect(() => {
      subscribeToJobsMirror(supabaseMock, 'user-1', onChange, undefined);
      const ch = supabaseMock.getLastChannel();
      ch.fireStatus('SUBSCRIBED');
    }).not.toThrow();
  });
});

// ─── F. onReconnect NOT called on non-SUBSCRIBED statuses ────────────────────

describe('subscribeToJobs — onReconnect not triggered on other statuses', () => {
  it('does not call onReconnect on CHANNEL_ERROR', () => {
    const onReconnect = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, onReconnect);
    const ch = supabaseMock.getLastChannel();
    ch.fireStatus('CHANNEL_ERROR');
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('does not call onReconnect on CLOSED', () => {
    const onReconnect = vi.fn();
    subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, onReconnect);
    const ch = supabaseMock.getLastChannel();
    ch.fireStatus('CLOSED');
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

// ─── G. unsub calls removeChannel ────────────────────────────────────────────

describe('subscribeToJobs — unsub', () => {
  it('calls supabase.removeChannel when unsub is called', async () => {
    const unsub = subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, undefined);
    const ch = supabaseMock.getLastChannel();
    unsub();
    // Allow the micro-task from removeChannel().catch() to settle
    await Promise.resolve();
    expect(supabaseMock.removeChannel).toHaveBeenCalledTimes(1);
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(ch);
  });

  it('does not throw if removeChannel rejects (best-effort teardown)', async () => {
    supabaseMock.removeChannel = vi.fn(() => Promise.reject(new Error('Teardown failed')));
    const unsub = subscribeToJobsMirror(supabaseMock, 'user-1', () => {}, undefined);
    unsub();
    // Give the rejected promise a tick to settle — should not propagate
    await Promise.resolve();
    // No assertion needed — if it throws, the test itself fails
  });
});

// ─── H. Signature detection logic (AppShell handler inline mirror) ───────────
//
// The AppShell Realtime handler detects a remote signature by comparing the
// previous job state (from jobsRef) to the incoming payload. This tests the
// detection logic in isolation — no React, no DOM.

function detectRemoteSignature(payload, previousJobs) {
  if (payload.eventType !== 'UPDATE' || !payload.new) return null;
  const incoming = payload.new;
  const incomingMeta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
  const hasRemoteSig = incomingMeta.acceptedSignature && incomingMeta.acceptedSource === 'remote';
  if (!hasRemoteSig) return null;
  const prev = previousJobs.find(j => j.id === incoming.id);
  const prevHadSig = !!(prev?.acceptedSignature);
  if (prevHadSig) return null;
  return incoming.customer_name || prev?.name || 'Customer';
}

describe('detectRemoteSignature — AppShell toast logic', () => {
  const BASE_PAYLOAD = {
    eventType: 'UPDATE',
    new: {
      id: 'j-uuid-1',
      customer_name: 'Sarah Mitchell',
      meta: { acceptedSignature: 'data:image/png;base64,...', acceptedSource: 'remote' },
    },
  };

  it('returns customer name when signature transitions null → set with acceptedSource=remote', () => {
    const prevJobs = [{ id: 'j-uuid-1', name: 'Sarah Mitchell', acceptedSignature: null }];
    const name = detectRemoteSignature(BASE_PAYLOAD, prevJobs);
    expect(name).toBe('Sarah Mitchell');
  });

  it('returns null when the job already had a signature (no transition)', () => {
    const prevJobs = [{ id: 'j-uuid-1', acceptedSignature: 'data:image/png;base64,...' }];
    const name = detectRemoteSignature(BASE_PAYLOAD, prevJobs);
    expect(name).toBeNull();
  });

  it('returns null when acceptedSource is not remote (e.g. in-person)', () => {
    const payload = {
      eventType: 'UPDATE',
      new: {
        id: 'j-uuid-1',
        customer_name: 'Bob',
        meta: { acceptedSignature: 'data:...', acceptedSource: 'in-person' },
      },
    };
    const prevJobs = [{ id: 'j-uuid-1', acceptedSignature: null }];
    expect(detectRemoteSignature(payload, prevJobs)).toBeNull();
  });

  it('returns null when event is INSERT (not an update)', () => {
    const payload = { eventType: 'INSERT', new: { id: 'j-uuid-2', customer_name: 'Bob', meta: { acceptedSignature: 'sig', acceptedSource: 'remote' } } };
    expect(detectRemoteSignature(payload, [])).toBeNull();
  });

  it('returns null when event is DELETE', () => {
    const payload = { eventType: 'DELETE', old: { id: 'j-uuid-2' } };
    expect(detectRemoteSignature(payload, [])).toBeNull();
  });

  it('returns null when meta has no acceptedSignature', () => {
    const payload = {
      eventType: 'UPDATE',
      new: { id: 'j-uuid-1', customer_name: 'Bob', meta: { acceptedSource: 'remote' } },
    };
    expect(detectRemoteSignature(payload, [{ id: 'j-uuid-1', acceptedSignature: null }])).toBeNull();
  });

  it('falls back to prev.name when customer_name is not on the incoming row', () => {
    const payload = {
      eventType: 'UPDATE',
      new: { id: 'j-uuid-1', meta: { acceptedSignature: 'sig', acceptedSource: 'remote' } },
    };
    const prevJobs = [{ id: 'j-uuid-1', name: 'Fallback Name', acceptedSignature: null }];
    expect(detectRemoteSignature(payload, prevJobs)).toBe('Fallback Name');
  });

  it('falls back to "Customer" when neither customer_name nor prev.name exists', () => {
    const payload = {
      eventType: 'UPDATE',
      new: { id: 'j-uuid-1', meta: { acceptedSignature: 'sig', acceptedSource: 'remote' } },
    };
    expect(detectRemoteSignature(payload, [])).toBe('Customer');
  });

  it('returns null when payload.new is absent', () => {
    const payload = { eventType: 'UPDATE' };
    expect(detectRemoteSignature(payload, [])).toBeNull();
  });

  it('handles job not found in previousJobs (new job receiving a sig)', () => {
    // prevHadSig is false when prev is undefined — should fire toast
    const name = detectRemoteSignature(BASE_PAYLOAD, []);
    expect(name).toBe('Sarah Mitchell');
  });
});
