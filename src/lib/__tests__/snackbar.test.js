/**
 * Unit tests for src/lib/snackbar.js — JP-LU2
 *
 * Tests the pure reducer (applyAction / insertSorted).
 * No DOM, no React, no timers — just data-in/data-out.
 */

import { describe, it, expect } from 'vitest';
import { applyAction, insertSorted, PRIORITY } from '../snackbar.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeDescriptor(overrides = {}) {
  return {
    id: overrides.id ?? 'snack-1',
    type: overrides.type ?? 'toast',
    message: overrides.message ?? 'Test message',
    dwell: overrides.dwell ?? 2400,
    priority: overrides.priority ?? PRIORITY[overrides.type ?? 'toast'],
    ...overrides,
  };
}

function emptyState() {
  return { queue: [], activeId: null, preempted: null };
}

// ── insertSorted ──────────────────────────────────────────────────────────────

describe('insertSorted', () => {
  it('inserts into an empty queue', () => {
    const d = makeDescriptor({ id: 'a', priority: 8 });
    const result = insertSorted([], d);
    expect(result).toEqual([d]);
  });

  it('places higher priority before lower priority', () => {
    const low  = makeDescriptor({ id: 'low',  priority: 4 });
    const high = makeDescriptor({ id: 'high', priority: 8 });
    const result = insertSorted([low], high);
    expect(result[0].id).toBe('high');
    expect(result[1].id).toBe('low');
  });

  it('maintains FIFO within the same priority (appends after existing same-priority)', () => {
    const first  = makeDescriptor({ id: 'first',  type: 'got-paid', priority: PRIORITY['got-paid'] });
    const second = makeDescriptor({ id: 'second', type: 'got-paid', priority: PRIORITY['got-paid'] });
    const result = insertSorted([first], second);
    expect(result[0].id).toBe('first');
    expect(result[1].id).toBe('second');
  });

  it('does not mutate the input array', () => {
    const original = [makeDescriptor({ id: 'orig', priority: 4 })];
    insertSorted(original, makeDescriptor({ id: 'new', priority: 8 }));
    expect(original).toHaveLength(1);
  });
});

// ── applyAction — ENQUEUE ─────────────────────────────────────────────────────

describe('applyAction — ENQUEUE', () => {
  it('adds a descriptor to an empty queue', () => {
    const d = makeDescriptor({ id: 'a', type: 'toast' });
    const next = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: d });
    expect(next.queue).toHaveLength(1);
    expect(next.queue[0].id).toBe('a');
  });

  it('higher-priority item becomes head of queue', () => {
    const low  = makeDescriptor({ id: 'low',  type: 'cost',    priority: PRIORITY.cost });
    const high = makeDescriptor({ id: 'high', type: 'toast',   priority: PRIORITY.toast });

    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: low });
    const s2 = applyAction(s1, { type: 'ENQUEUE', descriptor: high });

    expect(s2.queue[0].id).toBe('high');
    expect(s2.queue[1].id).toBe('low');
  });

  it('auto-assigns PRIORITY from type when priority field is omitted', () => {
    const d = { id: 'rt', type: 'realtime', message: 'Quote accepted' };
    const next = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: d });
    expect(next.queue[0].priority).toBe(PRIORITY.realtime);
  });
});

// ── applyAction — DWELL_EXPIRED ───────────────────────────────────────────────

describe('applyAction — DWELL_EXPIRED (dwell expiry shifts head)', () => {
  it('removes the head item on dwell expiry', () => {
    const a = makeDescriptor({ id: 'a', priority: 8 });
    const b = makeDescriptor({ id: 'b', priority: 4 });
    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: a });
    const s2 = applyAction(s1, { type: 'ENQUEUE', descriptor: b });
    expect(s2.queue[0].id).toBe('a');

    const s3 = applyAction(s2, { type: 'DWELL_EXPIRED', id: 'a' });
    expect(s3.queue).toHaveLength(1);
    expect(s3.queue[0].id).toBe('b');
    expect(s3.activeId).toBe('b');
  });

  it('queue becomes empty when last item expires', () => {
    const a = makeDescriptor({ id: 'a', priority: 8 });
    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: a });
    const s2 = applyAction(s1, { type: 'DWELL_EXPIRED', id: 'a' });
    expect(s2.queue).toHaveLength(0);
    expect(s2.activeId).toBeNull();
  });
});

// ── applyAction — preemption ──────────────────────────────────────────────────

describe('applyAction — preemption', () => {
  it('enqueueing priority:10 while priority:4 is active cancels it and makes realtime head', () => {
    const cost     = makeDescriptor({ id: 'cost-1',    type: 'cost',     priority: PRIORITY.cost });
    const realtime = makeDescriptor({ id: 'realtime-1', type: 'realtime', priority: PRIORITY.realtime });

    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: cost });
    expect(s1.queue[0].id).toBe('cost-1');

    const s2 = applyAction(s1, { type: 'ENQUEUE', descriptor: realtime });
    expect(s2.queue[0].id).toBe('realtime-1');
    // The cost item should have been requeued behind the realtime item
    expect(s2.queue[1].id).toBe('cost-1');
    // preempted exposes the id of the item that was bumped
    expect(s2.preempted).toBe('cost-1');
  });

  it('does not preempt when new item has equal or lower priority', () => {
    const toast1 = makeDescriptor({ id: 't1', type: 'toast', priority: PRIORITY.toast });
    const toast2 = makeDescriptor({ id: 't2', type: 'toast', priority: PRIORITY.toast });

    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: toast1 });
    const s2 = applyAction(s1, { type: 'ENQUEUE', descriptor: toast2 });

    // FIFO: t1 remains head
    expect(s2.queue[0].id).toBe('t1');
    expect(s2.queue[1].id).toBe('t2');
    expect(s2.preempted).toBeNull();
  });
});

// ── applyAction — FIFO within same priority (got-paid chips) ─────────────────

describe('applyAction — FIFO within same priority for got-paid chips', () => {
  it('two got-paid chips arrive in FIFO order', () => {
    const chip1 = makeDescriptor({ id: 'chip-1', type: 'got-paid', priority: PRIORITY['got-paid'] });
    const chip2 = makeDescriptor({ id: 'chip-2', type: 'got-paid', priority: PRIORITY['got-paid'] });

    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: chip1 });
    const s2 = applyAction(s1, { type: 'ENQUEUE', descriptor: chip2 });

    expect(s2.queue[0].id).toBe('chip-1');
    expect(s2.queue[1].id).toBe('chip-2');
  });

  it('first got-paid chip shifts off on dismiss, second becomes head', () => {
    const chip1 = makeDescriptor({ id: 'chip-1', type: 'got-paid', priority: PRIORITY['got-paid'] });
    const chip2 = makeDescriptor({ id: 'chip-2', type: 'got-paid', priority: PRIORITY['got-paid'] });

    const s1 = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: chip1 });
    const s2 = applyAction(s1, { type: 'ENQUEUE', descriptor: chip2 });
    const s3 = applyAction(s2, { type: 'DISMISS', id: 'chip-1' });

    expect(s3.queue).toHaveLength(1);
    expect(s3.queue[0].id).toBe('chip-2');
    expect(s3.activeId).toBe('chip-2');
  });
});

// ── applyAction — DISMISS_ALL ─────────────────────────────────────────────────

describe('applyAction — DISMISS_ALL', () => {
  it('clears the entire queue', () => {
    const a = makeDescriptor({ id: 'a', priority: 8 });
    const b = makeDescriptor({ id: 'b', priority: 4 });
    let s = applyAction(emptyState(), { type: 'ENQUEUE', descriptor: a });
    s = applyAction(s, { type: 'ENQUEUE', descriptor: b });
    s = applyAction(s, { type: 'DISMISS_ALL' });
    expect(s.queue).toHaveLength(0);
    expect(s.activeId).toBeNull();
  });
});
