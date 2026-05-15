import { describe, it, expect } from 'vitest';

// Smoke test to prove the vitest infrastructure runs.
// Commit 2 (payments data layer) brings real tests; this file can be
// kept as a permanent sanity check or removed at that point.

describe('vitest infrastructure', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
