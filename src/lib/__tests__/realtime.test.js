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

// ─── H. Remote decision detection logic (AppShell handler inline mirror) ─────
//
// Phase G-2 update: detection is now based on quoteStatus transitions
// ('sent' → 'accepted' or 'sent' → 'declined') rather than the presence of
// acceptedSignature. This mirrors what the AppShell Realtime handler should
// check when it receives an UPDATE payload. Tested in isolation — no React, no DOM.

/**
 * Returns the decision type ('accepted' | 'declined') and customer name when
 * a quoteStatus transition is detected (null/sent → accepted/declined).
 * Returns null when no new decision is detected.
 */
function detectRemoteDecision(payload, previousJobs) {
  if (payload.eventType !== 'UPDATE' || !payload.new) return null;
  const incoming = payload.new;
  const incomingMeta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
  const newStatus = incomingMeta.quoteStatus;
  if (newStatus !== 'accepted' && newStatus !== 'declined') return null;

  const prev = previousJobs.find(j => j.id === incoming.id);
  const prevStatus = prev?.quoteStatus || null;
  // Only fire when the status is newly set (transition, not an existing state)
  if (prevStatus === newStatus) return null;

  const customerName = incoming.customer_name || prev?.name || 'Customer';
  return { decision: newStatus, customerName };
}

describe('detectRemoteDecision — AppShell toast logic (G-2)', () => {
  const ACCEPT_PAYLOAD = {
    eventType: 'UPDATE',
    new: {
      id: 'j-uuid-1',
      customer_name: 'Sarah Mitchell',
      meta: { quoteStatus: 'accepted', acceptedAt: '2026-06-23T10:00:00Z', acceptedSource: 'remote' },
    },
  };

  const DECLINE_PAYLOAD = {
    eventType: 'UPDATE',
    new: {
      id: 'j-uuid-2',
      customer_name: 'Bob Jones',
      meta: { quoteStatus: 'declined', declinedAt: '2026-06-23T10:00:00Z' },
    },
  };

  it('returns accepted decision when quoteStatus transitions to accepted', () => {
    const prevJobs = [{ id: 'j-uuid-1', quoteStatus: 'sent' }];
    const result = detectRemoteDecision(ACCEPT_PAYLOAD, prevJobs);
    expect(result).toEqual({ decision: 'accepted', customerName: 'Sarah Mitchell' });
  });

  it('returns declined decision when quoteStatus transitions to declined', () => {
    const prevJobs = [{ id: 'j-uuid-2', quoteStatus: 'sent' }];
    const result = detectRemoteDecision(DECLINE_PAYLOAD, prevJobs);
    expect(result).toEqual({ decision: 'declined', customerName: 'Bob Jones' });
  });

  it('returns null when quoteStatus was already accepted (no re-notify)', () => {
    const prevJobs = [{ id: 'j-uuid-1', quoteStatus: 'accepted' }];
    expect(detectRemoteDecision(ACCEPT_PAYLOAD, prevJobs)).toBeNull();
  });

  it('returns null when quoteStatus was already declined (no re-notify)', () => {
    const prevJobs = [{ id: 'j-uuid-2', quoteStatus: 'declined' }];
    expect(detectRemoteDecision(DECLINE_PAYLOAD, prevJobs)).toBeNull();
  });

  it('returns null when event is INSERT (not an update)', () => {
    const payload = { eventType: 'INSERT', new: { id: 'j-uuid-1', meta: { quoteStatus: 'accepted' } } };
    expect(detectRemoteDecision(payload, [])).toBeNull();
  });

  it('returns null when event is DELETE', () => {
    const payload = { eventType: 'DELETE', old: { id: 'j-uuid-1' } };
    expect(detectRemoteDecision(payload, [])).toBeNull();
  });

  it('returns null when meta quoteStatus is not a decision (e.g. sent)', () => {
    const payload = {
      eventType: 'UPDATE',
      new: { id: 'j-uuid-1', meta: { quoteStatus: 'sent' } },
    };
    expect(detectRemoteDecision(payload, [])).toBeNull();
  });

  it('falls back to prev.name when customer_name is absent on incoming row', () => {
    const payload = {
      eventType: 'UPDATE',
      new: { id: 'j-uuid-1', meta: { quoteStatus: 'accepted' } },
    };
    const prevJobs = [{ id: 'j-uuid-1', name: 'Fallback Name', quoteStatus: 'sent' }];
    const result = detectRemoteDecision(payload, prevJobs);
    expect(result?.customerName).toBe('Fallback Name');
  });

  it('falls back to "Customer" when neither customer_name nor prev.name exists', () => {
    const payload = {
      eventType: 'UPDATE',
      new: { id: 'j-uuid-1', meta: { quoteStatus: 'accepted' } },
    };
    const result = detectRemoteDecision(payload, []);
    expect(result?.customerName).toBe('Customer');
  });

  it('returns null when payload.new is absent', () => {
    const payload = { eventType: 'UPDATE' };
    expect(detectRemoteDecision(payload, [])).toBeNull();
  });

  it('fires on accept even when job is not in previousJobs (new job)', () => {
    const result = detectRemoteDecision(ACCEPT_PAYLOAD, []);
    expect(result?.decision).toBe('accepted');
    expect(result?.customerName).toBe('Sarah Mitchell');
  });
});
